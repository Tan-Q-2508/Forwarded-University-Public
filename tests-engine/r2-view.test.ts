/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "vitest";
import { viewFor } from "../src/engine/view";
import { Room, reachR2Box } from "./helpers";

const SC = { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 };
function toWrite() {
  const r = Room.started(4); reachR2Box(r, "A", SC);
  const hot = r.d.hot;
  r.do(hot, { type: "r2.tile", tile: r.s.game.r2.tiles.findIndex((t) => !t.taken && !t.garbage) });
  return { r, hot, writers: r.names().filter((n) => n !== hot) };
}

describe("Round 2: what each phone is told", () => {
  test("turn counter is in every Round 2 view", () => {
    const { r, hot } = toWrite();
    expect((viewFor(r.s, hot) as any).data).toMatchObject({ turn: 1, turns: 4 });
  });
  test("tile pick: decoys only, never the question behind a tile", () => {
    const r = Room.started(4); reachR2Box(r, "A", SC);
    const txt = JSON.stringify(viewFor(r.s, "Aarav"));
    expect(txt).not.toContain("qid");
    expect(txt).not.toContain("TEST question");
  });
  test("write: writers get the truth, the hot seat and spectators do not", () => {
    const { r, hot, writers } = toWrite(); r.join("Spec");
    expect((viewFor(r.s, writers[0]) as any).data.real).toContain("Real answer");
    expect((viewFor(r.s, hot) as any).data.real).toBeUndefined();
    expect((viewFor(r.s, "Spec") as any).data.real).toBeUndefined();
  });
  test("write: submitted flag flips only for the writer who submitted", () => {
    const { r, writers } = toWrite();
    r.do(writers[0], { type: "r2.write", text: "My silly fake" });
    expect((viewFor(r.s, writers[0]) as any).data.submitted).toBe(true);
    expect((viewFor(r.s, writers[1]) as any).data.submitted).toBe(false);
  });
  test("guess: option texts only, no authors and no truth marker", () => {
    const { r, hot, writers } = toWrite();
    for (const w of writers) r.do(w, { type: "r2.write", text: `Fake by ${w}` });
    expect(r.kind).toBe("r2guess");
    const txt = JSON.stringify(viewFor(r.s, hot));
    expect(txt).not.toContain('"authors"');
    expect(txt).not.toContain('"real"');
    expect((viewFor(r.s, hot) as any).data.options.every((o: unknown) => typeof o === "string")).toBe(true); // plain texts, nothing attached
  });
  test("vote: you can see which options are yours; nobody can see others' votes", () => {
    const { r, hot, writers } = toWrite();
    for (const w of writers) r.do(w, { type: "r2.write", text: `Fake by ${w}` });
    r.do(hot, { type: "r2.pick", option: r.d.options.findIndex((o: any) => o.real) });
    r.expire();
    expect(r.kind).toBe("r2vote");
    const mine: any = (viewFor(r.s, writers[0]) as any).data;
    expect(mine.canVote).toBe(true);
    expect(mine.own).toHaveLength(1);
    expect((viewFor(r.s, hot) as any).data.canVote).toBe(false);
    r.do(writers[1], { type: "r2.vote", option: mine.own[0] });
    expect(JSON.stringify(viewFor(r.s, writers[2]))).not.toContain('"votes"');
  });
  test("reveal: authors, house lies and the hot seat's picks are public only now", () => {
    const { r, hot, writers } = toWrite();
    for (const w of writers) r.do(w, { type: "r2.write", text: `Fake by ${w}` });
    r.do(hot, { type: "r2.pick", option: r.d.options.findIndex((o: any) => o.real) });
    const d: any = (viewFor(r.s, writers[0]) as any).data;
    expect(r.kind).toBe("r2reveal");
    expect(d.options.some((o: any) => o.real)).toBe(true);
    expect(d.options.flatMap((o: any) => o.authors).sort()).toEqual([...writers].sort());
    expect(d.picks).toHaveLength(1);
  });
});
