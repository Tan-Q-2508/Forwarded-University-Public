/* eslint-disable @typescript-eslint/no-explicit-any */
// TEST BOTS. Players that join, leave and rejoin at random moments, tap at random, send junk and stale
// messages, and sometimes ALL vanish. Every game must still finish, and invariants hold after every event.
import { describe, expect, test } from "vitest";
import { nextAlarm, eligible } from "../src/engine/engine";
import type { Intent } from "../src/engine/types";
import { viewFor } from "../src/engine/view";
import { Room, brain, mulberry, type Rnd } from "./helpers";

const NAMES = ["Aarav", "Bina", "Chirag", "Divya", "Esha", "Farhan", "Gita", "Hari"];

function invariants(r: Room, lastPhaseId: { v: number }) {
  const s = r.s;
  // identity + scores
  const keys = s.players.map((p) => p.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const p of s.players) { expect(Number.isInteger(p.score)).toBe(true); expect(p.score).toBeGreaterThanOrEqual(0); }
  expect(s.players.filter((p) => p.seated).length).toBeLessThanOrEqual(8);
  // phase ids only go forward
  expect(s.phase.id).toBeGreaterThanOrEqual(lastPhaseId.v);
  lastPhaseId.v = s.phase.id;
  // frozen <=> nobody seated is connected (for timed phases)
  const connected = s.players.filter((p) => p.seated && p.connected).length;
  if (s.frozen) expect(connected).toBe(0);
  if (!s.frozen && s.phase.dur > 0) expect(s.phase.deadline).not.toBeNull();
  // the host's alarm always matches what the state needs
  if (!s.closed) expect(s.alarmAt).toBe(nextAlarm(s));
  // a live interactive phase never sits with nobody eligible (that is exit (c)); the hot-seat grace is the one allowed wait
  const k = s.phase.kind;
  const hotWait = (k === "r2write" || k === "r2guess") && !s.players.find((p) => p.name === s.phase.d.hot)?.connected;
  if (!s.frozen && !hotWait && ["rules", "r1q", "r1lore", "ixPick", "r2pick", "r2write", "r2guess", "r2vote", "r3wager", "r3hint", "postgame"].includes(k))
    expect(eligible(s).length, `stuck with nobody eligible in ${k}`).toBeGreaterThan(0);
  if (hotWait && !s.frozen) expect(s.phase.graceAt).not.toBeNull();
  // secrets never leave early
  for (const n of [...NAMES.slice(0, 3), "Stranger"]) {
    const txt = JSON.stringify(viewFor(s, n));
    if (k !== "r1reveal") expect(txt).not.toContain("isTrue");
    if (k === "r2guess" || k === "r2write") { expect(txt).not.toContain('"authors"'); }
    if (k === "r3hint" || k === "r3wager") expect(txt).not.toContain('"hints":[' + '"hint 1 for' + '","');
  }
}

const junk = (rnd: Rnd): Intent => {
  const pool: any[] = [
    { type: "r1.select", check: NaN, bomb: "x" }, { type: "r2.write", text: 12345 }, { type: "r2.write", text: "💣".repeat(5000) },
    { type: "r3.lock", pct: Infinity }, { type: "r3.guess", name: null }, { type: "nope" }, null, undefined, { type: "r2.tile", tile: -3 },
    { type: "ix.pick", box: 7 }, { type: "r2.vote", option: 1e9 }, { type: "start" }, { type: "r3.slider", pct: "50" },
  ];
  return pool[Math.floor(rnd() * pool.length)];
};

function chaos(seed: number, n: number, opts: { chaosSteps: number; max: number; allVanish?: boolean }) {
  const rnd = mulberry(seed * 7919 + n);
  const r = new Room(seed);
  const last = { v: 0 };
  NAMES.slice(0, n).forEach((x) => r.join(x));
  r.do("Aarav", { type: "start" });
  let podiumSeen = false, finished = false, joinedStranger = 0;
  const names = NAMES.slice(0, n);
  for (let i = 0; i < opts.max && !finished; i++) {
    const calm = i >= opts.chaosSteps;
    const x = rnd();
    const who = names[Math.floor(rnd() * names.length)];
    const p = r.p(who);
    if (calm && !p.connected) r.join(who); // calm mode: everyone is back and stays
    if (!calm && x < 0.10) { if (p.connected) r.drop(who); }
    else if (!calm && x < 0.22) { if (!p.connected) r.join(who); else if (rnd() < 0.3) r.join(who, undefined); } // rejoin / duplicate name
    else if (!calm && x < 0.25) { r.join("Stranger" + (joinedStranger++ % 5)); }
    else if (!calm && x < 0.30) { r.do(who, junk(rnd)); }
    else if (!calm && x < 0.34) { r.do(who, { type: "r1.lock" }, r.s.phase.id - 1); } // stale phase id
    else if (!calm && opts.allVanish && x < 0.345) { names.forEach((m) => r.p(m).connected && r.drop(m)); }
    else if (x < 0.72) { for (const intent of brain(r, who, rnd)) r.do(who, intent); }
    else if (x < 0.86 || calm) { if (r.s.phase.deadline !== null && rnd() < 0.5) r.expire(); else r.tick(Math.floor(rnd() * 8000)); }
    else if (r.s.phase.deadline !== null) r.expire();
    invariants(r, last);
    if (r.kind === "podium") podiumSeen = true;
    if (podiumSeen && (r.kind === "postgame" || r.kind === "lobby")) finished = true;
  }
  return { r, finished };
}

describe("test bots: random leave / rejoin / junk at random moments", () => {
  for (const n of [3, 4, 5, 6, 7, 8]) {
    test(`${n} players: 25 seeds always finish a full game`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const { r, finished } = chaos(seed, n, { chaosSteps: 1500, max: 9000 });
        expect(finished, `seed ${seed}, n=${n}: stuck in ${r.kind}`).toBe(true);
      }
    });
  }
  test("everyone vanishing at random moments never wedges the room", () => {
    for (let seed = 100; seed < 130; seed++) {
      const { r, finished } = chaos(seed, 4, { chaosSteps: 1500, max: 12000, allVanish: true });
      expect(finished, `seed ${seed}: stuck in ${r.kind}`).toBe(true);
    }
  });
  test("only 3 players and 1 leaves for good: the game still finishes (never blocks)", () => {
    const r = new Room(5);
    ["Aarav", "Bina", "Chirag"].forEach((x) => r.join(x));
    r.do("Aarav", { type: "start" });
    r.drop("Chirag");
    const rnd = mulberry(5);
    for (let i = 0; i < 4000 && r.kind !== "postgame"; i++) {
      for (const n of ["Aarav", "Bina"]) for (const it of brain(r, n, rnd)) r.do(n, it);
      if (r.s.phase.deadline !== null) r.expire();
    }
    expect(r.kind).toBe("postgame");
  });
});

describe("liveness: with NO input at all, every phase still ends by its deadline", () => {
  test("a connected room with silent players walks the whole game by timers alone", () => {
    for (const n of [3, 5, 8]) {
      const r = new Room(n);
      NAMES.slice(0, n).forEach((x) => r.join(x));
      r.do("Aarav", { type: "start" });
      let guard = 0;
      while (r.kind !== "postgame" && guard++ < 400) r.expire();
      expect(r.kind, `n=${n}`).toBe("postgame");
      expect(guard).toBeLessThan(200);
    }
  });
  test("an abandoned postgame returns to the lobby on its own and the room can be wiped later", () => {
    const r = new Room(1);
    NAMES.slice(0, 3).forEach((x) => r.join(x));
    r.do("Aarav", { type: "start" });
    for (let i = 0; i < 400 && r.kind !== "postgame"; i++) r.expire();
    r.expire();
    expect(r.kind).toBe("lobby");
    NAMES.slice(0, 3).forEach((x) => r.drop(x));
    r.tick(31 * 60_000);
    expect(r.s.closed).toBe(true);
  });
});
