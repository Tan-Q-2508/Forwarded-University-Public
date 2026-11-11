import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// docs/05: contrast >= 4.5:1. Every text/background pair the UI actually uses, checked against the real CSS tokens.
const css = readFileSync("src/client/styles/tokens.css", "utf8");
const tok: Record<string, string> = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) tok[m[1]] = m[2];
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const T = (n: string) => tok[n] ?? n; // token name or a literal hex used in the CSS

const PAIRS: [string, string, string][] = [
  ["ink", "cream", "body text"], ["ink", "paper", "cards"], ["ink", "sun", "yellow buttons/pills"], ["ink", "mint", "mint buttons"],
  ["ink", "sky", "sky tiles"], ["ink", "pink", "pink tiles"], ["paper", "night", "header/question card"], ["sun", "night", "round tag, ready counter"],
  ["sun", "ink", "ticker label"], ["paper", "news-red", "red buttons, ticker, stamp"], ["paper", "news-red-dark", "FAKE verdict"],
  ["paper", "mint-dark", "TRUE verdict"], ["news-red-dark", "paper", "error text on white"], ["news-red-dark", "sun", "error text on yellow card"],
  ["grey-dark", "paper", "status / math text"], ["grey-dark", "cream", "empty seat text"], ["mint-dark", "paper", "READY status"],
  ["news-red", "cream", "low-count warning, tie message"], ["#3f4373", "#c9cbe0", "disabled button text"], ["#4b507f", "#d9dbee", "locked hint text"],
  ["#4a4f80", "#e4e5f2", "greyed player text"], ["#5f6490", "paper", "placeholder text"], ["paper", "night-2", "mute button"],
  ["ink", "#c9f7e6", "true row"], ["ink", "#ffe0e5", "false row"], ["ink", "#fff3b0", "selected row"], ["#0b4fd6", "paper", "source link"],
  ["paper", "#5f6490", "locked hint number"], ["ink", "#fff0f3", "reveal fake row"], ["ink", "#d8f0ff", "mine row"],
];
describe("accessibility: contrast >= 4.5:1 for every text/background pair in use", () => {
  test.each(PAIRS)("%s on %s (%s)", (fg, bg) => { expect(ratio(T(fg), T(bg))).toBeGreaterThanOrEqual(4.5); });
});

describe("the CSS really uses the checked colours (no old low-contrast values left)", () => {
  const all = ["tokens", "base", "components", "screens", "live", "r2", "r3"].map((f) => readFileSync(`src/client/styles/${f}.css`, "utf8")).join("\n");
  test.each(["#555a8a", "#666b9a", "#6a6f9a"])("%s is gone", (bad) => { expect(all.toLowerCase()).not.toContain(bad); });
  test("placeholder, disabled, locked and grey-seat colours are the checked ones", () => {
    for (const good of ["#5f6490", "#3f4373", "#4b507f", "#4a4f80"]) expect(all.toLowerCase()).toContain(good);
    expect(all).not.toMatch(/placeholder\s*\{\s*color:\s*#8d90b5/);
  });
});
