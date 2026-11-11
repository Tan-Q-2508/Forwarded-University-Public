import { test, expect } from "@playwright/test";

// With the phone keyboard open the visible area is short. The typing screen pins the stage to the top and fits
// the width, so the prompt, text box and SUBMIT must all stay inside the visible area without scrolling.
const PHONES: [number, number, number][] = [[390, 844, 520], [360, 800, 480], [412, 915, 560], [430, 932, 580]];
for (const [w, h, visible] of PHONES) {
  test(`typing screen with keyboard open @ ${w}x${h} (visible ${visible}px)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: visible });
    await page.goto("/?dev=0&kb=1&o=port#r2-write");
    await page.waitForSelector("body[data-ready='1'] #in-fake");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `test-results/keyboard-${w}x${h}.png` });
    for (const sel of [".r2-head", "#in-fake", '[data-act="write"]', '[data-act="preset"]', ".w-msg"]) {
      const b = await page.locator(sel).first().boundingBox();
      expect(b, sel).not.toBeNull();
      expect(b!.y, `${sel} top`).toBeGreaterThanOrEqual(0);
      expect(b!.y + b!.height, `${sel} bottom within ${visible}px`).toBeLessThanOrEqual(visible + 1);
      expect(b!.x + b!.width, `${sel} right`).toBeLessThanOrEqual(w + 1);
    }
    const scrolls = await page.evaluate(() => document.scrollingElement!.scrollHeight > innerHeight + 1);
    expect(scrolls).toBe(false);
  });
}

// Round 3: the search box, its suggestion list and LOCK IN / PASS must also stay above the keyboard.
for (const [w, h, visible] of PHONES) {
  test(`R3 guess box with keyboard open @ ${w}x${h} (visible ${visible}px)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: visible });
    await page.goto("/?dev=0&kb=1&o=port#r3-hint");
    await page.waitForSelector("body[data-ready='1'] #in-guess");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `test-results/keyboard-r3-${w}x${h}.png` });
    for (const sel of ["#in-guess", '[data-act="guess3"]', '[data-act="pass"]', "#sug"]) {
      const b = await page.locator(sel).first().boundingBox();
      expect(b, sel).not.toBeNull();
      expect(b!.y + b!.height, `${sel} bottom within ${visible}px`).toBeLessThanOrEqual(visible + 1);
    }
  });
}
