/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 2 (Pick Me Behaviour): tile pick, write a fake, guess, reveal, comedy vote, turn end.
import { LIMITS, PLAYERS, R2_CATEGORY, R2_OPTIONS, R2_PROMPT } from "./fixtures";
import { cut, esc, shell, withOverlay, type ConnStatus, type Orientation } from "./ui";

const LETTERS = "ABCDEFGHI";
const left = (deadline: number | null, offset: number) => (deadline === null ? "" : String(Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000))));
const timerOf = (v: any, offset: number) => {
  const sec = left(v.phase.deadline, offset);
  return { timer: sec || undefined, hurry: sec !== "" && Number(sec) <= 10, timerAttrs: v.phase.deadline !== null ? `data-deadline="${v.phase.deadline}"` : "" };
};
const ready = (v: any) => `<div class="ready-count"><b>${v.phase.ready.done}/${v.phase.ready.total}</b> READY</div>`;
const roundTag = (d: any, what: string) => `Round 2 · ${what}${d.turns ? ` ${d.turn}/${d.turns}` : ""}`;
const names = (a: string[]) => a.map((n) => cut(n, LIMITS.name)).join(" + ");

/** Bottom-left slot: the cursed player's reminder, or everyone else's BUSTED! button (spectators get neither). */
function curseChip(v: any, offset: number) {
  const c = v.curse;
  if (!c?.active) return "";
  if (c.mine) return `<div class="r2-curse mine"><span class="cs-label">YOUR CURSE</span><span class="cs-text">${esc(cut(c.text ?? "", LIMITS.curse))}</span></div>`;
  if (!c.canSnitch) return `<div class="r2-curse"><span class="cs-label">SOMEONE IS CURSED</span></div>`;
  let label = "BUSTED!", off = false;
  if (c.window) { label = `BUSTED ${c.window.votes}/${c.window.need}`; off = c.window.voted; }
  else if (c.cooldownUntil && c.cooldownUntil > Date.now() + offset) { label = "WAIT…"; off = true; }
  return `<div class="r2-curse"><span class="cs-label">SOMEONE IS CURSED</span><div class="cs-btn"><button class="btn red ${off ? "off" : ""}" data-act="snitch">${label}</button></div></div>`;
}

const wrap = (o: Orientation, id: string, v: any, offset: number, status: ConnStatus, tag: string, body: string, cls = "") =>
  withOverlay(shell(o, id, { round: tag, ...timerOf(v, offset), body: `<div class="r2 ${cls}">${body}</div>` }), status, v.phase.frozen);

const head = (v: any, pills: string, text: string, cls = "") =>
  `<section class="r2-head card ${cls}"><div class="hot">${pills}</div><p class="p-text">${esc(cut(text, LIMITS.question))}</p></section>`;
const hotPill = (name: string) => `<span class="pill sun">\u{1F525} HOT SEAT: ${esc(cut(name, LIMITS.name))}</span>`;

/* ------------------------------------------------------------------ tile pick */
export function r2PickLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data, me = v.you?.name;
  const mine = me === d.hot && v.you?.seated;
  const tiles = d.tiles.map((t: any, i: number) => {
    const inner = `<span class="tile-n">${i + 1}</span><span class="tile-t">${t.taken ? "TAKEN" : esc(cut(t.decoy, 40))}</span>`;
    return mine && !t.taken
      ? `<button class="tile can" data-act="tile" data-i="${i}" aria-label="Pick tile ${i + 1}">${inner}</button>`
      : `<div class="tile ${t.taken ? "taken" : ""}">${inner}</div>`;
  }).join("");
  const note = mine ? (d.garbageUsed ? "PICK A TILE. THE FREE GIFT IS GONE." : "PICK A TILE. ONE IS A FREE GIFT (+20)!") : `${d.hot} IS PICKING A TILE…`;
  return wrap(o, "r2-pick", v, offset, status, roundTag(d, "Turn"), `
    ${head(v, hotPill(d.hot), note)}
    <section class="tiles">${tiles}</section>
    ${curseChip(v, offset)}`);
}

/* ------------------------------------------------------------------ write a fake (the typing screen) */
export interface WriteUi { draft: string; error: string; offerPreset: boolean }
export function r2WriteLive(o: Orientation, v: any, status: ConnStatus, offset: number, ui: WriteUi) {
  const d = v.data, me = v.you?.name;
  const writer = !!v.you?.seated && me !== d.hot;
  const remain = LIMITS.fake - ui.draft.length;
  let main: string;
  if (writer && !d.submitted) {
    main = `
      <section class="w-truth card"><span class="cs-label">THE TRUTH</span><span class="w-truth-t">${esc(cut(d.real ?? "", LIMITS.option))}</span></section>
      <section class="w-field"><input id="in-fake" class="field" type="text" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="${LIMITS.fake}" placeholder="Write a convincing fake…" value="${esc(ui.draft)}" aria-label="Your fake answer" /><span class="w-count ${remain <= 10 ? "low" : ""}">${remain}</span></section>
      <section class="w-btns"><div class="w-submit"><button class="btn red ${ui.draft.trim() ? "" : "off"}" data-act="write">SUBMIT</button></div><div class="w-preset"><button class="btn ${ui.offerPreset ? "" : "ghost"}" data-act="preset">PRESET LIE</button></div></section>
      <section class="w-msg" role="alert">${esc(ui.error)}</section>`;
  } else {
    const msg = writer ? "SUBMITTED ✓  WAITING FOR THE OTHERS…" : v.you?.seated ? "YOUR FRIENDS ARE WRITING FAKES. NO PEEKING!" : "THE PLAYERS ARE WRITING FAKES…";
    main = `<section class="w-wait card"><p>${msg}</p></section>`;
  }
  return wrap(o, "r2-write", v, offset, status, roundTag(d, "Write"), `
    ${head(v, `${hotPill(d.hot)}<span class="pill">${esc(cut(d.category, 40))}</span>`, d.question)}
    ${main}
    <section class="w-ready"><div class="ready-wrap">${ready(v)}</div></section>
    ${curseChip(v, offset)}`, "w");
}

/* ------------------------------------------------------------------ guess */
export function r2GuessLive(o: Orientation, v: any, status: ConnStatus, offset: number, sel: number | null) {
  const d = v.data, me = v.you?.name;
  const mine = me === d.hot && v.you?.seated;
  const cells = d.options.map((t: string, i: number) => {
    const gone = d.eliminated.includes(i);
    const cls = `${gone ? "is-false" : ""} ${sel === i ? "picked" : ""}`;
    const inner = `<div class="letter sm">${LETTERS[i]}</div><div class="opt-text">${esc(cut(t, LIMITS.option))}</div>`;
    return mine && !gone
      ? `<button class="opt clamp2 opt-btn ${cls}" data-act="opt" data-i="${i}" aria-pressed="${sel === i}">${inner}</button>`
      : `<div class="opt clamp2 ${cls}">${inner}</div>`;
  }).join("");
  const note = mine ? (d.attempt === 1 ? "FIND THE REAL ANSWER!" : "ONE MORE TRY. PICK AGAIN!") : `${d.hot} IS GUESSING…`;
  return wrap(o, "r2-guess", v, offset, status, roundTag(d, "Guess"), `
    ${head(v, `${hotPill(d.hot)}<span class="pill">TRY ${d.attempt} OF 2</span>`, d.question)}
    <section class="grid9">${cells}</section>
    ${curseChip(v, offset)}
    <section class="r2-acts"><div class="r2-note">${esc(note)}</div>${mine ? `<div class="lock-wrap"><button class="btn red ${sel === null ? "off" : ""}" data-act="guess">LOCK IN</button></div>` : ""}</section>`);
}

/* ------------------------------------------------------------------ reveal */
export function r2RevealLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data;
  const cells = d.options.map((opt: any, i: number) => {
    const pk = d.picks.filter((p: any) => p.idx === i).map((p: any) => `\u{1F446} TRY ${p.attempt}`).join(" ");
    const by = `${LETTERS[i]} · ` + (opt.real ? "✔ THE TRUTH" : opt.house ? "HOUSE LIE" : `BY ${names(opt.authors)}`);
    return `<div class="opt rv ${opt.real ? "is-true" : "is-false-soft"}">
      <div class="letter sm">${LETTERS[i]}</div>
      <div class="opt-text">${esc(cut(opt.text, LIMITS.option))}</div>
      <div class="rv-by">${esc(by)}${pk ? ` · ${pk}` : ""}</div>
    </div>`;
  }).join("");
  const top = Object.entries<number>(d.deltas).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, p]) => `${n} +${p}`).join(" · ");
  const found = d.picks.length && d.options[d.picks[d.picks.length - 1].idx].real;
  return wrap(o, "r2-reveal", v, offset, status, roundTag(d, "Reveal"), `
    <section class="r2-head card banner-head"><span class="stamp ${found ? "mint" : ""}">${found ? `${esc(cut(d.hot, LIMITS.name))} FOUND IT!` : "NOBODY FOUND IT"}</span><div class="banner-text">${esc(top || "No points this turn")}</div></section>
    <section class="grid9 rvgrid">${cells}</section>
    ${curseChip(v, offset)}`);
}

/* ------------------------------------------------------------------ comedy vote */
export function r2VoteLive(o: Orientation, v: any, status: ConnStatus, offset: number, voted: number | null) {
  const d = v.data;
  const cells = d.options.map((t: string, i: number) => {
    const own = d.own.includes(i);
    const cls = `${own ? "own" : ""} ${voted === i ? "picked" : ""}`;
    const inner = `<div class="letter sm">${LETTERS[i]}</div><div class="opt-text">${esc(cut(t, LIMITS.option))}</div>`;
    return d.canVote && !own
      ? `<button class="opt clamp2 opt-btn ${cls}" data-act="vote" data-i="${i}">${inner}</button>`
      : `<div class="opt clamp2 ${cls}">${inner}</div>`;
  }).join("");
  const note = d.canVote ? "TAP THE FUNNIEST FAKE. YOURS IS FADED." : voted !== null ? "VOTE IN ✓" : "WRITERS ARE VOTING…";
  return wrap(o, "r2-vote", v, offset, status, roundTag(d, "Vote"), `
    <section class="r2-head card banner-head"><span class="stamp sun">FUNNIEST FAKE?</span><div class="banner-text">${esc(note)}</div></section>
    <section class="grid9">${cells}</section>
    ${curseChip(v, offset)}
    <section class="r2-acts"><div class="ready-wrap">${ready(v)}</div></section>`);
}

/* ------------------------------------------------------------------ turn end */
export function r2EndLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data;
  const win = Object.entries<number>(d.voteDeltas ?? {}).map(([n, p]) => `${n} +${p}`).join(" · ");
  return wrap(o, "r2-end", v, offset, status, roundTag(d, "Turn"), `
    <section class="r2-endcard card"><div class="ph-kind">${d.skipped ? "TURN SKIPPED" : "NEXT TURN…"}</div>
      <div class="ph-note">${esc(d.skipped ? "THEY ARE AWAY. ON TO THE NEXT PLAYER." : win ? `FUNNIEST FAKE: ${win}` : "GET READY!")}</div></section>
    ${curseChip(v, offset)}`);
}

/* ------------------------------------------------------------------ fixtures: longest names, longest text, 9 slots, 9 tiles */
const fxPlayers = PLAYERS.map((p) => ({ name: p.name, score: p.score, connected: !p.grey, seated: true }));
const base = (kind: string, data: any, you = "Kabir", extra: any = {}) => ({
  you: { name: you, seated: true, owner: false, score: 0 }, players: fxPlayers, curses: true, owner: "Kabir",
  curse: { active: true, mine: false, window: null, cooldownUntil: 0, canSnitch: true },
  phase: { kind, id: 11, deadline: null, dur: 30000, frozen: false, ready: { done: 3, total: 6 }, waiting: false },
  data: { turn: 3, turns: 8, hot: "Meenakshi M.", ...data }, ...extra,
});
const TILES = ["Kitty Party Gossip", "Cricket Commentary Box", "Railway Announcements Hall", "Matrimonial Page Special", "Exam Hall Confessions", "Wedding Buffet Politics", "Auto Rickshaw Philosophy", "Society Group Mutiny", "Free Gift!"]
  .map((decoy, i) => ({ decoy: decoy.slice(0, 40), taken: i === 2 }));
export const fixtureR2Pick = (o: Orientation) => r2PickLive(o, base("r2pick", { tiles: TILES, garbageUsed: false }, "Meenakshi M."), "open", 0);
export const fixtureR2Write = (o: Orientation) =>
  r2WriteLive(o, base("r2write", { category: R2_CATEGORY, question: cut(R2_PROMPT + " Take your time, but the truth is stranger than any fake you can invent.", 140), real: "A giant statue of a fictional cat in the market square", submitted: false }),
    "open", 0, { draft: "w".repeat(60), error: "Too close to the real answer. Try something sillier.", offerPreset: true });
export const fixtureR2Guess = (o: Orientation) =>
  r2GuessLive(o, base("r2guess", { question: R2_PROMPT, attempt: 2, options: R2_OPTIONS, eliminated: [6] }, "Meenakshi M."), "open", 0, 3);
export const fixtureR2Reveal = (o: Orientation) =>
  r2RevealLive(o, base("r2reveal", {
    options: R2_OPTIONS.map((t, i) => ({ text: t, real: i === 7, house: i === 8, authors: i === 7 || i === 8 ? [] : [PLAYERS[i % 8].name, PLAYERS[(i + 1) % 8].name] })),
    picks: [{ idx: 3, attempt: 1 }, { idx: 7, attempt: 2 }], deltas: { "Aarav Sharma": 20, "Meenakshi M.": 10, "Vikrant Raj": 20 },
  }), "open", 0);
export const fixtureR2Vote = (o: Orientation) =>
  r2VoteLive(o, base("r2vote", { options: R2_OPTIONS, canVote: true, own: [2] }), "open", 0, null);
