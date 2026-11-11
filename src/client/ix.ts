/* eslint-disable @typescript-eslint/no-explicit-any */
// Interlude (Mystery Boxes) screens + the curse strip with the BUSTED! snitch button.
import { LIMITS, PLAYERS } from "./fixtures";
import { cut, esc, shell, withOverlay, type ConnStatus, type Orientation } from "./ui";

const left = (deadline: number | null, offset: number) => (deadline === null ? "" : String(Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000))));
const timerOf = (v: any, offset: number) => {
  const sec = left(v.phase.deadline, offset);
  return { timer: sec || undefined, hurry: sec !== "" && Number(sec) <= 10, timerAttrs: v.phase.deadline !== null ? `data-deadline="${v.phase.deadline}"` : "" };
};

/** What each box is. Box C turns into a flat +10 when the room has verbal curses switched off. */
function boxInfo(kind: string, curses: boolean) {
  if (kind === "A") return { title: "SPONSOR CASH", sub: "+25 POINTS RIGHT NOW" };
  if (kind === "B") return { title: "VIP PASS", sub: "DOUBLE POINTS ON YOUR HOT SEAT" };
  return curses ? { title: "THE CURSE BOX", sub: "+1 NOW, A CURSE, +30 IF YOU SURVIVE" } : { title: "SPONSOR TIP", sub: "+10 POINTS RIGHT NOW" };
}

/* ------------------------------------------------------------------ curse strip (cursed player's text, everyone else's BUSTED! button) */
export function curseStrip(v: any, cls: string, offset: number) {
  const c = v.curse;
  if (!c?.active) return "";
  if (c.mine) {
    return `<section class="${cls} curse-strip mine card"><span class="cs-label">YOUR CURSE</span><span class="cs-text">${esc(cut(c.text ?? "", LIMITS.curse))}</span></section>`;
  }
  let label = "BUSTED!", off = false;
  if (c.window) { label = `BUSTED ${c.window.votes}/${c.window.need}`; off = c.window.voted; }
  else if (c.cooldownUntil && c.cooldownUntil > Date.now() + offset) { label = "WAIT…"; off = true; }
  return `<section class="${cls} curse-strip card"><span class="cs-label">SOMEONE IS CURSED</span>
    ${c.canSnitch ? `<div class="cs-btn"><button class="btn red ${off ? "off" : ""}" data-act="snitch">${label}</button></div>` : ""}</section>`;
}

/* ------------------------------------------------------------------ pick */
function boxes(v: any, mode: "pick" | "result") {
  const d = v.data;
  const isUnder = v.you?.name === d.underdog;
  const known: string[] | undefined = d.boxes; // only the Dealer receives this
  return [0, 1, 2].map((i) => {
    const opened = mode === "result" && d.box === i;
    const dim = mode === "result" && !opened;
    const info = opened ? boxInfo(d.kind, v.curses && !d.flat) : known ? boxInfo(known[i], v.curses) : null;
    const clickable = mode === "pick" && isUnder && !d.picked;
    const inner = `<span class="mb-tag">BOX ${i + 1}</span>
      ${info ? `<span class="mb-title">${info.title}</span><span class="mb-sub">${info.sub}</span>` : `<span class="mb-q">?</span>`}`;
    const cls = `mbox ${opened ? "opened" : ""} ${dim ? "dim" : ""} ${known && mode === "pick" ? "peek" : ""} ${clickable ? "can" : ""}`;
    return clickable
      ? `<button class="${cls}" data-act="ixbox" data-i="${i}" aria-label="Open box ${i + 1}">${inner}</button>`
      : `<div class="${cls}">${inner}</div>`;
  }).join("");
}

function roles(v: any) {
  const d = v.data;
  return `<section class="ix-roles"><span class="pill sun">DEALER: ${esc(cut(d.dealer, LIMITS.name))}</span><span class="pill">UNDERDOG: ${esc(cut(d.underdog, LIMITS.name))}</span></section>`;
}

export function ixPickLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data, me = v.you?.name;
  const note = me === d.underdog ? (d.picked ? "OPENING YOUR BOX…" : "YOU ARE THE UNDERDOG. PICK A BOX!")
    : me === d.dealer ? "YOU ARE THE DEALER. TALK THEM INTO ONE!" : `${d.dealer} IS ADVISING ${d.underdog} — LISTEN ON THE CALL!`;
  return withOverlay(shell(o, "ix-pick", {
    round: "Interlude · Mystery Boxes",
    ...timerOf(v, offset),
    body: `<div class="ix">${roles(v)}<p class="ix-note">${esc(cut(note, 70))}</p><section class="mboxes">${boxes(v, "pick")}</section></div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ result */
export function ixResultLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data;
  const info = boxInfo(d.kind, v.curses && !d.flat);
  const note = `${d.underdog} OPENED BOX ${d.box + 1}: ${info.title}!`;
  return withOverlay(shell(o, "ix-result", {
    round: "Interlude · Result",
    ...timerOf(v, offset),
    body: `<div class="ix ix-res"><p class="ix-note big">${esc(cut(note, 70))}</p>
      <section class="mboxes">${boxes(v, "result")}</section>${curseStrip(v, "ix-curse", offset)}</div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ fixtures (longest names + longest curse text) */
const fxPlayers = PLAYERS.map((p) => ({ name: p.name, score: p.score, connected: !p.grey, seated: true }));
const base = (kind: string, data: any, extra: any = {}) => ({
  you: { name: "Kabir", seated: true, owner: false, score: 0 }, players: fxPlayers, curses: true, curse: null,
  phase: { kind, id: 9, deadline: null, dur: 60000, frozen: false, ready: { done: 0, total: 1 }, waiting: false },
  data, ...extra,
});
export const fixtureIxPick = (o: Orientation) =>
  ixPickLive(o, base("ixPick", { underdog: "Meenakshi M.", dealer: "Aarav Sharma", picked: false, boxes: ["C", "A", "B"] }), "open", 0);
export const fixtureIxResult = (o: Orientation) =>
  ixResultLive(o, base("ixResult", { box: 2, kind: "C", underdog: "Kabir", flat: false }, {
    curse: { active: true, mine: true, text: "Speak only in questions until Meenakshi M. laughs out loud, please!!", window: null, cooldownUntil: 0, canSnitch: false },
  }), "open", 0);
