/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 1 (True Story) screens, drawn from the server view. Also: the rules card, shared by all rounds.
import { LIMITS, OPTIONS, PLAYERS, QUESTION, REVEAL, TRUE_INDEX } from "./fixtures";
import { avatarFor, cut, esc, shell, withOverlay, type ConnStatus, type Orientation } from "./ui";

const LETTERS = "ABCDEFGHI";
const left = (deadline: number | null, offset: number) => (deadline === null ? "" : String(Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000))));
const timerOf = (v: any, offset: number) => {
  const sec = left(v.phase.deadline, offset);
  return { timer: sec || undefined, hurry: sec !== "" && Number(sec) <= 10, timerAttrs: v.phase.deadline !== null ? `data-deadline="${v.phase.deadline}"` : "" };
};
const colorOf = (v: any, name: string) => Math.max(0, v.players.findIndex((p: any) => p.name === name));
const ready = (v: any) => `<div class="ready-count"><b>${v.phase.ready.done}/${v.phase.ready.total}</b> READY</div>`;

/* ------------------------------------------------------------------ rules card (before each round) */
const RULES: Record<string, { title: string; lines: string[] }> = {
  r1: { title: "ROUND 1 · TRUE STORY", lines: [
    "One headline is real. The rest are fakes.",
    "Tap ✅ on the one you think is true.",
    "Tap \u{1F4A3} on a different one others will fall for.",
    "+10 for the truth. +10 per victim of your bomb, max +40.",
  ] },
  r2: { title: "ROUND 2 · PICK ME BEHAVIOUR", lines: [
    "Everyone gets one turn in the Hot Seat.",
    "Pick a tile. Friends write fake answers.",
    "Find the real one. Fool the Hot Seat to score.",
    "Then vote for the funniest fake.",
  ] },
  r3: { title: "ROUND 3 · WHO AM I?", lines: [
    "Secretly wager part of your score.",
    "Five punny hints appear, one by one.",
    "Guess early to win big. 3 guesses in total.",
    "Fail to solve it and you lose the wager.",
  ] },
};
export function rulesLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const r = RULES[v.data.next] ?? RULES.r1;
  const mine = v.you?.seated;
  const skipped = v.data.skipped.includes(v.you?.name);
  return withOverlay(shell(o, "rules", {
    round: "How to play",
    ...timerOf(v, offset),
    body: `<div class="rules">
      <section class="rules-card card">
        <div class="rules-title">${esc(r.title)}</div>
        ${r.lines.map((l, i) => `<div class="rules-line"><span class="rules-n">${i + 1}</span><span class="rules-t">${esc(l)}</span></div>`).join("")}
      </section>
      <section class="rules-actions">
        <div class="ready-wrap">${ready(v)}</div>
        <div class="lock-wrap">${mine ? `<button class="btn ${skipped ? "off" : "red"}" data-act="skip">${skipped ? "WAITING…" : "GOT IT"}</button>` : `<button class="btn off">WATCHING</button>`}</div>
      </section>
    </div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ question */
export function r1QuestionLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data;
  const mine = d.mine;
  const seated = !!v.you?.seated;
  const opts = d.options.map((t: string, i: number) => {
    const isC = mine.check === i, isB = mine.bomb === i;
    const cls = isC ? "picked" : isB ? "selected-bomb" : "";
    return `<div class="opt clamp2 ${cls} ${mine.locked ? "is-locked" : ""}" data-opt="${i}">
      <div class="letter">${LETTERS[i]}</div>
      <div class="opt-text">${esc(cut(t, LIMITS.option))}</div>
      ${seated ? `<div class="opt-btns">
        <button class="mark ${isC ? "on-check" : ""}" data-mark="check" data-i="${i}" aria-label="I think ${LETTERS[i]} is true" aria-pressed="${isC}">✅</button>
        <button class="mark ${isB ? "on-bomb" : ""}" data-mark="bomb" data-i="${i}" aria-label="Bomb ${LETTERS[i]}" aria-pressed="${isB}">\u{1F4A3}</button>
      </div>` : ""}
    </div>`;
  }).join("");
  const canLock = mine.check !== null || mine.locked;
  return withOverlay(shell(o, "r1-question", {
    round: `Round 1 · Question ${d.qi + 1}/4`,
    ...timerOf(v, offset),
    body: `<div class="r1q">
      <section class="qcard card">
        <span class="stamp q-stamp">Which is real?</span>
        <p class="q-text">${esc(cut(d.question, LIMITS.question))}</p>
      </section>
      <section class="opts">${opts}</section>
      <section class="r1-actions">
        <div class="legend">${seated ? `<span class="pill sun">✅ TRUE</span><span class="pill sun">\u{1F4A3} TRAP</span>` : `<span class="pill">WATCHING</span>`}</div>
        <div class="ready-wrap">${ready(v)}</div>
        <div class="lock-wrap">${seated ? `<button class="btn ${mine.locked ? "mint" : "red"} ${canLock ? "" : "off"}" data-act="${mine.locked ? "unlock" : "lock"}">${mine.locked ? "LOCKED ✓ EDIT" : "LOCK IN"}</button>` : ""}</div>
      </section>
    </div>`,
  }), status, v.phase.frozen);
}

/** Tapping logic: ✅ and \u{1F4A3} can never sit on the same option; tapping again clears. */
export function nextSelection(mine: { check: number | null; bomb: number | null }, kind: "check" | "bomb", i: number) {
  let { check, bomb } = mine;
  if (kind === "check") { check = check === i ? null : i; if (bomb === i) bomb = null; }
  else { bomb = bomb === i ? null : i; if (check === i) check = null; }
  return { check, bomb };
}

/* ------------------------------------------------------------------ reveal (steps are timed by the server's deadline) */
const STEP_MS = [0, 1000, 3000, 5000];
export const stepFor = (elapsedMs: number) => STEP_MS.reduce((s, t, i) => (elapsedMs >= t ? i : s), 0);
export function revealStep(v: any, offset: number, final: boolean): number {
  if (final || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)) return 3;
  return stepFor(v.phase.dur - (v.phase.deadline - (Date.now() + offset)));
}

function stack(v: any, names: string[]) {
  const max = 6;
  const shown = names.length > max ? names.slice(0, max - 1) : names;
  const extra = names.length > max ? `<div class="avatar more">+${names.length - (max - 1)}</div>` : "";
  return shown.map((n) => avatarFor(n, colorOf(v, n))).join("") + extra;
}
export function r1RevealLive(o: Orientation, v: any, status: ConnStatus, offset: number, final: boolean) {
  const d = v.data;
  const step = revealStep(v, offset, final);
  const rows = d.options.map((opt: any, i: number) => `<div class="rrow opt clamp2 ${opt.isTrue ? "res-true" : "res-false"}">
      <div class="letter">${LETTERS[i]}</div>
      <div class="opt-text">${esc(cut(opt.text, LIMITS.option))}</div>
      <div class="verdict ${opt.isTrue ? "true" : "false"}">${opt.isTrue ? "✔ TRUE" : "✘ FAKE"}</div>
      <div class="rbox rcheck"><span class="rico">✅</span><div class="stack">${stack(v, opt.checks)}</div></div>
      <div class="rbox rbomb"><span class="rico">${opt.isTrue ? "\u{1F6E1}️" : "\u{1F4A5}"}</span><div class="stack">${stack(v, opt.bombs)}</div></div>
    </div>`).join("");
  const top = Object.entries<number>(d.deltas).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, p]) => `${n} +${p}`).join(" · ");
  return withOverlay(shell(o, "r1-reveal", {
    round: `Round 1 · Reveal ${d.qi + 1}/4`,
    body: `<div class="r1r">
      <section class="banner card">
        <span class="stamp mint reveal-final">It was ${LETTERS[d.truth]}!</span>
        <div class="banner-text">${esc(top || "Nobody scored this one")}</div>
      </section>
      <section class="rrows" data-step="${step}" data-final="${final ? 1 : 0}" data-start="${v.phase.deadline - v.phase.dur}">${rows}</section>
    </div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ lore card: our own card, never a newspaper screenshot */
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : "");
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

export function loreLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data;
  const url = safeUrl(d.urls?.[0] ?? "");
  const url2 = safeUrl(d.urls?.[1] ?? "");
  const comps = (d.lore.comparisons as { text: string; math: string }[]).slice(0, 3).map((c) =>
    `<div class="lore-comp card"><div class="lc-text">${esc(cut(c.text, LIMITS.lore))}</div><div class="lc-math">${esc(cut(c.math, 40))}</div></div>`).join("");
  const seated = !!v.you?.seated;
  const next = !!d.skipped?.includes(v.you?.name);
  return withOverlay(shell(o, "lore", {
    round: `Round 1 · The Lore ${d.qi + 1}/4`,
    ...timerOf(v, offset),
    body: `<div class="lore">
      <section class="lore-truth card">
        <span class="stamp mint lore-stamp">The truth</span>
        <p class="lore-q">${esc(cut(d.question, LIMITS.question))}</p>
        <p class="lore-a">${esc(cut(d.answer, LIMITS.option))}</p>
      </section>
      <section class="lore-comps">${comps}</section>
      <section class="lore-source card">
        <span class="ls-label">SOURCE</span>
        <span class="ls-name">${esc(d.source?.newspaper ?? "")}</span>
        ${url ? `<a class="ls-btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(host(url))}">VERIFY ↗</a>` : ""}
        ${url2 ? `<a class="ls-btn alt" href="${esc(url2)}" target="_blank" rel="noopener noreferrer" title="${esc(host(url2))}">2ND ↗</a>` : ""}
      </section>
      <section class="lore-actions">
        <div class="ready-wrap">${ready(v)}</div>
        <div class="report-wrap"><button class="btn ghost" data-act="report-open" data-preset="wrong">REPORT ERROR</button></div>
        <div class="lock-wrap">${seated ? `<button class="btn ${next ? "off" : "red"}" data-act="next">${next ? "WAITING…" : "NEXT"}</button>` : `<button class="btn off">WATCHING</button>`}</div>
      </section>
    </div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ fixtures (longest allowed strings) for the layout test */
const fxPlayers = PLAYERS.map((p) => ({ name: p.name, score: p.score, connected: !p.grey, seated: true }));
const fxBase = (kind: string, extra: any = {}) => ({
  you: { name: "Kabir", seated: true, owner: true, score: 0 }, players: fxPlayers,
  phase: { kind, id: 5, deadline: null, dur: 8000, frozen: false, ready: { done: 3, total: 7 }, waiting: false, ...extra },
});
export const fixtureRules = (o: Orientation) => rulesLive(o, { ...fxBase("rules"), data: { next: "r3", skipped: [] } }, "open", 0);
export const fixtureR1Question = (o: Orientation) =>
  r1QuestionLive(o, { ...fxBase("r1q"), data: { qi: 1, question: QUESTION, options: OPTIONS, mine: { check: 1, bomb: 4, locked: false } } }, "open", 0);
export const fixtureR1Reveal = (o: Orientation) =>
  r1RevealLive(o, {
    ...fxBase("r1reveal"),
    data: {
      qi: 1, truth: TRUE_INDEX, deltas: { "Aarav Sharma": 30, Kabir: 20, Ishita: 10 },
      options: OPTIONS.map((t, i) => ({ text: t, isTrue: i === TRUE_INDEX, checks: REVEAL[i].checks.map((k) => PLAYERS[k].name), bombs: REVEAL[i].bombs.map((k) => PLAYERS[k].name) })),
    },
  }, "open", 0, true);
export const fixtureLore = (o: Orientation) =>
  loreLive(o, {
    ...fxBase("r1lore"),
    data: {
      qi: 1, question: QUESTION, answer: OPTIONS[TRUE_INDEX],
      lore: { comparisons: [
        { text: "EXAMPLE: costs as much as 1,000 fictional cups of corner chai", math: "100000 / 100 = 1000" },
        { text: "EXAMPLE: as tall as 3 fictional autos parked nose to tail", math: "9 m / 3 m = 3" },
        { text: "EXAMPLE: heavier than 12 fictional Labrador puppies together", math: "300 kg / 25 kg = 12" },
      ], card_caption: "EXAMPLE" },
      source: { newspaper: "EXAMPLE ONLY - NOT REAL NEWS" }, urls: ["https://example.com/example-only", "https://example.com/example-only-2"],
    },
  }, "open", 0);
void LETTERS;
