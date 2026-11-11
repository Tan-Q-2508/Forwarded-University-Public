/* eslint-disable @typescript-eslint/no-explicit-any */
// Two pop-ups that work on every screen: the RULEBOOK (home page and in game, so nobody has to leave the game
// to remember how to play) and the REPORT form (reason + which part + optional note). Both are drawn INSIDE the
// stage with fixed-size boxes, so nothing scrolls and nothing resizes with longer text.
import { cut, esc, type Orientation } from "./ui";

export type Reason = "offensive" | "wrong" | "other";
export interface ReportUi { kind: "report"; reason: Reason | ""; target: number | null; note: string } // target -1 = the question itself
export interface RulesUi { kind: "rules"; tab: number }
export type Modal = ReportUi | RulesUi | null;

export const NOTE_MAX = 140;
const LETTERS = "ABCDEFGHI";

/* ------------------------------------------------------------------ rulebook */
// Numbers below mirror K in src/engine/engine.ts. Keep lines short: the box shows at most 2 lines (landscape) or 3 (portrait).
export const RULEBOOK: { tab: string; lines: string[] }[] = [
  { tab: "BASICS", lines: [
    "3 to 8 friends, one room code, one voice call. Everyone plays on their own phone.",
    "It is every player for themselves. No teams.",
    "Three rounds: True Story, Pick Me Behaviour, Who Am I? A Mystery Box interlude sits in the middle.",
    "Highest score at the end wins. Your score never drops below zero.",
    "Lost signal? Rejoin with the same name and room code. Joined late? You watch until the next game.",
  ] },
  { tab: "ROUND 1", lines: [
    "True Story: 4 questions. Each has one real headline and several funny fakes.",
    "Tap ✅ on the one you think is REAL.",
    "Tap \u{1F4A3} on a DIFFERENT one you think your friends will fall for.",
    "Real pick: +10. Each friend your bomb fools: +10 (max +40). A bomb on the truth does nothing.",
    "After each question a lore card shows the facts and a source link.",
  ] },
  { tab: "INTERLUDE", lines: [
    "Between rounds, last place (the Underdog) picks one of 3 mystery boxes.",
    "First place (the Dealer) secretly sees what is inside and tries to talk them into one.",
    "Box A: +25 points. Box B: double points on your next correct Round 2 guess.",
    "Box C: +1 now and a verbal curse. Survive the first 2 turns of Round 2 for +30.",
    "Cursed player slipping up? Tap SNITCH. Enough snitches voids the bounty.",
  ] },
  { tab: "ROUND 2", lines: [
    "Pick Me Behaviour: everyone gets one Hot Seat turn. Tiles = players + 1 Garbage tile.",
    "Hot Seat picks a tile. Titles are bait. Garbage tile: +20 and a bonus real tile.",
    "Everyone else secretly writes a fake answer (60 letters). Stuck? Tap PRESET LIE.",
    "Hot Seat gets 2 tries to spot the real answer: +25 first try, +10 second.",
    "Each writer who fools the Hot Seat: +20. Funniest fake (voted): +10.",
  ] },
  { tab: "ROUND 3", lines: [
    "Who Am I?: 2 mystery personalities. Before each, secretly wager 0 to 100% of your score.",
    "Five punny hints appear one by one. Each hint: lock a guess or pass.",
    "You get 3 guesses in total. Whether a guess is right or wrong stays private.",
    "Solved on hint 1 or 2: wager x1.5. Hint 3 or 4: x1. Hint 5: x0.5. First solver gets +10.",
    "Not solved? You lose your wager. On zero points you get a free roll of 20.",
  ] },
  { tab: "REPORT", lines: [
    "Saw something offensive, wrong or odd? Tap \u{1F6A9} at the top of any question screen.",
    "Pick the reason, then pick the question or the exact option (A, B, C...). Add a note if you like.",
    "Offensive or wrong items leave the game at once and a human checks them.",
    "You can report once per screen. Thank you for keeping the game clean.",
  ] },
];

export const rulesModalHtml = (o: Orientation, ui: RulesUi) => {
  const tab = Math.max(0, Math.min(RULEBOOK.length - 1, ui.tab));
  const tabs = RULEBOOK.map((t, i) => `<button class="mchip ${i === tab ? "sel" : ""}" data-act="rules-tab" data-i="${i}" aria-pressed="${i === tab}">${esc(t.tab)}</button>`).join("");
  const lines = RULEBOOK[tab].lines.map((l, i) => `<div class="mline"><span class="mnum">${i + 1}</span><span class="mtxt">${esc(l)}</span></div>`).join("");
  return `<div class="modal ${o}" role="dialog" aria-modal="true" aria-label="How to play">
    <div class="mback" data-act="modal-close"></div>
    <div class="mcard rules">
      <div class="mhead"><div class="mtitle">HOW TO PLAY</div><button class="mclose" data-act="modal-close" aria-label="Close">✕</button></div>
      <div class="mtabs">${tabs}</div>
      <div class="mcontent">${lines}</div>
    </div>
  </div>`;
};

/* ------------------------------------------------------------------ report: what can be reported on this screen */
export interface ReportTarget { question: string; parts: { tag: string; text: string }[] }

/** What the player is looking at, so the form can offer "the question" and each option. null = nothing to report here. */
export function reportTarget(v: any): ReportTarget | null {
  const d = v?.data;
  const letters = (xs: string[]) => xs.map((text, i) => ({ tag: LETTERS[i], text }));
  switch (v?.phase?.kind) {
    case "r1q": case "r2guess": case "r2vote": return { question: "THE QUESTION", parts: letters(d.options) };
    case "r1reveal": case "r2reveal": return { question: "THE QUESTION", parts: letters(d.options.map((x: any) => x.text)) };
    case "r1lore": case "r2write": return { question: "THE QUESTION", parts: [] };
    case "r3hint": return { question: "THE PERSON", parts: (d.hints as string[]).map((text, i) => ({ tag: String(i + 1), text })) };
    case "r3reveal": return { question: "THE PERSON", parts: [] };
    default: return null;
  }
}
/** The button shows only to seated players, on screens that have something to report. */
export const reportable = (v: any) => !!v?.you?.seated && reportTarget(v) !== null;

/** Starting point when the form opens (the lore card's REPORT ERROR means "wrong fact about the question"). */
export const newReport = (preset?: "wrong"): ReportUi => (preset ? { kind: "report", reason: "wrong", target: -1, note: "" } : { kind: "report", reason: "", target: null, note: "" });
export const reportReady = (r: ReportUi) => r.reason !== "" && r.target !== null;

const REASONS: { id: Reason; label: string }[] = [
  { id: "offensive", label: "OFFENSIVE" },
  { id: "wrong", label: "WRONG FACT" },
  { id: "other", label: "OTHER" },
];

export function reportModalHtml(o: Orientation, v: any, ui: ReportUi) {
  const t = reportTarget(v) ?? { question: "THE QUESTION", parts: [] };
  const chips = REASONS.map((r) => `<button class="mchip ${ui.reason === r.id ? "sel" : ""}" data-act="rep-reason" data-r="${r.id}" aria-pressed="${ui.reason === r.id}">${r.label}</button>`).join("");
  const row = (i: number, tag: string, text: string) => `<button class="mrow ${ui.target === i ? "sel" : ""}" data-act="rep-target" data-i="${i}" aria-pressed="${ui.target === i}">
      <span class="mtag">${esc(tag)}</span><span class="mrt">${esc(cut(text, 60))}</span></button>`;
  const rows = [row(-1, "?", t.question), ...t.parts.map((p, i) => row(i, p.tag, p.text))].join("");
  const ready = reportReady(ui);
  return `<div class="modal ${o}" role="dialog" aria-modal="true" aria-label="Report">
    <div class="mback" data-act="modal-close"></div>
    <div class="mcard report">
      <div class="mhead"><div class="mtitle">REPORT THIS</div><button class="mclose" data-act="modal-close" aria-label="Close">✕</button></div>
      <div class="mlabel a1">WHAT'S WRONG?</div>
      <div class="mchips">${chips}</div>
      <div class="mlabel a2">WHICH PART?</div>
      <div class="mlist">${rows}</div>
      <div class="mlabel a3">TELL US MORE (OPTIONAL)</div>
      <input id="in-report" class="field mnote" autocomplete="off" spellcheck="false" maxlength="${NOTE_MAX}" placeholder="What offended you or seemed off?" value="${esc(ui.note)}" aria-label="Note" />
      <div class="mbtns"><button class="btn ghost" data-act="modal-close">CANCEL</button><button class="btn red ${ready ? "" : "off"}" data-act="rep-send">SEND REPORT</button></div>
    </div>
  </div>`;
}

export const modalHtml = (o: Orientation, v: any, m: Modal) => (m?.kind === "rules" ? rulesModalHtml(o, m) : m?.kind === "report" ? reportModalHtml(o, v, m) : "");

/** The message the server receives. Index -1 / absent = the question itself. */
export const reportMessage = (r: ReportUi) => ({
  t: "report", reason: r.reason, target: r.target === -1 ? "question" : "option",
  ...(r.target !== null && r.target >= 0 ? { index: r.target } : {}),
  ...(r.note.trim() ? { note: r.note.trim().slice(0, NOTE_MAX) } : {}),
});
