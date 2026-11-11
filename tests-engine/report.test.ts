import { describe, expect, test } from "vitest";
import { reportItem } from "../src/engine/report";
import type { State } from "../src/engine/types";

const base = (phase: any, game: any = {}): State => ({ phase, game: { r1: { ids: ["q1", "q2"] }, r3: { cur: null, ps: {} }, ...game } } as unknown as State);

describe("reportItem (what a Report button can point at)", () => {
  test("Round 1 question: ids and options in the order the phone shows, with the truth marked", () => {
    const it = reportItem(base({ kind: "r1q", d: { qi: 0, qid: "q1", options: [{ text: "A fake", isTrue: false }, { text: "Real", isTrue: true }] } }))!;
    expect(it.id).toBe("q1");
    expect(it.options.map((o) => o.text)).toEqual(["A fake", "Real"]);
    expect(it.options[1].real).toBe(true);
  });
  test("Round 1 reveal and lore use the question list", () => {
    expect(reportItem(base({ kind: "r1reveal", d: { qi: 1, options: [] } }))!.id).toBe("q2");
    expect(reportItem(base({ kind: "r1lore", d: { qi: 0 } }))!.options).toEqual([]);
  });
  test("Round 2 guess, vote and reveal carry the real flag", () => {
    for (const kind of ["r2guess", "r2vote", "r2reveal"]) {
      const it = reportItem(base({ kind, d: { qid: "q9", options: [{ text: "x", real: false }, { text: "y", real: true }] } }))!;
      expect(it.id).toBe("q9");
      expect(it.options.map((o) => o.real)).toEqual([false, true]);
    }
  });
  test("Round 2 write: question only", () => { expect(reportItem(base({ kind: "r2write", d: { qid: "q3" } }))!.options).toEqual([]); });
  test("Round 3 shows only hints revealed so far; reveal shows all five", () => {
    const g = { r3: { cur: { pid: "p7", hint: 2 }, ps: { p7: { hints: ["h1", "h2", "h3", "h4", "h5"] } } } };
    const hint = reportItem(base({ kind: "r3hint", d: {} }, g))!;
    expect(hint.personality).toBe(true);
    expect(hint.options.map((o) => o.text)).toEqual(["h1", "h2"]);
    expect(reportItem(base({ kind: "r3reveal", d: {} }, g))!.options).toHaveLength(5);
  });
  test("screens with nothing to report give null", () => {
    for (const kind of ["lobby", "rules", "ixPick", "r2pick", "r3wager", "podium", "postgame"]) expect(reportItem(base({ kind, d: {} }))).toBeNull();
  });
});
