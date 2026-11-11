/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "vitest";
import { viewFor } from "../src/engine/view";
import { LIMITS } from "../src/engine/text";
import { Room, reachR2Box } from "./helpers";

const SC = { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70, Esha: 60 };
const cursed = () => { const r = Room.started(5); reachR2Box(r, "C", SC); return r; };

describe("Interlude + curse: what each phone is told", () => {
  test("only the cursed player receives the curse text; everyone else can snitch", () => {
    const r = cursed();
    const mine: any = viewFor(r.s, "Bina").curse, other: any = viewFor(r.s, "Aarav").curse;
    expect(mine).toMatchObject({ active: true, mine: true, canSnitch: false });
    expect(mine.text.length).toBeGreaterThan(0);
    expect(mine.text.length).toBeLessThanOrEqual(LIMITS.curse);
    expect(other).toMatchObject({ active: true, mine: false, canSnitch: true });
    expect(other.text).toBeUndefined();
    expect(JSON.stringify(viewFor(r.s, "Aarav"))).not.toContain(mine.text);
  });
  test("a spectator sees that a curse exists but gets no BUSTED button", () => {
    const r = cursed(); r.join("Watcher");
    expect((viewFor(r.s, "Watcher") as any).curse).toMatchObject({ active: true, canSnitch: false });
  });
  test("snitch window shows votes / need / whether you already voted", () => {
    const r = cursed();
    r.do("Aarav", { type: "snitch" });
    const a: any = viewFor(r.s, "Aarav").curse, c: any = viewFor(r.s, "Chirag").curse;
    expect(a.window).toMatchObject({ votes: 1, need: 2, voted: true });
    expect(c.window).toMatchObject({ votes: 1, need: 2, voted: false });
    r.do("Aarav", { type: "snitch" }); // the same player cannot double-vote
    expect((viewFor(r.s, "Aarav") as any).curse.window.votes).toBe(1);
  });
  test("after a failed window the first tapper sees a cooldown; others do not", () => {
    const r = cursed();
    r.do("Aarav", { type: "snitch" });
    r.tick(5001);
    expect((viewFor(r.s, "Aarav") as any).curse.cooldownUntil).toBeGreaterThan(r.t);
    expect((viewFor(r.s, "Chirag") as any).curse.cooldownUntil).toBe(0);
    expect((viewFor(r.s, "Aarav") as any).curse.window).toBeNull();
  });
  test("a successful snitch ends the curse for everyone's view", () => {
    const r = cursed();
    r.do("Aarav", { type: "snitch" }); r.do("Chirag", { type: "snitch" });
    for (const n of r.names()) expect((viewFor(r.s, n) as any).curse).toBeNull();
  });
  test("the cursed player cannot see the Dealer's boxes or other secrets; result is public", () => {
    const r = Room.started(5); reachR2Box(r, "A", SC);
    expect((viewFor(r.s, "Bina") as any).curse).toBeNull();
    const r2 = Room.started(4);
    // at the result phase everyone sees which box was opened but not the other boxes
    r2.skipRules();
    for (let q = 0; q < 4; q++) { for (const n of r2.names()) { r2.do(n, { type: "r1.select", check: 0, bomb: null }); r2.do(n, { type: "r1.lock" }); } r2.expire(); for (const n of r2.names()) r2.do(n, { type: "next" }); }
    r2.do(r2.d.underdog, { type: "ix.pick", box: 1 });
    expect(r2.kind).toBe("ixResult");
    const d: any = (viewFor(r2.s, "Aarav") as any).data;
    expect(Object.keys(d).sort()).toEqual(["box", "flat", "kind", "underdog"]);
  });
});
