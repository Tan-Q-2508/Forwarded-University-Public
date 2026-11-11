import { describe, expect, test } from "vitest";
import { RESET_BELOW, pickPersonalities, pickQuestions } from "../src/engine/select";
import { makeContent } from "../src/engine/devContent";

const holder = (seed: number) => ({ rng: seed, usedQ: [] as string[], usedP: [] as string[], game: { gameUsedQ: [] as string[] } });

describe("no-repeat selection at launch scale (250 questions, 80 personalities)", () => {
  const c = makeContent(250, 80);
  test("inside a game: 12 questions (4 for R1 + 8 for R2), never a repeat", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const h = holder(seed);
      const r1 = pickQuestions(h, h, c.questions, 4);
      const r2 = pickQuestions(h, h, c.questions, 8);
      const ids = [...r1, ...r2].map((q) => q.id);
      expect(new Set(ids).size).toBe(12);
    }
  });
  test("across games in a room: no question repeats until fewer than 15 are left unused", () => {
    const h = holder(7);
    const seen = new Set<string>();
    let games = 0;
    for (; games < 40; games++) {
      h.game.gameUsedQ = [];
      const picked = [...pickQuestions(h, h, c.questions, 4), ...pickQuestions(h, h, c.questions, 8)].map((q) => q.id);
      const repeat = picked.some((id) => seen.has(id));
      if (repeat) break;
      picked.forEach((id) => seen.add(id));
    }
    // 250 questions, 12 per game, reset when <15 left: about 19 clean games before anything repeats
    expect(games).toBeGreaterThanOrEqual(18);
    expect(250 - seen.size).toBeLessThan(RESET_BELOW + 12);
  });
  test("each Round 1 mixes India and world and shares no topic tag", () => {
    let mixed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const h = holder(seed);
      const r1 = pickQuestions(h, h, c.questions, 4);
      const tags = r1.flatMap((q) => q.topic_tags);
      expect(new Set(tags).size).toBe(tags.length);
      if (new Set(r1.map((q) => q.region)).size === 2) mixed++;
    }
    expect(mixed).toBeGreaterThanOrEqual(38);
  });
  test("personalities: 2 per game, no repeat inside a game, room list resets when the bank runs out", () => {
    const h = holder(3);
    const all = new Set<string>();
    for (let g = 0; g < 40; g++) { const two = pickPersonalities(h, h, c.personalities, 2).map((p) => p.id); expect(new Set(two).size).toBe(2); two.forEach((x) => all.add(x)); }
    expect(all.size).toBe(80); // every personality got used, the list reset and carried on
  });
  test("a tiny pool never crashes a game", () => {
    const tiny = makeContent(5, 2);
    const h = holder(1);
    expect(() => pickQuestions(h, h, tiny.questions, 4)).not.toThrow();
    expect(() => pickQuestions(h, h, tiny.questions, 8)).not.toThrow();
  });
});
