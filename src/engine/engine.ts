/* eslint-disable @typescript-eslint/no-explicit-any */
// The pure game engine: reduce(state, event, ctx) -> { state, effects }.
// Effects are only: broadcast, send, reply, alarm, save, wipe, crowdFake. No clock, no I/O, seeded RNG only.
import { pick, rand, randInt, shuffle } from "./rng";
import { pickPersonalities, pickQuestions } from "./select";
import { LIMITS, formatOption, isBlocked, norm, sanitize, tooSimilar, validName } from "./text";
import type { Ctx, Curse, Effect, Event, Intent, PersonalityLite, PhaseKind, Player, State } from "./types";

export const TIMERS: Partial<Record<PhaseKind, number>> = {
  rules: 15_000, r1q: 90_000, r1reveal: 8_000, r1lore: 45_000,
  ixPick: 150_000, ixResult: 5_000,
  r2pick: 20_000, r2write: 60_000, r2guess: 30_000, r2reveal: 5_000, r2vote: 12_000, r2end: 3_000,
  r3wager: 60_000, r3hint: 45_000, r3reveal: 8_000, podium: 10_000, postgame: 90_000,
};
export const K = {
  maxPlayers: 8, maxSpectators: 12, minToStart: 3,
  r1Correct: 10, bombPerVictim: 10, bombCap: 40,
  boxA: 25, boxCFlat: 10, boxCNow: 1, bounty: 30, snitchReward: 15,
  garbage: 20, hotTry1: 25, hotTry2: 10, fool: 20, funny: 10, firstSolve: 10,
  hotGraceMs: 10_000, snitchWindowMs: 5_000, snitchCooldownMs: 15_000,
  emptyWipeMs: 30 * 60_000, greyKeepMs: 5 * 60_000, maxFakes: 8, minOptions: 4,
  r3Mult: [1.5, 1.5, 1, 1, 0.5], r3Tries: 3, freeRoll: 20, defaultPct: 25,
};

const INTERACTIVE = new Set<PhaseKind>(["rules", "r1q", "r1lore", "ixPick", "r2pick", "r2write", "r2guess", "r2vote", "r3wager", "r3hint", "postgame"]);

/* ------------------------------------------------------------------ helpers */
const find = (s: State, name: string) => s.players.find((p) => p.key === name.toLowerCase());
const seated = (s: State) => s.players.filter((p) => p.seated);
const connSeated = (s: State) => seated(s).filter((p) => p.connected);
const isConn = (s: State, name: string | null | undefined) => !!name && !!find(s, name)?.connected;
const inRoster = (s: State, name: string) => !!find(s, name)?.seated;

function add(s: State, name: string, n: number, deltas?: Record<string, number>) {
  const p = find(s, name);
  if (!p || !n) return;
  p.score = Math.max(0, p.score + n);
  if (deltas) deltas[p.name] = (deltas[p.name] ?? 0) + n;
}

export function newRoom(code: string, seed: number, now: number): State {
  return {
    v: 1, code, rng: seed | 0, now, players: [], owner: null, curses: true,
    phase: { kind: "lobby", id: 1, dur: 0, deadline: null, graceAt: null, done: [], d: { ready: [] } },
    phaseCounter: 1, seq: 0, frozen: false, emptySince: now, closed: false, alarmAt: null,
    usedQ: [], usedP: [], gameNo: 0, game: emptyGame(), dirtySave: true,
  };
}
function emptyGame(): State["game"] {
  return {
    gameUsedQ: [], qs: {}, r1: { ids: [], qi: 0 },
    r2: { order: [], turn: 0, tiles: [], garbageUsed: false },
    r3: { ids: [], idx: 0, ps: {}, cur: null },
    ix: { underdog: null, dealer: null, vip: null }, curse: null,
  };
}

function enter(s: State, kind: PhaseKind, d: any = {}, dur: number | undefined = TIMERS[kind] ?? 0) {
  closeWindow(s);
  s.phaseCounter++;
  s.phase = { kind, id: s.phaseCounter, dur: dur ?? 0, deadline: dur ? s.now + dur : null, graceAt: null, done: [], d };
  s.frozen = false;
  s.dirtySave = true;
  if ((kind === "r2write" || kind === "r2guess") && !isConn(s, d.hot)) s.phase.graceAt = s.now + K.hotGraceMs;
}

/* ------------------------------------------------------------------ eligibility */
export function eligible(s: State): string[] {
  const ph = s.phase, d = ph.d;
  const cs = connSeated(s).map((p) => p.name);
  const notDone = (a: string[]) => a.filter((n) => !ph.done.includes(n));
  switch (ph.kind) {
    case "rules": case "r1lore": case "r3wager": case "postgame": return notDone(cs);
    case "r1q": return cs.filter((n) => !d.sel[n]?.locked);
    case "ixPick": return d.picked === null && isConn(s, d.underdog) ? [d.underdog] : [];
    case "r2pick": return !d.chosen && isConn(s, d.hot) ? [d.hot] : [];
    case "r2write": return cs.filter((n) => n !== d.hot && !d.authors[n]);
    case "r2guess": return d.pick === null && isConn(s, d.hot) ? [d.hot] : [];
    case "r2vote": return cs.filter((n) => d.voters.includes(n) && d.votes[n] === undefined);
    case "r3hint": return cs.filter((n) => { const t = s.game.r3.cur.st[n]; return t && t.solvedAt === null && t.tries < K.r3Tries && !t.acted; });
    default: return [];
  }
}
/** For the "3/5 Ready" counter. */
export function readyCount(s: State): { done: number; total: number } {
  if (!INTERACTIVE.has(s.phase.kind)) return { done: 0, total: 0 };
  const total = connSeated(s).length;
  const k = s.phase.kind;
  if (k === "r2write") { const w = connSeated(s).filter((p) => p.name !== s.phase.d.hot).length; return { done: w - eligible(s).length, total: w }; }
  if (k === "r2pick" || k === "r2guess" || k === "ixPick") return { done: 0, total: 1 };
  return { done: Math.max(0, total - eligible(s).length), total };
}

/* ------------------------------------------------------------------ freeze / alarms */
function refreshFreeze(s: State) {
  const ph = s.phase;
  const timed = ph.dur > 0;
  const active = connSeated(s).length > 0;
  if (timed && !active && !s.frozen) { s.frozen = true; ph.deadline = null; ph.graceAt = null; }
  else if (s.frozen && (active || !timed)) {
    s.frozen = false;
    if (timed) ph.deadline = s.now + ph.dur;
    if ((ph.kind === "r2write" || ph.kind === "r2guess") && !isConn(s, ph.d.hot)) ph.graceAt = s.now + K.hotGraceMs;
  }
}
export function nextAlarm(s: State): number | null {
  if (s.closed) return null;
  const c: number[] = [];
  if (s.phase.deadline !== null) c.push(s.phase.deadline);
  if (s.phase.graceAt !== null) c.push(s.phase.graceAt);
  const w = s.game.curse?.window;
  if (w) c.push(w.until);
  if (s.emptySince !== null) c.push(s.emptySince + K.emptyWipeMs);
  return c.length ? Math.min(...c) : null;
}

/* ------------------------------------------------------------------ reducer */
export function reduce(prev: State, ev: Event, ctx: Ctx): { state: State; effects: Effect[] } {
  if (prev.closed) return { state: prev, effects: [] };
  const s: State = structuredClone(prev);
  const fx: Effect[] = [];
  s.now = Math.max(s.now, ev.at);
  s.dirtySave = false;
  let changed = false;

  switch (ev.type) {
    case "join": changed = onJoin(s, ev, fx); break;
    case "disconnect": changed = onDisconnect(s, ev.name); break;
    case "intent": changed = onIntent(s, ev, fx, ctx); break;
    case "alarm": changed = onAlarm(s, fx, ctx); break;
  }
  if (!changed) return { state: prev, effects: fx };

  settle(s, ctx, fx);
  fixOwner(s);
  s.seq++;
  if (s.closed) { fx.push({ t: "wipe" }, { t: "alarm", at: null }); s.alarmAt = null; return { state: s, effects: fx }; }
  if (s.dirtySave) fx.push({ t: "save" });
  fx.push({ t: "broadcast" });
  const at = nextAlarm(s);
  if (at !== s.alarmAt) { s.alarmAt = at; fx.push({ t: "alarm", at }); }
  return { state: s, effects: fx };
}

function settle(s: State, ctx: Ctx, fx: Effect[]) {
  for (let i = 0; i < 80; i++) {
    fixSnitchTarget(s);
    refreshFreeze(s);
    if (s.frozen) return;
    const k = s.phase.kind;
    if (!INTERACTIVE.has(k)) return;
    if ((k === "r2write" || k === "r2guess") && !isConn(s, s.phase.d.hot)) return; // waiting for grace alarm
    if (eligible(s).length > 0) return;
    advance(s, ctx, fx, "done");
  }
  throw new Error("engine: settle loop did not converge in phase " + s.phase.kind);
}

function fixOwner(s: State) {
  const cur = s.owner ? find(s, s.owner) : null;
  if (cur?.connected && cur.seated) return;
  const cand = s.players.filter((p) => p.connected && p.seated).sort((a, b) => a.joinedAt - b.joinedAt || a.joinIdx - b.joinIdx)[0];
  if (cand) s.owner = cand.name;
  else if (!cur) s.owner = null;
}

/* ------------------------------------------------------------------ join / disconnect */
function onJoin(s: State, ev: Extract<Event, { type: "join" }>, fx: Effect[]): boolean {
  const name = validName(ev.name);
  if (!name) { fx.push({ t: "reply", conn: ev.conn, msg: { type: "error", code: "bad_name" } }); return false; }
  let p = find(s, name);
  if (p) {
    if (p.connected && !(ev.token && p.token === ev.token)) { fx.push({ t: "reply", conn: ev.conn, msg: { type: "error", code: "name_in_use" } }); return false; }
    if (p.connected) fx.push({ t: "send", to: p.name, msg: { type: "replaced" } });
    p.connected = true; p.greySince = null; p.lastSeq = 0;
    if (ev.token) p.token = ev.token;
    if (p.seated && s.phase.graceAt !== null && s.phase.d?.hot === p.name) s.phase.graceAt = null;
  } else {
    const nSeated = seated(s).length;
    const canSeat = s.phase.kind === "lobby" && nSeated < K.maxPlayers;
    if (!canSeat && s.players.filter((x) => !x.seated).length >= K.maxSpectators) {
      fx.push({ t: "reply", conn: ev.conn, msg: { type: "error", code: "room_full" } });
      return false;
    }
    p = {
      name, key: name.toLowerCase(), token: ev.token ?? null, joinIdx: s.players.length ? Math.max(...s.players.map((x) => x.joinIdx)) + 1 : 0,
      joinedAt: s.now, score: 0, connected: true, seated: canSeat, lastSeq: 0, r1Correct: 0, r3Points: 0, greySince: null,
    };
    s.players.push(p);
    s.dirtySave = true;
  }
  s.emptySince = null;
  fx.push({ t: "reply", conn: ev.conn, msg: { type: "joined", name: p.name, seated: p.seated } });
  return true;
}

function onDisconnect(s: State, name: string): boolean {
  const p = find(s, name);
  if (!p || !p.connected) return false;
  p.connected = false;
  p.greySince = s.now;
  if (s.phase.kind === "lobby") s.phase.d.ready = s.phase.d.ready.filter((n: string) => n !== p.name);
  const c = s.game.curse;
  if (c?.active && c.name === p.name) { c.active = false; c.window = null; } // bounty void, nobody penalised
  if ((s.phase.kind === "r2write" || s.phase.kind === "r2guess") && s.phase.d.hot === p.name && s.phase.graceAt === null && !s.frozen)
    s.phase.graceAt = s.now + K.hotGraceMs;
  if (!s.players.some((x) => x.connected)) s.emptySince = s.now;
  return true;
}

/* ------------------------------------------------------------------ alarm */
function onAlarm(s: State, fx: Effect[], ctx: Ctx): boolean {
  let changed = false;
  if (s.emptySince !== null && s.now >= s.emptySince + K.emptyWipeMs && !s.players.some((p) => p.connected)) { s.closed = true; return true; }
  const w = s.game.curse?.window;
  if (w && w.until <= s.now) { resolveWindow(s, false); changed = true; }
  const ph = s.phase;
  if (s.frozen) return changed;
  if (ph.graceAt !== null && ph.graceAt <= s.now) {
    ph.graceAt = null;
    if (!isConn(s, ph.d.hot)) skipTurn(s);
    changed = true;
  } else if (ph.deadline !== null && ph.deadline <= s.now) {
    advance(s, ctx, fx, "deadline");
    changed = true;
  }
  return changed;
}

/* ------------------------------------------------------------------ intents */
function onIntent(s: State, ev: Extract<Event, { type: "intent" }>, fx: Effect[], ctx: Ctx): boolean {
  const p = find(s, ev.name);
  if (!p || !p.connected) return false;
  if (ev.phaseId !== s.phase.id) return false; // stale phase
  if (!Number.isInteger(ev.seq) || ev.seq <= p.lastSeq) return false; // duplicate / replay
  p.lastSeq = ev.seq;
  if (!p.seated) return false; // spectators never act
  const i = ev.intent as any;
  if (!i || typeof i.type !== "string") return false;
  const ph = s.phase, d = ph.d;
  const num = (x: unknown, lo: number, hi: number) => (Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? (x as number) : null);

  if (i.type === "snitch") return onSnitch(s, p);

  switch (ph.kind) {
    case "lobby":
      if (i.type === "ready") {
        const set = new Set<string>(d.ready);
        i.ready ? set.add(p.name) : set.delete(p.name);
        d.ready = [...set];
        return true;
      }
      if (i.type === "curses" && s.owner === p.name) { s.curses = !!i.on; return true; }
      if (i.type === "start" && s.owner === p.name && connSeated(s).length >= K.minToStart) {
        const c = ctx.content;
        if (c.questions.length < 12 || c.personalities.length < 2) { fx.push({ t: "send", to: p.name, msg: { type: "error", code: "content_not_ready" } }); return false; }
        startGame(s);
        return true;
      }
      return false;

    case "rules":
      if (i.type === "skip" && !ph.done.includes(p.name)) { ph.done.push(p.name); return true; }
      return false;

    case "r1q": {
      const sel = (d.sel[p.name] ??= { check: null, bomb: null, locked: false });
      if (i.type === "r1.select") {
        if (sel.locked) return false;
        const n = d.options.length;
        const check = i.check === null ? null : num(i.check, 0, n - 1);
        const bomb = i.bomb === null ? null : num(i.bomb, 0, n - 1);
        if ((i.check !== null && check === null) || (i.bomb !== null && bomb === null)) return false;
        if (check !== null && check === bomb) return false; // ✅ and 💣 on the same option: rejected
        sel.check = check; sel.bomb = bomb;
        return true;
      }
      if (i.type === "r1.lock" && !sel.locked && sel.check !== null) { sel.locked = true; s.dirtySave = true; return true; }
      if (i.type === "r1.unlock" && sel.locked) { sel.locked = false; return true; }
      return false;
    }

    case "r1lore":
      if (i.type === "next" && !ph.done.includes(p.name)) { ph.done.push(p.name); return true; }
      return false;

    case "ixPick": {
      if (i.type !== "ix.pick" || p.name !== d.underdog || d.picked !== null) return false;
      const b = num(i.box, 0, 2);
      if (b === null) return false;
      d.picked = b;
      s.dirtySave = true;
      return true;
    }

    case "r2pick": {
      if (i.type !== "r2.tile" || p.name !== d.hot || d.chosen) return false;
      const t = num(i.tile, 0, s.game.r2.tiles.length - 1);
      if (t === null || s.game.r2.tiles[t].taken) return false;
      pickTile(s, t, false);
      return true;
    }

    case "r2write": {
      if (p.name === d.hot || d.authors[p.name]) return false;
      const q = s.game.qs[d.qid];
      if (i.type === "r2.preset") {
        const used = new Set(Object.values<any>(d.authors).map((a) => norm(a.text)));
        const pool = q.r2_house_lies.filter((l) => !used.has(norm(l)));
        const text = pool.length ? pick(s, pool) : pick(s, q.r2_house_lies);
        d.authors[p.name] = { text: formatOption(text), house: true };
        s.dirtySave = true;
        return true;
      }
      if (i.type !== "r2.write") return false;
      const text = formatOption(sanitize(i.text, LIMITS.fake));
      const reasons: string[] = [];
      if (!text) reasons.push("empty");
      else if (isBlocked(text)) reasons.push("blocked");
      else if ([q.real_answer, ...(q.r2_alias_answers ?? [])].some((r) => tooSimilar(text, r))) reasons.push("too_close_to_truth");
      if (reasons.length) {
        d.rejections[p.name] = (d.rejections[p.name] ?? 0) + 1;
        fx.push({ t: "send", to: p.name, msg: { type: "rejected", reason: reasons[0], offerPreset: d.rejections[p.name] >= 2 } });
        return true;
      }
      d.authors[p.name] = { text, house: false };
      s.dirtySave = true;
      return true;
    }

    case "r2guess": {
      if (i.type !== "r2.pick" || p.name !== d.hot || d.pick !== null) return false;
      const o = num(i.option, 0, d.options.length - 1);
      if (o === null || d.eliminated.includes(o)) return false;
      d.pick = o;
      s.dirtySave = true;
      return true;
    }

    case "r2vote": {
      if (i.type !== "r2.vote" || !d.voters.includes(p.name) || d.votes[p.name] !== undefined) return false;
      const o = num(i.option, 0, d.options.length - 1);
      if (o === null || d.options[o].authors.includes(p.name)) return false; // no self-votes
      d.votes[p.name] = o;
      return true;
    }

    case "r3wager": {
      const cur = s.game.r3.cur;
      if (cur.wagers[p.name] !== undefined) return false;
      if (i.type === "r3.slider") { const v = sliderPct(i.pct); if (v === null) return false; d.drafts[p.name] = v; return true; }
      if (i.type === "r3.lock") {
        const v = sliderPct(i.pct);
        if (v === null) return false;
        cur.wagers[p.name] = makeWager(p, v);
        ph.done.push(p.name);
        s.dirtySave = true;
        return true;
      }
      return false;
    }

    case "r3hint": {
      const cur = s.game.r3.cur, st = cur.st[p.name];
      if (!st) return false;
      if (i.type === "r3.pass") { if (st.solvedAt !== null || st.acted) return false; st.acted = true; st.passed = true; return true; }
      if (i.type === "r3.unpass") { if (!st.passed) return false; st.acted = false; st.passed = false; return true; }
      if (i.type === "r3.guess") {
        if (st.solvedAt !== null || st.tries >= K.r3Tries || st.acted) return false;
        const g = sanitize(i.name, 60);
        if (!g || !ctx.content.names.some((n) => norm(n) === norm(g))) { fx.push({ t: "send", to: p.name, msg: { type: "error", code: "not_in_list" } }); return false; }
        const pr = s.game.r3.ps[cur.pid];
        const ok = [pr.name, ...(pr.aliases ?? [])].some((n) => norm(n) === norm(g));
        st.tries++; st.acted = true; st.passed = false;
        if (ok) { st.solvedAt = cur.hint; if (cur.first === null) cur.first = p.name; }
        else st.wrongs.push({ hint: cur.hint, name: g });
        s.dirtySave = true;
        fx.push({ t: "send", to: p.name, msg: { type: "guessResult", correct: ok, triesLeft: K.r3Tries - st.tries } });
        return true;
      }
      return false;
    }

    case "postgame":
      if (i.type === "again" || i.type === "leave") {
        if (ph.done.includes(p.name)) return false;
        ph.done.push(p.name);
        if (i.type === "leave") (d.leavers ??= []).push(p.name);
        return true;
      }
      return false;
  }
  return false;
}

const sliderPct = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100 ? Math.round(x / 5) * 5 : null;

function makeWager(p: Player, pct: number) {
  if (p.score <= 0) return { amt: K.freeRoll, free: true, pct };
  return { amt: Math.floor((p.score * pct) / 100), free: false, pct };
}

/* ------------------------------------------------------------------ snitch */
function onSnitch(s: State, p: Player): boolean {
  const c = s.game.curse;
  if (!c?.active || p.name === c.name) return false;
  if (!["r2pick", "r2write", "r2guess", "r2reveal", "r2vote", "r2end"].includes(s.phase.kind)) return false;
  if ((c.cooldown[p.name] ?? 0) > s.now) return false;
  if (!c.window) c.window = { first: p.name, until: s.now + K.snitchWindowMs, voters: [p.name] };
  else if (!c.window.voters.includes(p.name)) c.window.voters.push(p.name);
  else return false;
  if (c.window.voters.length >= snitchNeed(s)) resolveWindow(s, true);
  return true;
}
/** Taps needed: max(2, ceil(0.5 x eligible non-cursed players)), never more than those players. */
export function snitchNeed(s: State): number {
  const c = s.game.curse;
  const E = connSeated(s).filter((x) => x.name !== c?.name).length;
  return Math.min(E, Math.max(2, Math.ceil(0.5 * E)));
}
function resolveWindow(s: State, success: boolean) {
  const c = s.game.curse;
  if (!c?.window) return;
  const first = c.window.first;
  c.window = null;
  if (success) { c.active = false; add(s, first, K.snitchReward); }
  else c.cooldown[first] = s.now + K.snitchCooldownMs;
}
function closeWindow(s: State) { // a window closes at any phase change: no reward, no cooldown
  if (s.game.curse?.window) s.game.curse.window = null;
}
function fixSnitchTarget(s: State) {
  const c = s.game.curse;
  if (!c?.active || (c.target && isConn(s, c.target) && c.target !== c.name)) return;
  const cand = connSeated(s).filter((p) => p.name !== c.name);
  c.target = cand.length ? pick(s, cand).name : null;
}

/* ------------------------------------------------------------------ game flow */
function startGame(s: State) {
  s.gameNo++;
  s.game = emptyGame();
  for (const p of s.players) { p.score = 0; p.r1Correct = 0; p.r3Points = 0; }
  enter(s, "rules", { next: "r1" });
}

function advance(s: State, ctx: Ctx, fx: Effect[], reason: "done" | "deadline") {
  const ph = s.phase, d = ph.d;
  switch (ph.kind) {
    case "rules":
      if (d.next === "r1") return startR1(s, ctx);
      if (d.next === "r2") return startR2(s, ctx);
      return startR3(s, ctx);

    case "r1q": return r1Resolve(s);
    case "r1reveal": return enter(s, "r1lore", { qi: d.qi });
    case "r1lore":
      if (d.qi < 3) return enterR1q(s, d.qi + 1);
      return startInterlude(s);

    case "ixPick": return ixResolve(s, ctx);
    case "ixResult": return enter(s, "rules", { next: "r2" });

    case "r2pick": {
      if (!isConn(s, d.hot)) return skipTurn(s);
      if (!d.chosen) {
        const real = s.game.r2.tiles.map((t, i) => (!t.taken && !t.garbage ? i : -1)).filter((i) => i >= 0);
        if (!real.length) return skipTurn(s);
        return pickTile(s, pick(s, real), true);
      }
      return;
    }
    case "r2write": return r2BuildOptions(s);
    case "r2guess": return r2GuessResolve(s, reason);
    case "r2reveal": return r2AfterReveal(s, fx);
    case "r2vote": return r2VoteResolve(s, fx);
    case "r2end": return endTurn(s);

    case "r3wager": return r3AfterWager(s);
    case "r3hint": return r3NextHint(s);
    case "r3reveal": return r3AfterReveal(s);

    case "podium": return enter(s, "postgame", { leavers: [] });
    case "postgame": return toLobby(s);
  }
}

/* ---- Round 1 */
function startR1(s: State, ctx: Ctx) {
  const qs = pickQuestions(s, s, ctx.content.questions, 4);
  for (const q of qs) s.game.qs[q.id] = q;
  s.game.r1 = { ids: qs.map((q) => q.id), qi: 0 };
  enterR1q(s, 0);
}
function enterR1q(s: State, qi: number) {
  const q = s.game.qs[s.game.r1.ids[qi]];
  const wrongs = q.wrong_options.filter((w) => !w.status || w.status === "approved").map((w) => w.text);
  const nWrong = Math.min(wrongs.length, 4 + randInt(s, 2));
  const opts = shuffle(s, [
    { text: formatOption(q.real_answer), isTrue: true },
    ...shuffle(s, wrongs).slice(0, nWrong).map((t) => ({ text: formatOption(t), isTrue: false })),
  ]);
  s.game.r1.qi = qi;
  enter(s, "r1q", { qi, qid: q.id, options: opts, sel: {} });
}
function r1Resolve(s: State) {
  const d = s.phase.d;
  const opts: { text: string; isTrue: boolean }[] = d.options;
  const T = opts.findIndex((o) => o.isTrue);
  const checks: string[][] = opts.map(() => []), bombs: string[][] = opts.map(() => []);
  for (const p of seated(s)) {
    const sel = d.sel[p.name];
    if (!sel) continue;
    if (sel.check !== null) checks[sel.check].push(p.name);
    if (sel.bomb !== null && sel.bomb !== sel.check) bombs[sel.bomb].push(p.name);
  }
  const deltas: Record<string, number> = {};
  for (const n of checks[T]) { add(s, n, K.r1Correct, deltas); find(s, n)!.r1Correct++; }
  opts.forEach((_, i) => {
    if (i === T) return; // bomb on the truth is defused
    const gain = Math.min(K.bombCap, K.bombPerVictim * checks[i].length);
    for (const b of bombs[i]) add(s, b, gain, deltas);
  });
  enter(s, "r1reveal", { qi: d.qi, truth: T, options: opts.map((o, i) => ({ text: o.text, isTrue: o.isTrue, checks: checks[i], bombs: bombs[i] })), deltas });
}

/* ---- Interlude */
function startInterlude(s: State) {
  const cs = connSeated(s);
  if (cs.length < 2) return enter(s, "rules", { next: "r2" });
  const key = (p: Player) => rand(s) + 0 * p.score;
  const under = [...cs].map((p) => ({ p, r: key(p) })).sort((a, b) => a.p.score - b.p.score || a.p.r1Correct - b.p.r1Correct || a.r - b.r)[0].p;
  const dealer = cs.filter((p) => p !== under).map((p) => ({ p, r: key(p) })).sort((a, b) => b.p.score - a.p.score || b.p.r1Correct - a.p.r1Correct || a.r - b.r)[0].p;
  s.game.ix = { underdog: under.name, dealer: dealer.name, vip: null };
  enter(s, "ixPick", { underdog: under.name, dealer: dealer.name, boxes: shuffle(s, ["A", "B", "C"]), picked: null });
}
function ixResolve(s: State, ctx: Ctx) {
  const d = s.phase.d;
  if (d.picked === null && !isConn(s, d.underdog)) return enter(s, "rules", { next: "r2" }); // underdog gone: cancelled, no award
  const box = d.picked ?? randInt(s, 3);
  const kind: string = d.boxes[box];
  const res: any = { box, kind, underdog: d.underdog };
  if (kind === "A") add(s, d.underdog, K.boxA);
  else if (kind === "B") s.game.ix.vip = d.underdog;
  else applyBoxC(s, res, ctx.content.curses);
  enter(s, "ixResult", res);
}
function applyBoxC(s: State, res: any, pool: string[]) {
  if (!s.curses || !pool.length) { add(s, res.underdog, K.boxCFlat); res.flat = true; return; } // voice off: flat +10, no curse
  add(s, res.underdog, K.boxCNow);
  const others = connSeated(s).filter((p) => p.name !== res.underdog);
  const target = others.length ? pick(s, others).name : null;
  const text = sanitize(pick(s, pool).replace("{target}", target ?? "a friend"), LIMITS.curse);
  s.game.curse = { name: res.underdog, text, target, active: true, window: null, cooldown: {} } as Curse;
}

/* ---- Round 2 */
function startR2(s: State, ctx: Ctx) {
  const roster = seated(s);
  const n = roster.length;
  const qs = pickQuestions(s, s, ctx.content.questions, n);
  for (const q of qs) s.game.qs[q.id] = q;
  const tiles = shuffle(s, [...qs.map((q) => ({ decoy: q.r2_decoy_category, qid: q.id as string | null, garbage: false, taken: false })), { decoy: "Free Gift!", qid: null, garbage: true, taken: false }]);
  const cursed = s.game.curse?.active ? s.game.curse.name : null;
  const order = roster.map((p) => ({ p, r: rand(s) })).sort((a, b) => (a.p.name === cursed ? -1 : b.p.name === cursed ? 1 : 0) || a.p.score - b.p.score || a.r - b.r).map((x) => x.p.name);
  s.game.r2 = { order, turn: 0, tiles, garbageUsed: false };
  nextTurn(s);
}
function nextTurn(s: State) {
  const r2 = s.game.r2;
  while (r2.turn < r2.order.length) {
    const hot = r2.order[r2.turn];
    if (isConn(s, hot)) return enter(s, "r2pick", { hot, chosen: false });
    endTurnCounters(s); // a skipped turn still counts for the curse
  }
  enter(s, "rules", { next: "r3" });
}
function endTurnCounters(s: State) {
  const r2 = s.game.r2;
  r2.turn++;
  const c = s.game.curse;
  if (c && r2.turn === 2) { if (c.active && isConn(s, c.name)) add(s, c.name, K.bounty); c.active = false; c.window = null; }
}
function endTurn(s: State) { endTurnCounters(s); nextTurn(s); }
function skipTurn(s: State) { enter(s, "r2end", { skipped: true }); }

function pickTile(s: State, t: number, auto: boolean) {
  const tile = s.game.r2.tiles[t];
  const hot = s.phase.d.hot;
  tile.taken = true;
  if (tile.garbage) { // first to tap Garbage: +20, then picks a real tile too
    s.game.r2.garbageUsed = true;
    add(s, hot, K.garbage);
    return enter(s, "r2pick", { hot, chosen: false, garbageBy: hot });
  }
  void auto;
  s.phase.d.chosen = true;
  enter(s, "r2write", { hot, qid: tile.qid, authors: {}, rejections: {} });
}

function r2BuildOptions(s: State) {
  const d = s.phase.d;
  const q = s.game.qs[d.qid];
  // merge duplicates, credit all co-writers
  const merged = new Map<string, { text: string; authors: string[]; house: boolean }>();
  const realKey = norm(formatOption(q.real_answer));
  for (const [name, a] of Object.entries<any>(d.authors)) {
    const k = norm(a.text);
    if (!k || k === realKey) continue;
    const m = merged.get(k) ?? { text: a.text, authors: [] as string[], house: !!a.house };
    if (!a.house) { m.authors.push(name); m.house = false; }
    merged.set(k, m);
  }
  let fakes = [...merged.values()];
  if (fakes.length > K.maxFakes) fakes = shuffle(s, fakes).slice(0, K.maxFakes); // the rest get nothing
  const have = new Set(fakes.map((f) => norm(f.text)));
  have.add(realKey);
  const pool = shuffle(s, q.r2_house_lies.map(formatOption).filter((l) => !have.has(norm(l))));
  while (fakes.length + 1 < K.minOptions && pool.length) fakes.push({ text: pool.shift()!, authors: [], house: true });
  const options = shuffle(s, [{ text: formatOption(q.real_answer), authors: [] as string[], house: false, real: true }, ...fakes.map((f) => ({ ...f, real: false }))]);
  enter(s, "r2guess", { hot: d.hot, qid: d.qid, attempt: 1, options, eliminated: [], picks: [], pick: null });
}

function r2GuessResolve(s: State, reason: "done" | "deadline") {
  const d = s.phase.d;
  if (d.pick === null) { // timer ran out: attempt forfeited
    if (d.attempt === 1) return enter(s, "r2guess", { ...d, attempt: 2, pick: null });
    return r2Reveal(s, d);
  }
  const o = d.options[d.pick];
  d.picks.push({ idx: d.pick, attempt: d.attempt });
  void reason;
  if (o.real || d.attempt === 2) return r2Reveal(s, d);
  return enter(s, "r2guess", { ...d, attempt: 2, eliminated: [...d.eliminated, d.pick], pick: null });
}
function r2Reveal(s: State, d: any) {
  const deltas: Record<string, number> = {};
  let hotPts = 0;
  const lastPick = d.picks[d.picks.length - 1];
  const foundReal = lastPick && d.options[lastPick.idx].real;
  if (foundReal) hotPts = lastPick.attempt === 1 ? K.hotTry1 : K.hotTry2;
  if (hotPts && s.game.ix.vip === d.hot) { hotPts *= 2; s.game.ix.vip = null; } // VIP Pass doubles own turn
  if (hotPts) add(s, d.hot, hotPts, deltas);
  const fooledCount = d.options.map(() => 0);
  for (const pk of d.picks) {
    const o = d.options[pk.idx];
    if (o.real) continue;
    fooledCount[pk.idx]++;
    for (const w of o.authors) add(s, w, K.fool, deltas); // house lies have no authors: nobody scores
  }
  const realIdx = d.options.findIndex((o: any) => o.real);
  enter(s, "r2reveal", { hot: d.hot, qid: d.qid, options: d.options, realIdx, picks: d.picks, deltas, fooledCount });
}
function r2AfterReveal(s: State, fx: Effect[]) {
  const d = s.phase.d;
  const authors = new Set<string>();
  d.options.forEach((o: any) => o.authors.forEach((a: string) => authors.add(a)));
  if (authors.size < 2) { // one writer means no vote
    r2Crowd(d, [], fx);
    return enter(s, "r2end", { skipped: false });
  }
  enter(s, "r2vote", { hot: d.hot, qid: d.qid, options: d.options, fooledCount: d.fooledCount, voters: [...authors], votes: {} });
}
function r2VoteResolve(s: State, fx: Effect[]) {
  const d = s.phase.d;
  const tally: number[] = d.options.map(() => 0);
  for (const v of Object.values<number>(d.votes)) tally[v]++;
  const deltas: Record<string, number> = {};
  const eligibleOpt = (i: number) => !d.options[i].real && !d.options[i].house && d.options[i].authors.length > 0;
  const max = Math.max(0, ...tally.map((t, i) => (eligibleOpt(i) ? t : 0)));
  if (max > 0) d.options.forEach((o: any, i: number) => { if (eligibleOpt(i) && tally[i] === max) for (const a of o.authors) add(s, a, K.funny, deltas); });
  r2Crowd(d, tally, fx);
  enter(s, "r2end", { skipped: false, voteDeltas: deltas });
}
function r2Crowd(d: any, tally: number[], fx: Effect[]) {
  // top 2 fakes (most comedy votes, then most fooled guesses) become pending crowd fakes: text only
  const ranked = d.options
    .map((o: any, i: number) => ({ o, i, v: tally[i] ?? 0, f: d.fooledCount?.[i] ?? 0 }))
    .filter((x: any) => !x.o.real && !x.o.house && x.o.authors.length)
    .sort((a: any, b: any) => b.v - a.v || b.f - a.f || a.i - b.i)
    .slice(0, 2);
  for (const r of ranked) fx.push({ t: "crowdFake", questionId: d.qid, text: r.o.text });
}

/* ---- Round 3 */
function startR3(s: State, ctx: Ctx) {
  const ps = pickPersonalities(s, s, ctx.content.personalities, 2);
  s.game.r3 = { ids: ps.map((p) => p.id), idx: 0, ps: Object.fromEntries(ps.map((p) => [p.id, p])), cur: null };
  enterWager(s, 0);
}
function enterWager(s: State, idx: number) {
  const r3 = s.game.r3;
  r3.idx = idx;
  r3.cur = { pid: r3.ids[idx], hint: 0, wagers: {}, st: {}, first: null };
  enter(s, "r3wager", { idx, drafts: {} });
}
function r3AfterWager(s: State) {
  const cur = s.game.r3.cur, d = s.phase.d;
  for (const p of connSeated(s)) { // timer: the current slider value is submitted
    if (cur.wagers[p.name] === undefined) cur.wagers[p.name] = makeWager(p, d.drafts[p.name] ?? K.defaultPct);
  }
  for (const p of seated(s)) cur.st[p.name] = { tries: 0, solvedAt: null, wrongs: [], acted: false, passed: false };
  enterHint(s, 1);
}
function enterHint(s: State, n: number) {
  const cur = s.game.r3.cur;
  cur.hint = n;
  for (const k of Object.keys(cur.st)) { cur.st[k].acted = false; cur.st[k].passed = false; }
  enter(s, "r3hint", { hint: n });
}
function r3NextHint(s: State) {
  const cur = s.game.r3.cur;
  const active = connSeated(s).some((p) => { const t = cur.st[p.name]; return t && t.solvedAt === null && t.tries < K.r3Tries; });
  if (!active || cur.hint >= 5) return r3Reveal(s);
  enterHint(s, cur.hint + 1);
}
function r3Reveal(s: State) {
  const cur = s.game.r3.cur;
  const pr = s.game.r3.ps[cur.pid];
  const deltas: Record<string, number> = {};
  const rows: any[] = [];
  for (const p of seated(s)) {
    const w = cur.wagers[p.name], st = cur.st[p.name];
    if (!w || !st) continue; // missed the wager phase: sits out
    const row: any = { name: p.name, amt: w.amt, free: w.free, solvedAt: st.solvedAt, wrongs: st.wrongs, voided: false, delta: 0 };
    if (!p.connected) row.voided = true; // greyed at resolution: no gain or loss
    else if (st.solvedAt !== null) row.delta = Math.round(w.amt * K.r3Mult[st.solvedAt - 1]);
    else row.delta = w.free ? 0 : -w.amt;
    if (row.delta) { const before = p.score; add(s, p.name, row.delta, deltas); p.r3Points += p.score - before; }
    rows.push(row);
  }
  if (cur.first) add(s, cur.first, K.firstSolve, deltas);
  enter(s, "r3reveal", { pid: pr.id, name: pr.name, hints: pr.hints, rows, first: cur.first, deltas });
}
function r3AfterReveal(s: State) {
  const r3 = s.game.r3;
  if (r3.idx + 1 < r3.ids.length) return enterWager(s, r3.idx + 1);
  enter(s, "podium", { ranks: ranking(s) });
}

export function ranking(s: State): { name: string; score: number; rank: number }[] {
  const list = seated(s).slice().sort((a, b) => b.score - a.score || a.r3Points - b.r3Points || a.joinIdx - b.joinIdx);
  return list.map((p) => ({ name: p.name, score: p.score, rank: 1 + list.filter((x) => x.score > p.score).length }));
}

/* ---- Post-game: same room, same players */
function toLobby(s: State) {
  const leavers: string[] = s.phase.d.leavers ?? [];
  s.players = s.players.filter((p) => !leavers.includes(p.name) && !(p.seated && !p.connected && p.greySince !== null && s.now - p.greySince >= K.greyKeepMs));
  let free = K.maxPlayers - seated(s).length;
  for (const p of s.players.filter((x) => !x.seated && x.connected).sort((a, b) => a.joinIdx - b.joinIdx)) {
    if (free <= 0) break;
    p.seated = true; free--;
  }
  for (const p of s.players) { p.score = 0; p.r1Correct = 0; p.r3Points = 0; }
  s.game = emptyGame();
  enter(s, "lobby", { ready: [] }, 0);
}

export type { Ctx, Event, Effect, Intent, State, PersonalityLite };
