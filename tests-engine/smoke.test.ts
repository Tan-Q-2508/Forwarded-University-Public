import { test, expect } from "vitest";
import { Room, playUntil, mulberry } from "./helpers";

test("full game reaches post-game and Play Again returns to the same lobby", () => {
  const r = Room.started(4);
  expect(r.kind).toBe("rules");
  playUntil(r, "podium", mulberry(3));
  playUntil(r, "postgame", mulberry(3));
  playUntil(r, "lobby", mulberry(3));
  expect(r.s.code).toBe("TEST");
  expect(r.names().length).toBe(4);
});
