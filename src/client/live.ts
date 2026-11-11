/* eslint-disable @typescript-eslint/no-explicit-any */
// Screens that render a LIVE server view (home, lobby, generic phase placeholder). The server sends the view;
// this file only draws it. Anything the server did not send is not drawn.
import { LIMITS, PLAYERS, ROOM_CODE } from "./fixtures";
import { avatarFor, cut, esc, setChrome, shell, withOverlay, type ConnStatus, type Orientation } from "./ui";
import { reportable } from "./report";
import { loreLive, r1QuestionLive, r1RevealLive, rulesLive } from "./r1";
import { curseStrip, ixPickLive, ixResultLive } from "./ix";
import { podiumLive, postgameLive } from "./end";
import { r3HintLive, r3RevealLive, r3WagerLive, type R3Ui } from "./r3";
import { r2EndLive, r2GuessLive, r2PickLive, r2RevealLive, r2VoteLive, r2WriteLive, type WriteUi } from "./r2";
export type { ConnStatus };

const secondsLeft = (deadline: number | null, offset: number) =>
  deadline === null ? "" : String(Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000)));

/* ------------------------------------------------------------------ home (create / join) */
export interface HomeState { code: string; name: string; error: string; busy: boolean }

export function homeScreen(o: Orientation, h: HomeState) {
  setChrome(false);
  return shell(o, "home", {
    round: "Welcome",
    body: `<div class="home">
      <section class="home-title">
        <div class="ht-big">FORWARDED<br>UNIVERSITY</div>
        <div class="ht-sub">Real news. Fake news. Bluff your friends.</div>
      </section>
      <section class="home-card card">
        <input id="in-code" class="field code-field" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="4" placeholder="ROOM CODE" value="${esc(h.code)}" aria-label="Room code" />
        <input id="in-name" class="field" autocomplete="off" spellcheck="false" maxlength="${LIMITS.name}" placeholder="YOUR NAME" value="${esc(h.name)}" aria-label="Your name" />
        <div class="home-btn"><button class="btn red ${h.busy ? "off" : ""}" data-act="join">JOIN ROOM</button></div>
        <div class="home-btn"><button class="btn ${h.busy ? "off" : ""}" data-act="create">CREATE ROOM</button></div>
        <div class="home-err" role="alert">${esc(h.error)}</div>
      </section>
      <div class="home-how"><button class="btn mint" data-act="rules-open">📖 HOW TO PLAY</button></div>
    </div>`,
  });
}
export const fixtureHomeScreen = (o: Orientation) => homeScreen(o, { code: "KXRT", name: "Aarav Sharma", error: "That name is already in use in this room.", busy: false });

/* ------------------------------------------------------------------ lobby */
export function lobbyLive(o: Orientation, v: any, status: ConnStatus = "open") {
  const seated = v.players.filter((p: any) => p.seated);
  const watching = v.players.filter((p: any) => !p.seated).length;
  const connected = seated.filter((p: any) => p.connected).length;
  const me = v.you;
  const slots = Array.from({ length: 8 }, (_, i) => {
    const p = seated[i];
    if (!p) return `<div class="slot card empty"><div class="avatar grey">?</div><div class="slot-info"><div class="slot-name">OPEN SEAT</div><div class="slot-status">&nbsp;</div></div></div>`;
    const st = !p.connected ? "GREYED OUT" : p.ready ? "✓ READY" : "WAITING";
    const host = p.name === v.owner ? " • HOST" : "";
    return `<div class="slot card ${!p.connected ? "grey" : ""}">
      ${avatarFor(p.name, i, !p.connected ? "grey" : "")}
      <div class="slot-info"><div class="slot-name">${esc(cut(p.name, LIMITS.name))}</div>
      <div class="slot-status ${p.ready && p.connected ? "ok" : ""}">${st}${host}</div></div>
    </div>`;
  }).join("");
  const tiles = String(v.code).split("").map((c) => `<div class="code-tile">${esc(c)}</div>`).join("");
  const owner = !!me?.owner;
  const iAmReady = !!me && !!v.players.find((p: any) => p.name === me.name)?.ready;
  const canStart = owner && connected >= 3;
  return withOverlay(shell(o, "lobby", {
    round: "Lobby",
    body: `<div class="lobby">
      <section class="code-card card">
        <div class="kicker">ROOM CODE</div>
        <div class="code">${tiles}</div>
        <div class="code-help">Share it on your call</div>
        <div class="code-spec"><span class="pill sun">${watching} WATCHING</span></div>
      </section>
      <section class="roster">${slots}</section>
      <section class="lobby-actions">
        <button class="btn ghost toggle ${owner ? "" : "off"}" data-act="curses" data-on="${v.curses ? 1 : 0}">\u{1F92C} Verbal curses: ${v.curses ? "ON" : "OFF"}</button>
        ${me?.seated ? `<button class="btn mint" data-act="ready" data-on="${iAmReady ? 1 : 0}">${iAmReady ? "NOT READY" : "I'M READY"}</button>` : `<button class="btn off">WATCHING</button>`}
        <button class="btn red ${canStart ? "" : "off"}" data-act="start">${owner ? (connected >= 3 ? "START GAME" : "NEED 3 PLAYERS") : "HOST STARTS"}</button>
      </section>
    </div>`,
  }), status);
}

export const fixtureLobby = (o: Orientation) =>
  lobbyLive(o, {
    code: ROOM_CODE, curses: true, owner: "Kabir",
    you: { name: "Kabir", owner: true, seated: true, score: 0 },
    players: [...PLAYERS.map((p) => ({ name: p.name, score: 0, connected: !p.grey, seated: true, ready: !!p.ready })), { name: "Spec1", connected: true, seated: false }, { name: "Spec2", connected: true, seated: false }],
  });

/* ------------------------------------------------------------------ generic phase placeholder (rounds are built in later stages) */
const LABEL: Record<string, string> = {
  rules: "RULES CARD", r1q: "ROUND 1 · QUESTION", r1reveal: "ROUND 1 · REVEAL", r1lore: "ROUND 1 · LORE CARD",
  ixPick: "INTERLUDE · MYSTERY BOXES", ixResult: "INTERLUDE · RESULT",
  r2pick: "ROUND 2 · PICK A TILE", r2write: "ROUND 2 · WRITE A FAKE", r2guess: "ROUND 2 · GUESS", r2reveal: "ROUND 2 · REVEAL", r2vote: "ROUND 2 · FUNNIEST FAKE", r2end: "ROUND 2 · NEXT TURN",
  r3wager: "ROUND 3 · WAGER", r3hint: "ROUND 3 · HINTS", r3reveal: "ROUND 3 · REVEAL", podium: "FINAL RESULTS", postgame: "PLAY AGAIN?",
};

export function phaseLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const ph = v.phase;
  const seated = v.players.filter((p: any) => p.seated);
  const cells = Array.from({ length: 8 }, (_, i) => {
    const p = seated[i];
    if (!p) return `<div class="slot card empty"></div>`;
    return `<div class="slot card ${!p.connected ? "grey" : ""}">${avatarFor(p.name, i, !p.connected ? "grey" : "")}
      <div class="slot-info"><div class="slot-name">${esc(cut(p.name, LIMITS.name))}</div><div class="slot-status">${p.score} PTS${!p.connected ? " • AWAY" : ""}</div></div></div>`;
  }).join("");
  const note = v.you && !v.you.seated ? "YOU ARE WATCHING · YOU PLAY NEXT GAME"
    : ph.waiting ? "WAITING FOR FRIENDS TO RETURN…" : "THIS SCREEN IS BUILT IN A LATER STAGE";
  const sec = secondsLeft(ph.deadline, offset);
  const canSkip = ph.kind === "rules" && v.you?.seated;
  return withOverlay(shell(o, "wait", {
    round: LABEL[ph.kind] ?? ph.kind.toUpperCase(),
    timer: sec || undefined,
    hurry: sec !== "" && Number(sec) <= 10,
    timerAttrs: ph.deadline !== null ? `data-deadline="${ph.deadline}"` : "",
    body: `<div class="ph">
      <section class="ph-card card">
        <div class="ph-kind">${esc(LABEL[ph.kind] ?? ph.kind)}</div>
        <div class="ph-note">${esc(note)}</div>
        <div class="ph-ready"><span class="pill sun">${ph.ready.done}/${ph.ready.total} READY</span>${canSkip ? `<div class="ph-skip"><button class="btn red" data-act="skip">SKIP</button></div>` : ""}</div>
      </section>
      ${curseStrip(v, "ph-curse", offset)}
      <section class="ph-players">${cells}</section>
    </div>`,
  }), status, ph.frozen);
}

export const fixtureWait = (o: Orientation) =>
  phaseLive(o, {
    you: { name: "Kabir", seated: true, owner: true, score: 0 },
    players: PLAYERS.map((p) => ({ name: p.name, score: p.score, connected: !p.grey, seated: true })),
    curse: { active: true, mine: false, text: undefined, window: { votes: 1, need: 2, until: 0, voted: false }, cooldownUntil: 0, canSnitch: true },
    phase: { kind: "r1q", id: 3, deadline: null, dur: 90000, frozen: false, ready: { done: 3, total: 7 }, waiting: false },
  }, "open", 0);

/* ------------------------------------------------------------------ dispatcher: which screen shows this phase */
export interface LiveUi { revealFinal: boolean; sel: number | null; voted: number | null; write: WriteUi; r3: R3Ui }
export function liveScreen(o: Orientation, v: any, status: ConnStatus, offset: number, ui: LiveUi) {
  const revealFinal = ui.revealFinal;
  setChrome(reportable(v));
  switch (v.phase.kind) {
    case "lobby": return lobbyLive(o, v, status);
    case "rules": return rulesLive(o, v, status, offset);
    case "r1q": return r1QuestionLive(o, v, status, offset);
    case "r1reveal": return r1RevealLive(o, v, status, offset, revealFinal);
    case "r1lore": return loreLive(o, v, status, offset);
    case "ixPick": return ixPickLive(o, v, status, offset);
    case "ixResult": return ixResultLive(o, v, status, offset);
    case "r2pick": return r2PickLive(o, v, status, offset);
    case "r2write": return r2WriteLive(o, v, status, offset, ui.write);
    case "r2guess": return r2GuessLive(o, v, status, offset, ui.sel);
    case "r2reveal": return r2RevealLive(o, v, status, offset);
    case "r2vote": return r2VoteLive(o, v, status, offset, ui.voted);
    case "r2end": return r2EndLive(o, v, status, offset);
    case "r3wager": return r3WagerLive(o, v, status, offset, ui.r3);
    case "r3hint": return r3HintLive(o, v, status, offset, ui.r3);
    case "r3reveal": return r3RevealLive(o, v, status, offset);
    case "podium": return podiumLive(o, v, status, offset);
    case "postgame": return postgameLive(o, v, status, offset);
    default: return phaseLive(o, v, status, offset);
  }
}
