import { describe, expect, test } from "vitest";
import { nextSelection, stepFor } from "../src/client/r1";

describe("Round 1 tap logic (client convenience; the server re-checks everything)", () => {
  test("✅ and 💣 never end up on the same option", () => {
    expect(nextSelection({ check: null, bomb: 2 }, "check", 2)).toEqual({ check: 2, bomb: null });
    expect(nextSelection({ check: 3, bomb: null }, "bomb", 3)).toEqual({ check: null, bomb: 3 });
  });
  test("tapping the same mark again clears it; marks on other options are untouched", () => {
    expect(nextSelection({ check: 1, bomb: 4 }, "check", 1)).toEqual({ check: null, bomb: 4 });
    expect(nextSelection({ check: 1, bomb: 4 }, "bomb", 2)).toEqual({ check: 1, bomb: 2 });
  });
  test("reveal steps follow the server clock: nothing, ✅ land, 💣 drop, truth", () => {
    expect([0, 999, 1000, 2999, 3000, 4999, 5000, 8000].map(stepFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});
