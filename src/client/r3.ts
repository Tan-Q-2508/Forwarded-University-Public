/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 3 (Who Am I?): wager slider, hint screen with a searchable name list, reveal.
import { LIMITS, PLAYERS, R3_HINTS } from "./fixtures";
import { avatarFor, cut, esc, shell, withOverlay, type ConnStatus, type Orientation } from "./ui";

const MULT = [1.5, 1.5, 1, 1, 0.5]; // by hint number, same table the server pays from
const left = (deadline: number | null, offset: number) => (deadline === null ? "" : String(Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000))));
const timerOf = (v: any, offset: number) => {
  const sec = left(v.phase.deadline, offset);
  return { timer: sec || undefined, hurry: sec !== "" && Number(sec) <= 10, timerAttrs: v.phase.deadline !== null ? `data-deadline="${v.phase.deadline}"` : "" };
};
const ready = (v: any, word = "READY") => `<div class="ready-count"><b>${v.phase.ready.done}/${v.phase.ready.total}</b> ${word}</div>`;
const fmt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

export const wagerAmount = (score: number, pct: number, free: boolean) => (free ? 20 : Math.floor((score * pct) / 100));

/* ------------------------------------------------------------------ wager */
export interface R3Ui { pct: number; query: string; chosen: string | null; names: string[] }

export function outcomesHtml(amt: number, free: boolean) {
  const box = (label: string, val: string, cls = "") => `<div class="wg-out ${cls}"><span class="wg-l">${label}</span><span class="wg-v">${val}</span></div>`;
  return box("HINT 1-2 ×1.5", fmt(Math.round(amt * 1.5)), "good") + box("HINT 3-4 ×1.0", fmt(amt), "good") + box("HINT 5 ×0.5", fmt(Math.round(amt * 0.5)), "good") +
    box("UNSOLVED", free ? "0 (FREE ROLL)" : fmt(-amt), "bad");
}

export function r3WagerLive(o: Orientation, v: any, status: ConnStatus, offset: number, ui: R3Ui) {
  const d = v.data;
  const free = d.freeRoll;
  const pct = d.locked ? d.mine?.pct ?? ui.pct : free ? 0 : ui.pct;
  const amt = d.locked ? d.mine?.amt ?? 0 : wagerAmount(d.score, pct, free);
  const seated = !!v.you?.seated;
  const note = !seated ? "THE PLAYERS ARE WAGERING…" : free ? "FREE ROLL! WAGER 20. YOU CANNOT LOSE." : "HOW MUCH DO YOU BACK YOURSELF?";
  return withOverlay(shell(o, "r3-wager", {
    round: `Round 3 · Wager ${d.idx + 1}/2`,
    ...timerOf(v, offset),
    body: `<div class="r3x wg">
      <p class="wg-note">${esc(note)}</p>
      <section class="wg-big card"><span class="wg-pct">${free ? "FREE" : pct + "%"}</span><span class="wg-eq">=</span><span class="wg-amt"><b id="wg-amt">${amt}</b><small> PTS</small></span><span class="wg-of">OF ${d.score}</span></section>
      <section class="wg-slider"><input id="wg-range" type="range" min="0" max="100" step="5" value="${pct}" ${d.locked || free || !seated ? "disabled" : ""} aria-label="Wager percent" /></section>
      <section class="wg-outs" id="wg-outs">${outcomesHtml(amt, free)}</section>
      <section class="wg-acts"><div class="ready-wrap">${ready(v, "LOCKED")}</div>
        <div class="lock-wrap">${seated ? `<button class="btn ${d.locked ? "mint" : "red"} ${d.locked ? "off" : ""}" data-act="wager">${d.locked ? "LOCKED ✓" : "LOCK WAGER"}</button>` : `<button class="btn off">WATCHING</button>`}</div></section>
    </div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ hint screen + searchable names */
export function matches(names: string[], q: string): string[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const starts: string[] = [], has: string[] = [];
  for (const n of names) {
    const l = n.toLowerCase();
    if (l.startsWith(t) || l.split(/\s+/).some((w) => w.startsWith(t))) starts.push(n);
    else if (l.includes(t)) has.push(n);
  }
  return [...starts, ...has].slice(0, 5);
}
export const sugHtml = (list: string[]) =>
  list.map((n) => `<button class="sug-row" data-act="sug" data-name="${esc(n)}">${esc(cut(n, 40))}</button>`).join("");

export function r3HintLive(o: Orientation, v: any, status: ConnStatus, offset: number, ui: R3Ui) {
  const d = v.data, m = d.mine;
  const seated = !!v.you?.seated;
  const rows = [0, 1, 2, 3, 4].map((i) => {
    const open = i < d.hints.length;
    return `<div class="hint ${open ? "open" : "locked"} ${i === d.hint - 1 ? "fresh" : ""}"><div class="hno">${i + 1}</div>
      <div class="htext">${open ? esc(cut(d.hints[i], LIMITS.hint)) : `\u{1F512} HINT ${i + 1} IS LOCKED`}</div></div>`;
  }).join("");
  const free = d.wager?.free;
  const amt = d.wager ? d.wager.amt : null;
  let msg = "";
  if (m?.solved) msg = `✔ SOLVED! WAITING FOR OTHERS`;
  else if (m && m.triesLeft <= 0) msg = "NO GUESSES LEFT. WATCH AND WAIT.";
  else if (m?.passed) msg = "PASSED. TAP UNPASS TO CHANGE.";
  else if (m?.acted && m.wrongs.length) msg = `✘ WRONG: ${cut(m.wrongs[m.wrongs.length - 1].name, 30)}`;
  const locked = !seated || !m || m.solved || m.triesLeft <= 0 || m.acted;
  const list = !locked && !ui.chosen ? matches(ui.names, ui.query) : [];
  const canLock = !locked && !!ui.chosen;
  return withOverlay(shell(o, "r3-hint", {
    round: `Round 3 · Hint ${d.hint}/5`,
    ...timerOf(v, offset),
    body: `<div class="r3x hs">
      <section class="illus card" aria-label="Mystery illustration"><svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" class="sil" role="img" aria-label="Silhouette of a mystery person"><rect width="200" height="200" fill="#2a2f7a"/><circle cx="100" cy="78" r="40" fill="#0b1033"/><path d="M28 200c0-52 32-80 72-80s72 28 72 80z" fill="#0b1033"/><text x="100" y="98" text-anchor="middle" font-family="Anton" font-size="62" fill="#ffd60a">?</text></svg></section>
      <section class="sug card" id="sug" ${list.length ? "" : "hidden"}>${sugHtml(list)}</section>
      <section class="stats">
        <div class="pill sun">${amt === null ? "NO WAGER" : free ? "FREE ROLL 20" : `WAGER ${amt}`}</div>
        <div class="pill">GUESSES LEFT ${m ? Math.max(0, m.triesLeft) : 0}</div>
        <div class="pill mint">NOW ×${MULT[d.hint - 1]}</div>
      </section>
      <section class="hints">${rows}</section>
      <section class="guess">${locked
        ? `<div class="search off">${esc(msg || (seated ? "WAITING FOR THE NEXT HINT" : "YOU ARE WATCHING"))}</div>`
        : `<input id="in-guess" class="field search-in" type="text" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="40" placeholder="Search a name…" value="${esc(ui.query)}" aria-label="Your guess" />`}</section>
      <section class="r3-actions">
        <div class="lock-wrap"><button class="btn red ${canLock ? "" : "off"}" data-act="guess3">LOCK IN</button></div>
        <div class="pass-wrap"><button class="btn ghost ${m && (m.passed || (!m.acted && !m.solved && m.triesLeft > 0)) ? "" : "off"}" data-act="${m?.passed ? "unpass" : "pass"}">${m?.passed ? "UNPASS" : "PASS"}</button></div>
        <div class="ready-wrap">${ready(v, "DONE")}</div>
      </section>
    </div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ reveal */
export function r3RevealLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data;
  const rows = [...d.rows].sort((a: any, b: any) => b.delta - a.delta).map((r: any) => {
    const idx = Math.max(0, v.players.findIndex((p: any) => p.name === r.name));
    const result = r.voided ? "AWAY · VOIDED" : r.solvedAt ? `✔ HINT ${r.solvedAt} ${fmt(r.delta)}` : `✘ UNSOLVED ${r.free ? "FREE" : fmt(r.delta)}`;
    const wrong = r.wrongs.length ? `✘ ${r.wrongs.map((w: any) => w.name).join(", ")}` : "NO WRONG GUESSES";
    return `<div class="rv3 ${r.solvedAt && !r.voided ? "win" : "lose"}">
      ${avatarFor(r.name, idx)}<div class="rv3-main"><div class="rv3-l1"><span class="rv3-n">${esc(cut(r.name, LIMITS.name))}</span><span class="rv3-w">${r.free ? "FREE" : "WAGER " + r.amt}</span><span class="rv3-r">${esc(result)}</span></div>
      <div class="rv3-l2">${esc(wrong)}</div></div></div>`;
  }).join("");
  return withOverlay(shell(o, "r3-reveal", {
    round: "Round 3 · The Answer",
    ...timerOf(v, offset),
    body: `<div class="r3x rv">
      <section class="rv-answer card"><span class="stamp mint">IT WAS</span><div class="rv-name">${esc(cut(d.name, 40))}</div>
        ${d.first ? `<div class="rv-first">FIRST TO SOLVE: ${esc(cut(d.first, LIMITS.name))} +10</div>` : `<div class="rv-first">NOBODY SOLVED IT</div>`}</section>
      <section class="rv-rows">${rows}</section>
    </div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ fixtures: longest names, 8 players */
const fxPlayers = PLAYERS.map((p) => ({ name: p.name, score: p.score, connected: !p.grey, seated: true }));
const base = (kind: string, data: any) => ({
  you: { name: "Kabir", seated: true, owner: true, score: 185 }, players: fxPlayers, curses: true, owner: "Kabir", curse: null,
  phase: { kind, id: 21, deadline: null, dur: 45000, frozen: false, ready: { done: 2, total: 6 }, waiting: false }, data,
});
const NAMES = ["Aamir Khanna Test", "Aarti Test Person", "Abhinav Test Name", "Aditi Test Person", "Ajay Fictional Test Name Number Forty Chars!", "Akash Test"];
export const fixtureR3Wager = (o: Orientation) =>
  r3WagerLive(o, base("r3wager", { idx: 0, score: 185, freeRoll: false, defaultPct: 25, locked: false }), "open", 0, { pct: 45, query: "", chosen: null, names: NAMES });
export const fixtureR3Hint = (o: Orientation) =>
  r3HintLive(o, base("r3hint", { idx: 0, hint: 3, hints: R3_HINTS.slice(0, 3).map((h) => h ?? ""), mine: { tries: 1, triesLeft: 2, solved: false, acted: false, passed: false, wrongs: [] }, wager: { amt: 83, free: false, pct: 45 } }),
    "open", 0, { pct: 25, query: "a", chosen: null, names: NAMES });
export const fixtureR3Reveal = (o: Orientation) =>
  r3RevealLive(o, base("r3reveal", {
    name: "Ajay Fictional Test Name Number Forty Chars!", first: "Aarav Sharma", deltas: {},
    rows: PLAYERS.map((p, i) => ({ name: p.name, amt: 20 + i * 11, free: i === 6, solvedAt: i % 3 === 0 ? 2 : null, delta: i % 3 === 0 ? 31 : i === 5 ? 0 : -(20 + i * 11), voided: i === 5, wrongs: i % 2 ? [{ hint: 1, name: "Decoy Name 17" }, { hint: 2, name: "Decoy Name 222" }, { hint: 4, name: "Another Wrong Guess" }] : [] })),
  }), "open", 0);
