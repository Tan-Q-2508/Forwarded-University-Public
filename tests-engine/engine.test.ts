/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from "vitest";
import { K } from "../src/engine/engine";
import { viewFor } from "../src/engine/view";
import { CONTENT, Room, makeContent, mulberry, playUntil, step } from "./helpers";

/* ------------------------------------------------------------------ drive helpers */
function lockAll(r: Room, check = 0, bomb: number | null = null) {
  for (const n of r.names()) { r.do(n, { type: "r1.select", check, bomb }); r.do(n, { type: "r1.lock" }); }
}
/** play R1 questions 1..4 quickly, everyone picking option 0; scores get overwritten by `scores` right before the interlude */
function reachIx(r: Room, scores?: Record<string, number>) {
  r.skipRules();
  for (let q = 0; q < 4; q++) {
    expect(r.kind).toBe("r1q");
    lockAll(r);
    expect(r.kind).toBe("r1reveal");
    r.expire();
    expect(r.kind).toBe("r1lore");
    if (q === 3 && scores) for (const [n, v] of Object.entries(scores)) r.p(n).score = v;
    for (const n of r.names()) r.do(n, { type: "next" });
  }
}
const setBoxes = (r: Room, boxes: string[]) => { r.s.phase.d.boxes = boxes; };
function reachR2(r: Room, box: "A" | "B" | "C" = "A", scores?: Record<string, number>) {
  reachIx(r, scores);
  expect(r.kind).toBe("ixPick");
  setBoxes(r, box === "A" ? ["A", "B", "C"] : box === "B" ? ["B", "A", "C"] : ["C", "A", "B"]);
  r.do(r.d.underdog, { type: "ix.pick", box: 0 });
  expect(r.kind).toBe("ixResult");
  r.expire();
  r.skipRules();
  expect(r.kind).toBe("r2pick");
}
/** hot seat takes first free real tile; every writer writes a distinct fake */
function realTile(r: Room) { return r.s.game.r2.tiles.findIndex((t) => !t.taken && !t.garbage); }
function writeAll(r: Room, mk = (n: string) => `Fake by ${n}`) {
  expect(r.kind).toBe("r2write");
  for (const n of r.names()) if (n !== r.d.hot) r.do(n, { type: "r2.write", text: mk(n) });
}
const realIdx = (r: Room) => r.d.options.findIndex((o: any) => o.real);
const fakeIdxOf = (r: Room, name: string) => r.d.options.findIndex((o: any) => o.authors.includes(name));

/* ================================================================== 1 LOBBY */
describe("1 Lobby: join, identity, start", () => {
  test("names: trimmed, 1-12 chars, unique case-insensitively, abusive names refused", () => {
    const r = new Room();
    r.join("  Aarav  ");
    expect(r.fx.find((e: any) => e.t === "reply")).toMatchObject({ msg: { type: "joined", name: "Aarav" } });
    const dup = r.join("aARAV");
    expect(dup.effects[0]).toMatchObject({ t: "reply", msg: { type: "error", code: "name_in_use" } });
    expect(r.join("x".repeat(13)).effects[0]).toMatchObject({ msg: { code: "bad_name" } });
    expect(r.join("   ").effects[0]).toMatchObject({ msg: { code: "bad_name" } });
    expect(r.join("fuck").effects[0]).toMatchObject({ msg: { code: "bad_name" } });
    expect(r.s.players).toHaveLength(1);
  });
  test("first player is owner; only the owner can start; needs 3 connected", () => {
    const r = new Room();
    r.join("Aarav"); r.join("Bina");
    r.do("Aarav", { type: "start" });
    expect(r.kind).toBe("lobby"); // only 2
    r.join("Chirag");
    r.do("Bina", { type: "start" });
    expect(r.kind).toBe("lobby"); // not the owner
    r.do("Aarav", { type: "start" });
    expect(r.kind).toBe("rules");
  });
  test("owner leaving passes ownership to the longest-connected player", () => {
    const r = new Room();
    r.join("Aarav"); r.t += 10; r.join("Bina"); r.t += 10; r.join("Chirag");
    r.drop("Aarav");
    expect(r.s.owner).toBe("Bina");
  });
  test("room is capped at 8 players; extras become spectators", () => {
    const r = new Room();
    for (let i = 0; i < 10; i++) r.join("P" + i);
    expect(r.s.players.filter((p) => p.seated)).toHaveLength(8);
    expect(r.s.players.filter((p) => !p.seated)).toHaveLength(2);
  });
  test("same device token takes over a live seat and the old tab is told it was replaced", () => {
    const r = new Room();
    r.join("Aarav", "tok1");
    const res = r.join("Aarav", "tok1");
    expect(res.effects.some((e: any) => e.t === "send" && e.msg.type === "replaced")).toBe(true);
    expect(r.join("Aarav", "other").effects[0]).toMatchObject({ msg: { code: "name_in_use" } });
  });
  test("lobby toggle for verbal curses is owner-only", () => {
    const r = new Room(); r.join("A"); r.join("B");
    r.do("B", { type: "curses", on: false });
    expect(r.s.curses).toBe(true);
    r.do("A", { type: "curses", on: false });
    expect(r.s.curses).toBe(false);
  });
});

/* ================================================================== REJOIN + SPECTATORS */
describe("Rejoin and spectators", () => {
  test("rejoin with same name keeps the seat and score (after refresh, kick or network drop)", () => {
    const r = Room.started(4);
    r.p("Bina").score = 77;
    r.drop("Bina");
    expect(r.p("Bina").connected).toBe(false);
    r.join("bina");
    expect(r.p("Bina")).toMatchObject({ connected: true, seated: true, score: 77 });
  });
  test("a stranger joining mid-game spectates: scoreboard only, no secrets, cannot act", () => {
    const r = Room.started(4);
    r.skipRules();
    r.join("Latecomer");
    expect(r.p("Latecomer").seated).toBe(false);
    const v: any = viewFor(r.s, "Latecomer");
    expect(v.you.seated).toBe(false);
    r.do("Latecomer", { type: "r1.select", check: 0, bomb: null });
    expect(r.d.sel["Latecomer"]).toBeUndefined();
    expect(r.elig()).not.toContain("Latecomer");
  });
  test("rejoining player who already locked is shown as locked, without secrets", () => {
    const r = Room.started(4); r.skipRules();
    r.do("Bina", { type: "r1.select", check: 2, bomb: 1 }); r.do("Bina", { type: "r1.lock" });
    r.drop("Bina"); r.join("Bina");
    const v: any = viewFor(r.s, "Bina");
    expect(v.data.mine).toEqual({ check: 2, bomb: 1, locked: true });
    expect(JSON.stringify(v)).not.toContain("isTrue");
  });
});

/* ================================================================== 2-5 ROUND 1 */
describe("2 Rules card", () => {
  test("ends when all skip, or at the 15 s deadline", () => {
    const a = Room.started(3); a.skipRules(); expect(a.kind).toBe("r1q");
    const b = Room.started(3); b.do("Aarav", { type: "skip" }); expect(b.kind).toBe("rules"); b.expire(); expect(b.kind).toBe("r1q");
  });
});

describe("3-5 Round 1", () => {
  test("question has 5-6 options, exactly one true, and no secrets in the player view", () => {
    const r = Room.started(4); r.skipRules();
    const opts = r.d.options;
    expect(opts.length).toBeGreaterThanOrEqual(5); expect(opts.length).toBeLessThanOrEqual(6);
    expect(opts.filter((o: any) => o.isTrue)).toHaveLength(1);
    const v = JSON.stringify(viewFor(r.s, "Aarav"));
    expect(v).not.toContain("isTrue");
    expect(v).not.toContain("truth");
  });
  test("12 (failure 12): ✅ and 💣 on the same option is rejected by the server", () => {
    const r = Room.started(3); r.skipRules();
    r.do("Aarav", { type: "r1.select", check: 1, bomb: 1 });
    expect(r.d.sel["Aarav"]?.check ?? null).toBeNull();
    r.do("Aarav", { type: "r1.select", check: 99, bomb: null });
    r.do("Aarav", { type: "r1.select", check: -1, bomb: null });
    r.do("Aarav", { type: "r1.select", check: 1.5 as any, bomb: null });
    expect(r.d.sel["Aarav"]?.check ?? null).toBeNull();
  });
  test("scoring: ✅ +10, bomb +10 per victim, bomb on the truth is defused", () => {
    const r = Room.started(4); r.skipRules();
    const T = r.d.options.findIndex((o: any) => o.isTrue);
    const [W, W2] = r.d.options.map((_: any, i: number) => i).filter((i: number) => i !== T);
    const pick = (n: string, c: number | null, b: number | null) => { r.do(n, { type: "r1.select", check: c, bomb: b }); r.do(n, { type: "r1.lock" }); };
    pick("Aarav", T, W); pick("Bina", W, T); pick("Chirag", W, W2); pick("Divya", T, null);
    expect(r.kind).toBe("r1reveal");
    expect(r.score("Aarav")).toBe(10 + 20); // truth + 2 victims on W
    expect(r.score("Bina")).toBe(0);        // bomb on the truth defused
    expect(r.score("Chirag")).toBe(0);      // bomb on an option nobody chose explodes for 0
    expect(r.score("Divya")).toBe(10);
    expect(r.d.options[T].isTrue).toBe(true);
    expect(r.d.deltas).toMatchObject({ Aarav: 30, Divya: 10 });
  });
  test("bomb payout is capped at +40 per question", () => {
    const r = Room.started(8); r.skipRules();
    const T = r.d.options.findIndex((o: any) => o.isTrue);
    const W = (T + 1) % r.d.options.length;
    for (const n of ["Bina", "Chirag", "Divya", "Esha", "Farhan", "Gita", "Hari"]) { r.do(n, { type: "r1.select", check: W, bomb: null }); r.do(n, { type: "r1.lock" }); }
    r.do("Aarav", { type: "r1.select", check: T, bomb: W }); r.do("Aarav", { type: "r1.lock" });
    expect(r.score("Aarav")).toBe(10 + 40); // 7 victims x10 would be 70
  });
  test("timer with partial input: what is selected counts; nothing selected scores 0", () => {
    const r = Room.started(3); r.skipRules();
    const T = r.d.options.findIndex((o: any) => o.isTrue);
    r.do("Aarav", { type: "r1.select", check: T, bomb: null }); // never locked
    r.expire();
    expect(r.kind).toBe("r1reveal");
    expect(r.score("Aarav")).toBe(10);
    expect(r.score("Bina")).toBe(0);
  });
  test("lock needs a ✅; a locked answer cannot be changed; unlock re-opens it", () => {
    const r = Room.started(3); r.skipRules();
    r.do("Aarav", { type: "r1.lock" });
    expect(r.d.sel["Aarav"]?.locked).toBeFalsy();
    r.do("Aarav", { type: "r1.select", check: 0, bomb: null }); r.do("Aarav", { type: "r1.lock" });
    r.do("Aarav", { type: "r1.select", check: 1, bomb: null });
    expect(r.d.sel["Aarav"].check).toBe(0);
    r.do("Aarav", { type: "r1.unlock" });
    r.do("Aarav", { type: "r1.select", check: 1, bomb: null });
    expect(r.d.sel["Aarav"].check).toBe(1);
  });
  test("8 (failure 8): stale phase id and duplicate/replayed seq are ignored", () => {
    const r = Room.started(3); r.skipRules();
    const oldId = r.s.phase.id;
    r.do("Aarav", { type: "r1.select", check: 0, bomb: null }, oldId - 1);
    expect(r.d.sel["Aarav"]).toBeUndefined();
    r.ev({ type: "intent", at: r.t, name: "Aarav", phaseId: oldId, seq: 5, intent: { type: "r1.select", check: 0, bomb: null } });
    r.ev({ type: "intent", at: r.t, name: "Aarav", phaseId: oldId, seq: 5, intent: { type: "r1.select", check: 2, bomb: null } }); // replay
    r.ev({ type: "intent", at: r.t, name: "Aarav", phaseId: oldId, seq: 3, intent: { type: "r1.select", check: 3, bomb: null } }); // older seq
    expect(r.d.sel["Aarav"].check).toBe(0);
  });
  test("locks of a player who then disconnects still score; they are removed from the ready count", () => {
    const r = Room.started(4); r.skipRules();
    const T = r.d.options.findIndex((o: any) => o.isTrue);
    r.do("Bina", { type: "r1.select", check: T, bomb: null }); r.do("Bina", { type: "r1.lock" });
    r.drop("Bina");
    expect(r.elig()).not.toContain("Bina");
    for (const n of ["Aarav", "Chirag", "Divya"]) { r.do(n, { type: "r1.select", check: 0, bomb: null }); r.do(n, { type: "r1.lock" }); }
    expect(r.kind).toBe("r1reveal");
    expect(r.score("Bina")).toBe(10);
  });
  test("5 (failure 5): last eligible player disconnecting fires the 'nobody eligible' exit immediately", () => {
    const r = Room.started(3); r.skipRules();
    for (const n of ["Aarav", "Bina"]) { r.do(n, { type: "r1.select", check: 0, bomb: null }); r.do(n, { type: "r1.lock" }); }
    expect(r.kind).toBe("r1q");
    r.drop("Chirag");
    expect(r.kind).toBe("r1reveal");
  });
  test("reveal then lore card, 4 questions, no repeated question or topic tag in the game", () => {
    const r = Room.started(4); r.skipRules();
    const ids: string[] = [];
    for (let q = 0; q < 4; q++) { ids.push(r.d.qid); lockAll(r); r.expire(); expect(r.kind).toBe("r1lore"); for (const n of r.names()) r.do(n, { type: "next" }); }
    expect(new Set(ids).size).toBe(4);
    const tags = ids.flatMap((id) => r.s.game.qs[id].topic_tags);
    expect(new Set(tags).size).toBe(tags.length);
    expect(r.kind).toBe("ixPick");
  });
  test("lore view carries our own card text with source name + link", () => {
    const r = Room.started(3); r.skipRules(); lockAll(r); r.expire();
    const v: any = viewFor(r.s, "Aarav");
    expect(v.data.source.newspaper).toBeTruthy();
    expect(v.data.urls[0]).toMatch(/^https?:\/\//);
  });
});

/* ================================================================== 6-8 INTERLUDE */
describe("6-8 Interlude", () => {
  test("Dealer = first place, Underdog = last place, always different players", () => {
    const r = Room.started(4);
    reachIx(r, { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    expect(r.d.underdog).toBe("Bina");
    expect(r.d.dealer).toBe("Aarav");
  });
  test("9 (failure 9): ties are broken deterministically (fewer R1 correct first), never crash", () => {
    const a = Room.started(4, 9); reachIx(a, { Aarav: 50, Bina: 50, Chirag: 50, Divya: 50 });
    const b = Room.started(4, 9); reachIx(b, { Aarav: 50, Bina: 50, Chirag: 50, Divya: 50 });
    expect(a.d.underdog).toBe(b.d.underdog); // same seed, same answer
    expect(a.d.underdog).not.toBe(a.d.dealer);
    const c = Room.started(4); reachIx(c, { Aarav: 50, Bina: 50, Chirag: 50, Divya: 50 });
    c.s.players.forEach((p) => (p.r1Correct = 3)); // all equal again after the fact, no throw
    expect(c.d.underdog).toBeTruthy();
  });
  test("only the Dealer sees what is inside the boxes", () => {
    const r = Room.started(4); reachIx(r, { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    expect((viewFor(r.s, "Aarav") as any).data.boxes).toHaveLength(3);
    expect((viewFor(r.s, "Bina") as any).data.boxes).toBeUndefined();
    expect((viewFor(r.s, "Chirag") as any).data.boxes).toBeUndefined();
  });
  test("Box A +25", () => {
    const r = Room.started(4); reachR2(r, "A", { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    expect(r.score("Bina")).toBe(35);
  });
  test("Box B VIP doubles the Underdog's own Hot Seat points (try 1: +25 becomes +50)", () => {
    const r = Room.started(4); reachR2(r, "B", { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    expect(r.d.hot).toBe("Bina"); // lowest score goes first
    r.do("Bina", { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    const before = r.score("Bina");
    r.do("Bina", { type: "r2.pick", option: realIdx(r) });
    expect(r.score("Bina")).toBe(before + 50);
  });
  test("Box C: +1 now and a curse with a +30 bounty; cursed player takes the first Hot Seat", () => {
    const r = Room.started(4); reachR2(r, "C", { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    expect(r.score("Bina")).toBe(11);
    expect(r.s.game.curse?.active).toBe(true);
    expect(r.d.hot).toBe("Bina");
    expect((viewFor(r.s, "Bina") as any).curse.text).toBeTruthy();
    expect((viewFor(r.s, "Aarav") as any).curse.text).toBeUndefined(); // the curse text is for the cursed player
  });
  test("Box C with verbal curses OFF becomes a flat +10, no curse, no snitch", () => {
    const r = Room.started(4); r.do("Aarav", { type: "curses", on: false } as any, r.s.phase.id);
    r.s.phase.kind; // still rules card
    const q = Room.started(4); q.s.curses = false; reachR2(q, "C", { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    expect(q.score("Bina")).toBe(20);
    expect(q.s.game.curse).toBeNull();
    q.do("Aarav", { type: "snitch" });
    expect(q.s.game.curse).toBeNull();
  });
  test("3 (failure 3): Underdog disconnects in the pick: cancelled, no award", () => {
    const r = Room.started(4); reachIx(r, { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    r.drop("Bina");
    expect(r.kind).toBe("rules"); // straight on to the Round 2 rules card
    expect(r.score("Bina")).toBe(10);
  });
  test("Dealer disconnects: the Underdog still picks (blind) and gets the award", () => {
    const r = Room.started(4); reachIx(r, { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    setBoxes(r, ["A", "B", "C"]);
    r.drop("Aarav");
    expect(r.kind).toBe("ixPick");
    r.do("Bina", { type: "ix.pick", box: 0 });
    expect(r.score("Bina")).toBe(35);
  });
  test("Underdog does not pick in time: a random box opens", () => {
    const r = Room.started(4); reachIx(r, { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70 });
    r.expire();
    expect(r.kind).toBe("ixResult");
  });
  test("3 (failure 3): fewer than 2 connected players skips the Interlude", () => {
    const r = Room.started(3); r.skipRules();
    for (let q = 0; q < 4; q++) { lockAll(r); r.expire(); if (q === 3) { r.drop("Bina"); r.drop("Chirag"); } for (const n of r.names()) r.do(n, { type: "next" }); }
    expect(["rules", "r1lore"]).toContain(r.kind);
    expect(r.s.phase.kind).not.toBe("ixPick");
  });
});

/* ================================================================== SNITCH */
describe("Snitch (BUSTED!)", () => {
  const curseRoom = () => { const r = Room.started(5); reachR2(r, "C", { Aarav: 90, Bina: 10, Chirag: 50, Divya: 70, Esha: 60 }); return r; };
  test("threshold max(2, ceil(0.5 x eligible)); success voids the bounty, first tapper +15, curse ends", () => {
    const r = curseRoom(); // 4 non-cursed players: threshold 2
    const before = r.score("Aarav");
    r.do("Aarav", { type: "snitch" });
    expect(r.s.game.curse?.window).toBeTruthy();
    r.do("Chirag", { type: "snitch" });
    expect(r.s.game.curse?.active).toBe(false);
    expect(r.score("Aarav")).toBe(before + K.snitchReward);
  });
  test("a lone tap fails when the window closes: 15 s cooldown for the first tapper", () => {
    const r = curseRoom();
    r.do("Aarav", { type: "snitch" });
    r.tick(K.snitchWindowMs + 1);
    expect(r.s.game.curse?.window).toBeNull();
    expect(r.s.game.curse?.active).toBe(true);
    r.do("Aarav", { type: "snitch" });
    expect(r.s.game.curse?.window).toBeNull(); // cooldown
  });
  test("the cursed player cannot snitch on themselves", () => {
    const r = curseRoom(); r.do("Bina", { type: "snitch" });
    expect(r.s.game.curse?.window).toBeNull();
  });
  test("4 (failure 4): cursed player disconnects: bounty void, nobody penalised", () => {
    const r = curseRoom(); r.drop("Bina");
    expect(r.s.game.curse?.active).toBe(false);
  });
  test("bounty +30 is paid when the 2nd turn ends if the curse survived", () => {
    const r = curseRoom();
    const start = r.score("Bina");
    for (let turn = 0; turn < 2; turn++) {
      const hot = r.d.hot;
      r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
      r.do(hot, { type: "r2.pick", option: realIdx(r) });
      r.expire(); // reveal
      if (r.kind === "r2vote") r.expire();
      r.expire(); // turn end
    }
    // Bina got +25 (try 1) on turn 1, plus bounty +30
    expect(r.score("Bina")).toBe(start + 25 + K.bounty);
  });
  test("a snitch window closes at any phase change", () => {
    const r = curseRoom();
    r.do("Aarav", { type: "snitch" });
    r.do("Bina", { type: "r2.tile", tile: realTile(r) });
    expect(r.s.game.curse?.window).toBeNull();
  });
});

/* ================================================================== 9-14 ROUND 2 */
describe("9-14 Round 2", () => {
  const R2 = (n = 4) => { const r = Room.started(n); reachR2(r, "A", Object.fromEntries(r.names().map((x, i) => [x, 100 + i * 10]))); return r; };
  test("tiles = players + 1 Garbage, and they show decoy categories only", () => {
    const r = R2(5);
    expect(r.s.game.r2.tiles).toHaveLength(6);
    const v: any = viewFor(r.s, "Aarav");
    expect(v.data.tiles.every((t: any) => Object.keys(t).sort().join() === "decoy,taken")).toBe(true);
  });
  test("Garbage tile: +20, hot seat then picks a real tile too; auto-pick never chooses Garbage", () => {
    const r = R2(4);
    const hot = r.d.hot, g = r.s.game.r2.tiles.findIndex((t) => t.garbage);
    const before = r.score(hot);
    r.do(hot, { type: "r2.tile", tile: g });
    expect(r.score(hot)).toBe(before + 20);
    expect(r.kind).toBe("r2pick");
    r.do(hot, { type: "r2.tile", tile: g }); // single-use
    expect(r.kind).toBe("r2pick");
    r.do(hot, { type: "r2.tile", tile: realTile(r) });
    expect(r.kind).toBe("r2write");
    // auto-pick
    const r2 = R2(4); r2.expire();
    expect(r2.kind).toBe("r2write");
    expect(r2.s.game.r2.garbageUsed).toBe(false);
  });
  test("only the hot seat can pick; hot seat unavailable at their turn: turn skipped", () => {
    const r = R2(4);
    const other = r.names().find((n) => n !== r.d.hot)!;
    r.do(other, { type: "r2.tile", tile: realTile(r) });
    expect(r.kind).toBe("r2pick");
    const hot = r.d.hot;
    r.drop(hot);
    expect(r.kind).toBe("r2end"); // skipped
    expect(r.d.skipped).toBe(true);
  });
  test("write: the truth is visible to writers, NOT to the hot seat", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    const writer = r.names().find((n) => n !== hot)!;
    expect((viewFor(r.s, writer) as any).data.real).toContain("Real answer");
    expect((viewFor(r.s, hot) as any).data.real).toBeUndefined();
  });
  test("write validation: too close to the truth, alias, number-normalised, blocked, empty; 2 rejections offer a preset", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    const w = r.names().find((n) => n !== hot)!;
    const real = r.s.game.qs[r.d.qid].real_answer;
    r.fx = [];
    r.do(w, { type: "r2.write", text: real.toUpperCase() });
    r.do(w, { type: "r2.write", text: r.s.game.qs[r.d.qid].r2_alias_answers![0] });
    expect(r.d.authors[w]).toBeUndefined();
    const msgs = r.fx.filter((e: any) => e.t === "send").map((e: any) => e.msg);
    expect(msgs[0]).toMatchObject({ type: "rejected", reason: "too_close_to_truth", offerPreset: false });
    expect(msgs[1]).toMatchObject({ offerPreset: true });
    r.do(w, { type: "r2.write", text: "" });
    r.do(w, { type: "r2.write", text: "you bitch" });
    expect(r.d.authors[w]).toBeUndefined();
    r.do(w, { type: "r2.preset" });
    expect(r.d.authors[w].house).toBe(true);
  });
  test("invisible and right-to-left characters are stripped; text over 60 chars is cut", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    const w = r.names().find((n) => n !== hot)!;
    r.do(w, { type: "r2.write", text: "‮abc​def " + "z".repeat(100) });
    expect(r.d.authors[w].text.length).toBeLessThanOrEqual(60);
    expect(r.d.authors[w].text).not.toMatch(/[‮​]/);
  });
  test("formatting leaks: every option, the real one included, goes through the same cleanup", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    writeAll(r, (n) => `  lower case fake by ${n}.  `);
    for (const o of r.d.options) { expect(o.text[0]).toBe(o.text[0].toUpperCase()); expect(o.text).not.toMatch(/\.$/); expect(o.text).toBe(o.text.trim()); }
  });
  test("guess grid: all fakes + the truth shuffled, at least 4 options, max 8 fakes + truth", () => {
    const r = R2(8); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    expect(r.kind).toBe("r2guess");
    expect(r.d.options).toHaveLength(8); // 7 writers + truth
    expect(r.d.options.filter((o: any) => o.real)).toHaveLength(1);
    const r3 = R2(4); const h3 = r3.d.hot; r3.do(h3, { type: "r2.tile", tile: realTile(r3) }); r3.expire(); // nobody wrote anything
    expect(r3.d.options.length).toBeGreaterThanOrEqual(4);
  });
  test("more than 8 writers worth of fakes is capped at 8 (grid fits 9 slots)", () => {
    const r = R2(8); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    r.d.authors["Ghost1"] = { text: "Extra one", house: false }; r.d.authors["Ghost2"] = { text: "Extra two", house: false };
    writeAll(r);
    expect(r.d.options.length).toBeLessThanOrEqual(9);
  });
  test("duplicate fakes merge and credit both writers", () => {
    const r = R2(5); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    const ws = r.names().filter((n) => n !== hot);
    r.do(ws[0], { type: "r2.write", text: "Same Joke!" }); r.do(ws[1], { type: "r2.write", text: "same joke" });
    r.do(ws[2], { type: "r2.write", text: "Other" }); r.do(ws[3], { type: "r2.write", text: "Another" });
    const merged = r.d.options.find((o: any) => o.authors.length === 2);
    expect(merged.authors.sort()).toEqual([ws[0], ws[1]].sort());
    const i = r.d.options.indexOf(merged);
    const before = [r.score(ws[0]), r.score(ws[1])];
    r.do(hot, { type: "r2.pick", option: i });
    r.do(hot, { type: "r2.pick", option: realIdx(r) }); // points are paid at the reveal
    expect(r.score(ws[0])).toBe(before[0] + 20); expect(r.score(ws[1])).toBe(before[1] + 20);
  });
  test("hot seat scoring: truth on try 1 = +25", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    const b = r.score(hot); r.do(hot, { type: "r2.pick", option: realIdx(r) });
    expect(r.score(hot)).toBe(b + 25);
    expect(r.kind).toBe("r2reveal");
  });
  test("fooled once then truth: hot seat +10, the fooling writer +20", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    const w = r.names().find((n) => n !== hot)!;
    const b = [r.score(hot), r.score(w)];
    r.do(hot, { type: "r2.pick", option: fakeIdxOf(r, w) });
    expect(r.kind).toBe("r2guess"); expect(r.d.attempt).toBe(2); expect(r.d.eliminated).toHaveLength(1);
    r.do(hot, { type: "r2.pick", option: r.d.eliminated[0] }); // cannot re-pick the removed option
    expect(r.kind).toBe("r2guess");
    r.do(hot, { type: "r2.pick", option: realIdx(r) });
    expect(r.score(hot)).toBe(b[0] + 10); expect(r.score(w)).toBe(b[1] + 20);
  });
  test("fooled twice: +20 to each of the two writers and 0 to the hot seat", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    const [w1, w2] = r.names().filter((n) => n !== hot);
    const b = [r.score(hot), r.score(w1), r.score(w2)];
    r.do(hot, { type: "r2.pick", option: fakeIdxOf(r, w1) });
    r.do(hot, { type: "r2.pick", option: fakeIdxOf(r, w2) });
    expect(r.kind).toBe("r2reveal");
    expect([r.score(hot), r.score(w1), r.score(w2)]).toEqual([b[0], b[1] + 20, b[2] + 20]);
  });
  test("fooled by a house lie: no points to anyone", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    const ws = r.names().filter((n) => n !== hot);
    r.do(ws[0], { type: "r2.preset" }); r.do(ws[1], { type: "r2.preset" }); r.do(ws[2], { type: "r2.preset" });
    const total = r.names().reduce((a, n) => a + r.score(n), 0);
    const house = r.d.options.findIndex((o: any) => o.house);
    r.do(hot, { type: "r2.pick", option: house });
    r.do(hot, { type: "r2.pick", option: realIdx(r) });
    expect(r.names().reduce((a, n) => a + r.score(n), 0)).toBe(total + 10); // only the hot seat's +10
  });
  test("guess timer: an attempt is forfeited when time runs out; two forfeits give 0 and show the truth", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    const b = r.score(hot);
    r.expire(); expect(r.kind).toBe("r2guess"); expect(r.d.attempt).toBe(2);
    r.expire(); expect(r.kind).toBe("r2reveal");
    expect(r.score(hot)).toBe(b);
  });
  test("comedy vote: no self-votes, +10 to the funniest fake, ties all get +10", () => {
    const r = R2(5); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    r.do(hot, { type: "r2.pick", option: realIdx(r) });
    r.expire();
    expect(r.kind).toBe("r2vote");
    const [a, b, c, d2] = r.names().filter((n) => n !== hot);
    r.do(a, { type: "r2.vote", option: fakeIdxOf(r, a) }); // self-vote refused
    expect(r.d.votes[a]).toBeUndefined();
    const sc = (n: string) => r.score(n);
    const before = [a, b, c, d2].map(sc);
    r.do(a, { type: "r2.vote", option: fakeIdxOf(r, b) });
    r.do(b, { type: "r2.vote", option: fakeIdxOf(r, a) });
    r.do(c, { type: "r2.vote", option: realIdx(r) }); // wasted
    r.do(d2, { type: "r2.vote", option: fakeIdxOf(r, b) });
    expect(r.kind).toBe("r2end");
    // b has 2 votes, a has 1: b wins alone
    expect([a, b, c, d2].map(sc)).toEqual([before[0], before[1] + 10, before[2], before[3]]);
  });
  test("vote tie: both tied writers get +10", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    r.do(hot, { type: "r2.pick", option: realIdx(r) }); r.expire();
    const [a, b, c] = r.names().filter((n) => n !== hot);
    const before = [a, b].map((n) => r.score(n));
    r.do(a, { type: "r2.vote", option: fakeIdxOf(r, b) });
    r.do(b, { type: "r2.vote", option: fakeIdxOf(r, c) });
    r.do(c, { type: "r2.vote", option: fakeIdxOf(r, a) });
    expect([a, b].map((n) => r.score(n))).toEqual([before[0] + 10, before[1] + 10]);
  });
  test("one writer means no vote; top-2 fakes become pending crowd fakes (text only)", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    const [w] = r.names().filter((n) => n !== hot);
    r.do(w, { type: "r2.write", text: "Lonely fake" }); r.expire();
    r.fx = [];
    r.do(hot, { type: "r2.pick", option: realIdx(r) }); r.expire();
    expect(r.kind).toBe("r2end");
    const cf = r.fx.filter((e: any) => e.t === "crowdFake") as any[];
    expect(cf).toHaveLength(1);
    expect(Object.keys(cf[0]).sort()).toEqual(["questionId", "t", "text"]);
  });
  test("1 (failure 1): hot seat disconnects mid-turn: 10 s grace, then the turn is skipped; returning inside grace is fine", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) }); writeAll(r);
    r.drop(hot);
    expect(r.kind).toBe("r2guess");
    r.tick(K.hotGraceMs + 1);
    expect(r.kind).toBe("r2end"); expect(r.d.skipped).toBe(true);
    const r2 = R2(4); const h2 = r2.d.hot; r2.do(h2, { type: "r2.tile", tile: realTile(r2) }); writeAll(r2);
    r2.drop(h2); r2.tick(5000); r2.join(h2); r2.tick(10_000);
    expect(r2.kind).toBe("r2guess");
  });
  test("2 (failure 2): all writers disconnect: the turn still completes with house lies", () => {
    const r = R2(4); const hot = r.d.hot; r.do(hot, { type: "r2.tile", tile: realTile(r) });
    for (const n of r.names().filter((x) => x !== hot)) r.drop(n);
    expect(r.kind).toBe("r2guess");
    expect(r.d.options.length).toBeGreaterThanOrEqual(4);
    expect(r.d.options.filter((o: any) => !o.real).every((o: any) => o.house)).toBe(true);
  });
  test("each player gets exactly one turn; round ends with the Round 3 rules card", () => {
    const r = R2(4); const seen: string[] = [];
    while (r.kind !== "rules") {
      if (r.kind === "r2pick") { seen.push(r.d.hot); r.do(r.d.hot, { type: "r2.tile", tile: realTile(r) }); }
      else if (r.kind === "r2write") writeAll(r);
      else if (r.kind === "r2guess") r.do(r.d.hot, { type: "r2.pick", option: realIdx(r) });
      else r.expire();
    }
    expect([...seen].sort()).toEqual(r.names().sort());
    expect(r.d.next).toBe("r3");
  });
});

/* ================================================================== 15-17 ROUND 3 */
describe("15-17 Round 3", () => {
  const R3 = () => {
    const r = Room.started(4);
    playUntil(r, "rules", mulberry(5)); // first rules card is R1; run to the R3 one
    while (!(r.kind === "rules" && r.d.next === "r3")) step(r, mulberry(r.s.phase.id));
    r.skipRules();
    expect(r.kind).toBe("r3wager");
    for (const n of r.names()) r.p(n).score = 100;
    return r;
  };
  const correct = (r: Room) => r.s.game.r3.ps[r.s.game.r3.cur.pid].name;
  test("slider steps of 5%, default 25%; the timer submits the current slider value", () => {
    const r = R3();
    r.do("Aarav", { type: "r3.slider", pct: 50 });
    r.do("Bina", { type: "r3.lock", pct: 12 }); // rounds to 10
    expect(r.s.game.r3.cur.wagers["Bina"].amt).toBe(10);
    r.expire();
    expect(r.s.game.r3.cur.wagers["Aarav"].amt).toBe(50);
    expect(r.s.game.r3.cur.wagers["Chirag"].amt).toBe(25);
    expect(r.kind).toBe("r3hint");
  });
  test("wager can never exceed the score; out-of-range values are refused", () => {
    const r = R3();
    r.do("Aarav", { type: "r3.lock", pct: 150 }); r.do("Aarav", { type: "r3.lock", pct: -5 }); r.do("Aarav", { type: "r3.lock", pct: NaN });
    expect(r.s.game.r3.cur.wagers["Aarav"]).toBeUndefined();
    r.do("Aarav", { type: "r3.lock", pct: 100 });
    expect(r.s.game.r3.cur.wagers["Aarav"].amt).toBe(100);
  });
  test("secrets: later hints and other players' wagers never reach a phone before the reveal", () => {
    const r = R3(); for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 50 });
    const v: any = viewFor(r.s, "Aarav");
    expect(v.data.hints).toHaveLength(1);
    const text = JSON.stringify(v);
    expect(text).not.toContain("hint 2 for");
    expect(text).not.toContain(correct(r));
    expect(v.data.wager.amt).toBe(50);
    expect(JSON.stringify((viewFor(r.s, "Bina") as any).data)).not.toMatch(/"Aarav"/);
  });
  test("payouts: hint 1-2 x1.5, hint 3-4 x1.0, hint 5 x0.5, unsolved -1.0; first solver +10", () => {
    const r = R3();
    for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 50 }); // wager 50 each, score 100
    const ans = correct(r);
    r.do("Aarav", { type: "r3.guess", name: ans });          // hint 1 -> +75, first solver +10
    for (const n of ["Bina", "Chirag", "Divya"]) r.do(n, { type: "r3.pass" });
    expect(r.s.game.r3.cur.hint).toBe(2);
    for (const n of ["Bina", "Chirag", "Divya"]) r.do(n, { type: "r3.pass" });
    expect(r.s.game.r3.cur.hint).toBe(3);
    r.do("Chirag", { type: "r3.guess", name: ans });         // hint 3 -> +50
    for (const n of ["Bina", "Divya"]) r.do(n, { type: "r3.pass" });
    for (const n of ["Bina", "Divya"]) r.do(n, { type: "r3.pass" }); // hint 4
    expect(r.s.game.r3.cur.hint).toBe(5);
    r.do("Divya", { type: "r3.guess", name: ans });          // hint 5 -> +25
    r.do("Bina", { type: "r3.pass" });                       // unsolved -> -50
    expect(r.kind).toBe("r3reveal");
    expect(r.score("Aarav")).toBe(100 + 75 + 10);
    expect(r.score("Chirag")).toBe(150);
    expect(r.score("Divya")).toBe(125);
    expect(r.score("Bina")).toBe(50);
  });
  test("3 guesses in total; a guess is private right/wrong; names must come from the dropdown list", () => {
    const r = R3(); for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 0 });
    r.fx = [];
    r.do("Aarav", { type: "r3.guess", name: "Not In The List" });
    expect(r.fx.some((e: any) => e.t === "send" && e.msg.code === "not_in_list")).toBe(true);
    expect(r.s.game.r3.cur.st["Aarav"].tries).toBe(0);
    const wrong = CONTENT.names.find((n) => n !== correct(r))!;
    r.do("Aarav", { type: "r3.guess", name: wrong });
    expect(r.fx.find((e: any) => e.t === "send" && e.msg.type === "guessResult")).toMatchObject({ to: "Aarav", msg: { correct: false, triesLeft: 2 } });
    for (const n of ["Bina", "Chirag", "Divya"]) r.do(n, { type: "r3.pass" });
    r.do("Aarav", { type: "r3.guess", name: wrong });
    for (const n of ["Bina", "Chirag", "Divya"]) r.do(n, { type: "r3.pass" });
    r.do("Aarav", { type: "r3.guess", name: wrong });
    expect(r.s.game.r3.cur.st["Aarav"].tries).toBe(3);
    for (const n of ["Bina", "Chirag", "Divya"]) r.do(n, { type: "r3.pass" });
    r.do("Aarav", { type: "r3.guess", name: wrong }); // out of tries
    expect(r.s.game.r3.cur.st["Aarav"].tries).toBe(3);
  });
  test("alias answers are accepted", () => {
    const r = R3(); for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 0 });
    const pr = r.s.game.r3.ps[r.s.game.r3.cur.pid];
    CONTENT.names.push(pr.aliases![0]); // dropdown accepts aliases
    r.do("Aarav", { type: "r3.guess", name: pr.aliases![0] });
    expect(r.s.game.r3.cur.st["Aarav"].solvedAt).toBe(1);
  });
  test("pass can be undone until everyone is ready; a locked guess cannot", () => {
    const r = R3(); for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 0 });
    r.do("Aarav", { type: "r3.pass" }); r.do("Aarav", { type: "r3.unpass" });
    expect(r.s.game.r3.cur.st["Aarav"].acted).toBe(false);
    r.do("Aarav", { type: "r3.guess", name: CONTENT.names.find((n) => n !== correct(r))! });
    r.do("Aarav", { type: "r3.unpass" });
    expect(r.s.game.r3.cur.st["Aarav"].acted).toBe(true);
  });
  test("zero-point player gets a free-roll wager of 20: a win pays out, a loss costs nothing", () => {
    const r = R3(); r.p("Aarav").score = 0; r.p("Bina").score = 0;
    for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 50 });
    expect(r.s.game.r3.cur.wagers["Aarav"]).toMatchObject({ amt: 20, free: true });
    r.do("Aarav", { type: "r3.guess", name: correct(r) }); // wins x1.5 = +30 (+10 first)
    for (const n of ["Bina", "Chirag", "Divya"]) r.do(n, { type: "r3.pass" });
    while (r.kind === "r3hint") for (const n of r.names()) if (r.elig().includes(n)) r.do(n, { type: "r3.pass" });
    expect(r.score("Aarav")).toBe(40);
    expect(r.score("Bina")).toBe(0); // free-roll loss costs nothing
  });
  test("wager voided if the player is greyed at resolution; they keep their points", () => {
    const r = R3(); for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 50 });
    r.drop("Bina");
    while (r.kind === "r3hint") for (const n of r.names()) if (r.elig().includes(n)) r.do(n, { type: "r3.pass" });
    expect(r.score("Bina")).toBe(100);
    expect(r.d.rows.find((x: any) => x.name === "Bina").voided).toBe(true);
  });
  test("a player who missed the wager phase sits that personality out (no gain, no loss)", () => {
    const r = R3(); r.drop("Bina"); // greyed during wager: never submitted
    r.expire();
    r.join("Bina");
    while (r.kind === "r3hint") for (const n of r.names()) if (r.elig().includes(n)) r.do(n, { type: "r3.pass" });
    expect(r.d.rows.find((x: any) => x.name === "Bina")).toBeUndefined();
    expect(r.score("Bina")).toBe(100);
  });
  test("if everyone is done (all solved / out of tries / passed to the end) the remaining hints are skipped", () => {
    const r = R3(); for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 0 });
    for (const n of r.names()) r.do(n, { type: "r3.guess", name: correct(r) });
    expect(r.kind).toBe("r3reveal");
  });
  test("two personalities, then the final podium with shared ranks for ties", () => {
    const r = R3();
    for (let i = 0; i < 2; i++) {
      expect(r.kind).toBe("r3wager");
      for (const n of r.names()) r.do(n, { type: "r3.lock", pct: 0 });
      for (const n of r.names()) r.do(n, { type: "r3.guess", name: correct(r) });
      expect(r.kind).toBe("r3reveal"); r.expire();
    }
    expect(r.kind).toBe("podium");
    const ranks = r.d.ranks;
    // Aarav solved first both times (+20 total); the other three are tied and share rank 2
    expect(ranks.map((x: any) => [x.name, x.rank])).toEqual([["Aarav", 1], ["Bina", 2], ["Chirag", 2], ["Divya", 2]]);
  });
});

/* ================================================================== 18-19 PODIUM / POST-GAME */
describe("18-19 Podium and Play Again", () => {
  const toPost = () => { const r = Room.started(4); playUntil(r, "postgame", mulberry(11)); return r; };
  test("Play Again keeps the same room and players, resets scores, keeps the used-question list", () => {
    const r = toPost();
    const used = r.s.usedQ.length;
    expect(used).toBeGreaterThanOrEqual(8);
    for (const n of r.names()) r.do(n, { type: "again" });
    expect(r.kind).toBe("lobby");
    expect(r.s.code).toBe("TEST");
    expect(r.names()).toHaveLength(4);
    expect(r.names().every((n) => r.score(n) === 0)).toBe(true);
    expect(r.s.usedQ.length).toBe(used);
  });
  test("Leave removes the player; spectators are seated for the next game", () => {
    const r = Room.started(4); r.join("Spec"); playUntil(r, "postgame", mulberry(12));
    expect(r.p("Spec").seated).toBe(false);
    r.do("Aarav", { type: "leave" });
    for (const n of ["Bina", "Chirag", "Divya"]) r.do(n, { type: "again" });
    expect(r.kind).toBe("lobby");
    expect(r.s.players.find((p) => p.name === "Aarav")).toBeUndefined();
    expect(r.p("Spec").seated).toBe(true);
  });
  test("the second game never repeats questions from the first (room remembers)", () => {
    const r = toPost(); const first = new Set(r.s.game.gameUsedQ);
    for (const n of r.names()) r.do(n, { type: "again" });
    r.do("Aarav", { type: "start" });
    r.skipRules();
    const second = new Set<string>(); second.add(r.d.qid);
    expect(first.has(r.d.qid)).toBe(false);
  });
  test("greyed players stay on the roster after the game (kept 5 minutes)", () => {
    const r = toPost(); r.drop("Divya");
    for (const n of ["Aarav", "Bina", "Chirag"]) r.do(n, { type: "again" });
    expect(r.kind).toBe("lobby");
    expect(r.p("Divya").seated).toBe(true);
  });
});

/* ================================================================== SERVER-LEVEL FAILURE CASES */
describe("Failure cases", () => {
  test("6 (failure 6): everyone disconnects: state is held, timers frozen, storage wiped 30 min later", () => {
    const r = Room.started(3); r.skipRules();
    const phase = r.s.phase.id;
    for (const n of r.names()) r.drop(n);
    expect(r.s.frozen).toBe(true);
    expect(r.s.phase.deadline).toBeNull();
    r.tick(29 * 60_000);
    expect(r.s.closed).toBe(false);
    expect(r.s.phase.id).toBe(phase);
    r.tick(2 * 60_000);
    expect(r.s.closed).toBe(true);
    expect(r.fx.some((e) => e.t === "wipe")).toBe(true);
  });
  test("everyone gone then a player returns: the phase resumes with a fresh full timer", () => {
    const r = Room.started(3); r.skipRules();
    const full = r.s.phase.dur;
    for (const n of r.names()) r.drop(n);
    r.tick(10 * 60_000);
    r.join("Bina");
    expect(r.s.frozen).toBe(false);
    expect(r.s.phase.deadline).toBe(r.t + full);
    expect(r.s.emptySince).toBeNull();
  });
  test("one player left connected: the game continues (never blocks) with a waiting banner", () => {
    const r = Room.started(3); r.skipRules(); r.drop("Bina"); r.drop("Chirag");
    expect((viewFor(r.s, "Aarav") as any).phase.waiting).toBe(true);
    r.do("Aarav", { type: "r1.select", check: 0, bomb: null }); r.do("Aarav", { type: "r1.lock" });
    expect(r.kind).toBe("r1reveal");
  });
  test("7 (failure 7): rejoin mid-phase gives the current phase view without secrets", () => {
    const r = Room.started(4); r.skipRules(); r.drop("Chirag"); r.join("Chirag");
    const v = JSON.stringify(viewFor(r.s, "Chirag"));
    expect(v).not.toContain("isTrue");
    expect((viewFor(r.s, "Chirag") as any).phase.kind).toBe("r1q");
  });
  test("11 (failure 11): eviction mid-phase: JSON snapshot restores and the stored deadline re-arms the alarm", () => {
    const r = Room.started(4); r.skipRules();
    r.do("Aarav", { type: "r1.select", check: 0, bomb: 1 }); r.do("Aarav", { type: "r1.lock" });
    const snap = JSON.parse(JSON.stringify(r.s));
    r.s = snap;
    expect(r.s.alarmAt).toBe(r.s.phase.deadline);
    expect(r.d.sel["Aarav"].locked).toBe(true);
    r.expire();
    expect(r.kind).toBe("r1reveal");
  });
  test("11b: identical seed + identical events = identical game (the engine is deterministic)", () => {
    const run = () => { const r = Room.started(4, 42); playUntil(r, "postgame", mulberry(99)); return JSON.stringify(r.s.players.map((p) => [p.name, p.score])); };
    expect(run()).toBe(run());
  });
  test("10 (failure 10): content pool exhausted: used list resets when <15 left, never repeats inside a game", () => {
    const small = makeContent(20, 12);
    const r = new Room(3, small);
    ["Aarav", "Bina", "Chirag", "Divya"].forEach((n) => r.join(n));
    r.s.usedQ = small.questions.slice(0, 10).map((q) => q.id); // only 10 unused (<15)
    r.do("Aarav", { type: "start" }); r.skipRules();
    const ids = new Set(r.s.game.r1.ids);
    expect(ids.size).toBe(4);
    expect(r.s.usedQ.length).toBeLessThanOrEqual(4 + 0); // list was reset, then filled with this game's picks
  });
  test("a game of 8 needs 12 questions and never repeats one", () => {
    const r = Room.started(8, 5); playUntil(r, "r3wager", mulberry(2));
    const ids = [...r.s.game.r1.ids, ...r.s.game.r2.tiles.filter((t) => t.qid).map((t) => t.qid!)];
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });
  test("save effects: only phase changes and lock-ins; never on selection drafts or disconnects", () => {
    const r = Room.started(4); r.skipRules(); r.fx = [];
    r.do("Aarav", { type: "r1.select", check: 0, bomb: 1 });
    r.drop("Bina");
    expect(r.fxOf("save")).toHaveLength(0);
    r.do("Aarav", { type: "r1.lock" });
    expect(r.fxOf("save")).toHaveLength(1);
  });
  test("alarm effects are only emitted when the next deadline actually changes", () => {
    const r = Room.started(4); r.skipRules(); r.fx = [];
    r.do("Aarav", { type: "r1.select", check: 0, bomb: 1 });
    expect(r.fxOf("alarm")).toHaveLength(0);
  });
});
