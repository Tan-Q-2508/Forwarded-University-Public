// TEST FIXTURES ONLY. Synthetic content so the engine can be exercised. Never imported by production code.
import { type State, type Event, type Intent, type ContentPack, type QuestionLite, type Effect } from "../src/engine/types";
import { newRoom, reduce, eligible } from "../src/engine/engine";
import { makeContent } from "../src/engine/devContent";
export { makeContent };

export const CONTENT = makeContent();
export const ctx = { content: CONTENT };

/** A tiny harness: a room, a clock, per-player seq counters. */
export class Room {
  s: State;
  t = 1_000_000;
  fx: Effect[] = [];
  seq: Record<string, number> = {};
  constructor(seed = 1, public content = CONTENT) { this.s = newRoom("TEST", seed, this.t); }
  ev(e: Event) { const r = reduce(this.s, e, { content: this.content }); this.s = r.state; this.fx.push(...r.effects); return r; }
  join(name: string, token?: string) { return this.ev({ type: "join", at: this.t, name, token, conn: name }); }
  drop(name: string) { return this.ev({ type: "disconnect", at: this.t, name }); }
  /** send an intent using the CURRENT phase id (the normal, valid case) */
  do(name: string, intent: Intent, phaseId = this.s.phase.id) {
    this.seq[name] = (this.seq[name] ?? 0) + 1;
    return this.ev({ type: "intent", at: this.t, name, phaseId, seq: this.seq[name], intent });
  }
  tick(ms: number) { this.t += ms; return this.ev({ type: "alarm", at: this.t }); }
  /** jump the clock to the phase deadline and fire the alarm */
  expire() { const d = this.s.phase.deadline; if (d === null) throw new Error("no deadline in " + this.s.phase.kind); this.t = Math.max(this.t, d); return this.ev({ type: "alarm", at: this.t }); }
  get kind() { return this.s.phase.kind; }
  get d() { return this.s.phase.d; }
  p(name: string) { return this.s.players.find((p) => p.name === name)!; }
  score(name: string) { return this.p(name).score; }
  elig() { return eligible(this.s); }
  fxOf(t: Effect["t"]) { return this.fx.filter((e) => e.t === t); }
  /** lobby with n players, game started, sitting on the first rules card */
  static started(n = 4, seed = 1): Room {
    const r = new Room(seed);
    const names = ["Aarav", "Bina", "Chirag", "Divya", "Esha", "Farhan", "Gita", "Hari"].slice(0, n);
    names.forEach((x) => r.join(x));
    r.do("Aarav", { type: "start" });
    return r;
  }
  names() { return this.s.players.filter((p) => p.seated).map((p) => p.name); }
  /** everyone skips the rules card */
  skipRules() { for (const n of this.names()) if (this.kind === "rules") this.do(n, { type: "skip" }); }
}

/* ------------------------------------------------------------------ simple client brain (reads ONLY the player's view) */
import { viewFor } from "../src/engine/view";

export interface Rnd { (): number }
export function mulberry(seed: number): Rnd {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** What a sensible client would send now. May return several intents (select then lock). */
export function brain(r: Room, name: string, rnd: Rnd): Intent[] {
  const v: any = viewFor(r.s, name);
  const d = v.data;
  const ri = (n: number) => Math.floor(rnd() * n);
  switch (v.phase.kind) {
    case "rules": return [{ type: "skip" }];
    case "r1q": {
      if (d.mine.locked) return [];
      const n = d.options.length, c = ri(n);
      let b: number | null = ri(n); if (b === c) b = null;
      return [{ type: "r1.select", check: c, bomb: b }, { type: "r1.lock" }];
    }
    case "r1lore": return [{ type: "next" }];
    case "ixPick": return d.underdog === name && !d.picked ? [{ type: "ix.pick", box: ri(3) }] : [];
    case "r2pick": {
      if (d.hot !== name) return [];
      const free = d.tiles.map((t: any, i: number) => (t.taken ? -1 : i)).filter((i: number) => i >= 0);
      return free.length ? [{ type: "r2.tile", tile: free[ri(free.length)] }] : [];
    }
    case "r2write": {
      if (name === d.hot || d.submitted) return [];
      const x = rnd();
      if (x < 0.15) return [{ type: "r2.write", text: d.real ?? "x" }, { type: "r2.write", text: d.real ?? "x" }, { type: "r2.preset" }];
      if (x < 0.25) return [{ type: "r2.preset" }];
      return [{ type: "r2.write", text: `Fake ${ri(4)} by ${name}` }];
    }
    case "r2guess": {
      if (d.hot !== name) return [];
      const free = d.options.map((_: any, i: number) => (d.eliminated.includes(i) ? -1 : i)).filter((i: number) => i >= 0);
      return [{ type: "r2.pick", option: free[ri(free.length)] }];
    }
    case "r2vote": {
      if (!d.canVote) return [];
      const free = d.options.map((_: any, i: number) => (d.own.includes(i) ? -1 : i)).filter((i: number) => i >= 0);
      return free.length ? [{ type: "r2.vote", option: free[ri(free.length)] }] : [];
    }
    case "r3wager": return d.locked ? [] : [{ type: "r3.slider", pct: ri(21) * 5 }, { type: "r3.lock", pct: ri(21) * 5 }];
    case "r3hint": {
      if (!d.mine || d.mine.solved || d.mine.acted || d.mine.triesLeft <= 0) return [];
      if (rnd() < 0.5) return [{ type: "r3.pass" }];
      const names = r.content.names;
      return [{ type: "r3.guess", name: names[ri(names.length)] }];
    }
    case "postgame": return [{ type: "again" }];
    default: return [];
  }
}

/** One round of "everyone connected acts once" then, if the phase did not move, let the timer run out. */
export function step(r: Room, rnd: Rnd) {
  const before = r.s.phase.id;
  for (const p of r.s.players.filter((x) => x.connected && x.seated)) {
    if (r.s.phase.id !== before) break;
    for (const i of brain(r, p.name, rnd)) { if (r.s.phase.id !== before) break; r.do(p.name, i); }
  }
  if (r.s.phase.id === before && r.s.phase.deadline !== null) r.expire();
}
export function playUntil(r: Room, kind: string, rnd: Rnd = mulberry(7), max = 3000) {
  for (let i = 0; i < max && r.kind !== kind; i++) step(r, rnd);
  if (r.kind !== kind) throw new Error(`never reached ${kind}, stuck in ${r.kind}`);
}

/* ---- shared scenario helpers: Round 1 done, interlude, round 2 start */
export function reachIx(r: Room, scores?: Record<string, number>) {
  r.skipRules();
  for (let q = 0; q < 4; q++) {
    for (const n of r.names()) { r.do(n, { type: "r1.select", check: 0, bomb: null }); r.do(n, { type: "r1.lock" }); }
    r.expire();
    if (q === 3 && scores) for (const [n, v] of Object.entries(scores)) r.p(n).score = v;
    for (const n of r.names()) r.do(n, { type: "next" });
  }
}
export function reachR2Box(r: Room, kind: "A" | "B" | "C", scores?: Record<string, number>) {
  reachIx(r, scores);
  r.s.phase.d.boxes = kind === "A" ? ["A", "B", "C"] : kind === "B" ? ["B", "A", "C"] : ["C", "A", "B"];
  r.do(r.d.underdog, { type: "ix.pick", box: 0 });
  r.expire();
  r.skipRules();
}
