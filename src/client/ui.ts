import { LIMITS, PLAYERS, TICKER, type Player } from "./fixtures";
import { isMuted } from "./sound";
export type Orientation = "land" | "port";


export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Hard length guard, same limits the server enforces. */
export const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Stylised initial badge (never a photo). `i` picks the colour. */
export const avatarFor = (name: string, i: number, extra = "") =>
  `<div class="avatar av-${i % 8} ${extra}">${esc(name.trim().charAt(0).toUpperCase())}</div>`;
export const avatar = (i: number, extra = "") => avatarFor((PLAYERS[i] as Player).name, i, extra);

/**
 * Which header tools to draw. The live dispatcher (and the design gallery) set this before rendering a screen:
 * the rulebook button is on every screen, the report button only where there is a question or hints to report.
 */
export const chrome = { report: false };
export const setChrome = (report: boolean) => { chrome.report = report; };

/** The shared frame: header, body, ticker. */
export function shell(o: Orientation, id: string, o2: { round: string; timer?: string; hurry?: boolean; timerAttrs?: string; body: string }) {
  const logo = o === "land" ? "Forwarded University" : "Forwarded<br>University";
  return `
  <div class="stage ${o}" data-screen="${id}">
    <header class="topbar">
      <div class="logo">${logo}</div>
      <div class="round-tag">${esc(o2.round)}</div>
      ${o2.timer ? `<div class="timer ${o2.hurry ? "hurry" : ""}" aria-label="seconds left" ${o2.timerAttrs ?? ""}>${o2.timer}</div>` : ""}
      <div class="tools">
        <button class="tool" data-act="rules-open" aria-label="How to play and rules">\u{1F4D6}</button>
        ${chrome.report ? `<button class="tool report" data-act="report-open" aria-label="Report this question">\u{1F6A9}</button>` : ""}
        <button class="tool mute" data-act="mute" aria-label="${isMuted() ? "Unmute sound" : "Mute sound"}" aria-pressed="${isMuted()}">${isMuted() ? "\u{1F507}" : "\u{1F50A}"}</button>
      </div>
    </header>
    <main class="body">${o2.body}</main>
    <footer class="ticker">
      <div class="ticker-label">LIVE</div>
      <div class="ticker-track"><div class="ticker-run" data-deco>${esc(TICKER.repeat(2))}</div></div>
    </footer>
  </div>`;
}


export { LIMITS };
export interface Screen {
  id: string;
  label: string;
  render: (o: Orientation) => string;
}

export type ConnStatus = "connecting" | "open" | "reconnecting";

const secondsLeft = (deadline: number | null, offset: number) =>
  deadline === null ? "" : String(Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000)));

export const overlay = (status: ConnStatus, frozen = false) =>
  status === "open" && !frozen ? "" : `<div class="overlay" role="status"><div class="overlay-box">${status === "open" ? "WAITING FOR FRIENDS…" : status === "connecting" ? "CONNECTING…" : "RECONNECTING…"}</div></div>`;

/** Put a modal (rulebook / report form) on top of a finished stage, inside the stage so it scales with it. */
export function withModal(html: string, modal: string) {
  return modal ? html.replace(/<\/div>\s*$/, modal + "</div>") : html;
}

export function withOverlay(html: string, status: ConnStatus, frozen = false) {
  const o = overlay(status, frozen);
  return o ? html.replace(/<\/div>\s*$/, o + "</div>") : html;
}

