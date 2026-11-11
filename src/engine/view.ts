/* eslint-disable @typescript-eslint/no-explicit-any */
// viewFor(): what one player's phone is allowed to know RIGHT NOW. Secrets (the real answer, other
// players' picks, hints not yet shown, fake authors, wagers) appear only in their reveal phase.
import { K, eligible, readyCount, snitchNeed } from "./engine";
import type { State } from "./types";

export function viewFor(s: State, name: string | null) {
  const me = name ? s.players.find((p) => p.key === name.toLowerCase()) ?? null : null;
  const ph = s.phase, d = ph.d;
  const isSeated = !!me?.seated;
  const myName = me?.name ?? null;
  const rc = readyCount(s);

  const base = {
    code: s.code, seq: s.seq, gameNo: s.gameNo,
    you: me ? { name: me.name, seated: me.seated, owner: s.owner === me.name, score: me.score } : null,
    players: s.players.map((p) => ({ name: p.name, score: p.score, connected: p.connected, seated: p.seated, ready: ph.kind === "lobby" ? ph.d.ready.includes(p.name) : undefined })),
    curses: s.curses,
    owner: s.owner,
    phase: { kind: ph.kind, id: ph.id, deadline: ph.deadline, dur: ph.dur, frozen: s.frozen, ready: rc, waiting: isSeated && s.players.filter((p) => p.seated && p.connected).length < 2 && ph.kind !== "lobby" },
    curse: curseView(s, myName),
  };
  return { ...base, data: phaseData(s, myName, isSeated) };
}

function curseView(s: State, me: string | null) {
  const c = s.game.curse;
  if (!c?.active) return null;
  const mine = me === c.name;
  const cooldownUntil = me ? c.cooldown[me] ?? 0 : 0;
  return {
    active: true, mine,
    text: mine ? c.text : undefined, // the curse text is for the cursed player only
    window: c.window ? { votes: c.window.voters.length, need: snitchNeed(s), until: c.window.until, voted: !!me && c.window.voters.includes(me) } : null,
    cooldownUntil: cooldownUntil > s.now ? cooldownUntil : 0,
    canSnitch: !mine && !!me && !!s.players.find((p) => p.name === me)?.seated,
  };
}

function phaseData(s: State, me: string | null, isSeated: boolean): any {
  const ph = s.phase, d = ph.d;
  const tt = { turn: Math.min(s.game.r2.turn + 1, s.game.r2.order.length), turns: s.game.r2.order.length };
  switch (ph.kind) {
    case "lobby": return { ready: d.ready };
    case "rules": return { next: d.next, skipped: ph.done };
    case "r1q": {
      const sel = me ? d.sel[me] : null;
      return {
        qi: d.qi, question: s.game.qs[d.qid].question, setup: s.game.qs[d.qid].setup,
        options: d.options.map((o: any) => o.text), // order only; never isTrue
        mine: sel ? { check: sel.check, bomb: sel.bomb, locked: sel.locked } : { check: null, bomb: null, locked: false },
      };
    }
    case "r1reveal": return { qi: d.qi, truth: d.truth, options: d.options, deltas: d.deltas };
    case "r1lore": {
      const q = s.game.qs[s.game.r1.ids[d.qi]];
      return { qi: d.qi, lore: q.lore, source: q.source, urls: q.source_urls, question: q.question, answer: q.real_answer, skipped: ph.done };
    }
    case "ixPick": return {
      underdog: d.underdog, dealer: d.dealer, picked: d.picked !== null,
      boxes: me === d.dealer ? d.boxes : undefined, // only the Dealer sees what is inside
    };
    case "ixResult": return { box: d.box, kind: d.kind, underdog: d.underdog, flat: !!d.flat };
    case "r2pick": return { hot: d.hot, tiles: s.game.r2.tiles.map((t) => ({ decoy: t.decoy, taken: t.taken })), garbageUsed: s.game.r2.garbageUsed, ...tt };
    case "r2write": {
      const q = s.game.qs[d.qid];
      const writer = isSeated && me !== d.hot;
      return {
        ...tt, hot: d.hot, category: q.r2_decoy_category, question: q.question,
        real: writer ? q.real_answer : undefined, // writers need the truth to write convincing fakes; the hot seat must not see it
        submitted: me ? !!d.authors[me] : false,
      };
    }
    case "r2guess": return { ...tt, hot: d.hot, question: s.game.qs[d.qid].question, attempt: d.attempt, options: d.options.map((o: any) => o.text), eliminated: d.eliminated };
    case "r2reveal": return { ...tt, hot: d.hot, options: d.options, realIdx: d.realIdx, picks: d.picks, deltas: d.deltas };
    case "r2vote": return {
      ...tt, hot: d.hot, options: d.options.map((o: any) => o.text), canVote: !!me && d.voters.includes(me) && d.votes[me] === undefined,
      own: me ? d.options.map((o: any, i: number) => (o.authors.includes(me) ? i : -1)).filter((i: number) => i >= 0) : [],
    };
    case "r2end": return { ...tt, skipped: d.skipped, voteDeltas: d.voteDeltas ?? {} };
    case "r3wager": {
      const p = s.players.find((x) => x.name === me);
      const cur = s.game.r3.cur;
      return { idx: s.game.r3.idx, score: p?.score ?? 0, freeRoll: !!p && p.score <= 0, defaultPct: K.defaultPct, locked: me ? cur.wagers[me] !== undefined : false, mine: me ? cur.wagers[me] : undefined };
    }
    case "r3hint": {
      const cur = s.game.r3.cur, pr = s.game.r3.ps[cur.pid];
      const st = me ? cur.st[me] : null;
      return {
        idx: s.game.r3.idx, hint: cur.hint, hints: pr.hints.slice(0, cur.hint), // later hints never leave the server
        mine: st ? { tries: st.tries, triesLeft: K.r3Tries - st.tries, solved: st.solvedAt !== null, acted: st.acted, passed: st.passed, wrongs: st.wrongs } : null,
        wager: me ? cur.wagers[me] : undefined,
        stillIn: eligible(s).length,
      };
    }
    case "r3reveal": return { name: d.name, rows: d.rows, first: d.first, deltas: d.deltas };
    case "podium": return { ranks: d.ranks };
    case "postgame": return { answered: ph.done, ranks: [...s.players].filter((p) => p.seated).sort((a, b) => b.score - a.score).map((p) => ({ name: p.name, score: p.score })) };
  }
}
