import { test, expect } from "@playwright/test";

// Every screen state, at every required size. Fails the build if anything leaves its container,
// text is clipped, text is smaller than 44 stage units, or the page can scroll.
const SCREENS = ["home", "lobby", "r1-question", "r1-reveal", "r2-guess", "r3-hint", "podium", "wait", "rules", "lore", "ix-pick", "ix-result", "r2-pick", "r2-write", "r2-reveal", "r2-vote", "r3-wager", "r3-reveal", "postgame", "report-modal", "report-modal-empty", "report-modal-lore", "rules-modal-0", "rules-modal-1", "rules-modal-2", "rules-modal-3", "rules-modal-4", "rules-modal-5"];
const SIZES: [string, number, number][] = [
  ["1920x1080", 1920, 1080],
  ["1366x768", 1366, 768],
  ["2560x1440", 2560, 1440],
  ["ipad-land-1180x820", 1180, 820],
  ["ipad-port-820x1180", 820, 1180],
  ["phone-390x844", 390, 844],
  ["phone-360x800", 360, 800],
  ["phone-412x915", 412, 915],
  ["phone-430x932", 430, 932],
];
const TOL = 1.5; // px, in screen space

for (const screen of SCREENS) {
  for (const [name, w, h] of SIZES) {
    test(`${screen} @ ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/?dev=0#${screen}`);
      await page.waitForSelector("body[data-ready='1'] .stage");
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `test-results/${screen}-${name}.png` });

      const problems = await page.evaluate((tol) => {
        const out: string[] = [];
        const stage = document.querySelector(".stage") as HTMLElement;
        const sRect = stage.getBoundingClientRect();
        const scale = sRect.width / stage.offsetWidth;
        const label = (el: Element) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute("class") || "").split(" ").join(".")}`;
        const inside = (a: DOMRect, b: DOMRect) =>
          a.left >= b.left - tol && a.top >= b.top - tol && a.right <= b.right + tol && a.bottom <= b.bottom + tol;

        // 1. the stage itself fits the window
        const vw = window.visualViewport?.width ?? innerWidth;
        const vh = window.visualViewport?.height ?? innerHeight;
        if (sRect.left < -tol || sRect.top < -tol || sRect.right > vw + tol || sRect.bottom > vh + tol)
          out.push("stage leaves the window");

        for (const el of Array.from(stage.querySelectorAll("*"))) {
          if (el.closest("[data-deco]") || el instanceof SVGElement || el.tagName === "BR") continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          // 2. every element inside the stage and inside its parent
          if (!inside(r, sRect)) out.push(`outside stage: ${label(el)}`);
          const parent = el.parentElement!;
          if (parent !== stage && !inside(r, parent.getBoundingClientRect()))
            out.push(`outside parent: ${label(el)} in ${label(parent)}`);
          const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
          // 3. text never clipped or overflowing its own box (line-clamp boxes are checked for clipping too)
          const h = el as HTMLElement;
          const cs = getComputedStyle(h);
          if (h.querySelector("[data-deco]")) continue; // decorative marquee/confetti, clipped on purpose
          // glyph ascent/descent of display fonts can exceed a tight line-height; allow that, not real overflow
          const vtol = Math.max(2, parseFloat(cs.fontSize) * 0.35);
          if (el.tagName !== "INPUT" && h.scrollWidth > h.clientWidth + 1 && cs.textOverflow !== "ellipsis" && cs.overflow !== "visible")
            out.push(`h-overflow: ${label(el)}`);
          const clamp = cs.webkitLineClamp !== "none" && cs.webkitLineClamp !== "";
          if (hasText && h.scrollHeight > h.clientHeight + vtol && !clamp) out.push(`v-overflow: ${label(el)}`);
          if (clamp && h.scrollHeight > h.clientHeight + vtol) out.push(`text clipped by line-clamp: ${label(el)}`);
          // 4. minimum rendered text size (stage units)
          if (hasText && parseFloat(cs.fontSize) < 44 - 0.01) out.push(`font < 44: ${label(el)} ${cs.fontSize}`);
        }
        void scale;
        // 5. nothing scrolls
        const se = document.scrollingElement!;
        if (se.scrollHeight > innerHeight + 1 || se.scrollWidth > innerWidth + 1) out.push("page scrolls");
        return Array.from(new Set(out));
      }, TOL);

      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
}
