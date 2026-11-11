/* eslint-disable @typescript-eslint/no-explicit-any */
// Final podium and the Play Again screen.
import { LIMITS, PLAYERS } from "./fixtures";
import { avatarFor, cut, esc, shell, withOverlay, type ConnStatus, type Orientation } from "./ui";

const left = (deadline: number | null, offset: number) => (deadline === null ? "" : String(Math.max(0, Math.ceil((deadline - (Date.now() + offset)) / 1000))));
const timerOf = (v: any, offset: number) => {
  const sec = left(v.phase.deadline, offset);
  return { timer: sec || undefined, hurry: sec !== "" && Number(sec) <= 10, timerAttrs: v.phase.deadline !== null ? `data-deadline="${v.phase.deadline}"` : "" };
};
const idxOf = (v: any, name: string) => Math.max(0, v.players.findIndex((p: any) => p.name === name));
const away = (v: any, name: string) => v.players.find((p: any) => p.name === name)?.connected === false;

const CONFETTI = (() => {
  const bits = Array.from({ length: 22 }, (_, k) => {
    const c = ["#ffd60a", "#ff2e93", "#2fb8ff", "#00c48c", "#ff8a1f"][k % 5];
    return `<i style="left:${(k * 97) % 100}%;--t:${(k * 47) % 60}px;background:${c};animation-delay:${-(k % 7)}s;animation-duration:${5 + (k % 4)}s"></i>`;
  }).join("");
  return `<div class="confetti" data-deco>${bits}</div>`;
})();

/** Ranks share a number when scores tie (two champions are both shown as 1). */
export function podiumLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const ranks: { name: string; score: number; rank: number }[] = v.data.ranks;
  const col = (pos: number, cls: string) => {
    const p = ranks[pos];
    if (!p) return "";
    return `<div class="pcol ${cls}">
      <div class="pinfo">${p.rank === 1 ? '<div class="crown">\u{1F3C6}</div>' : ""}${avatarFor(p.name, idxOf(v, p.name), away(v, p.name) ? "grey" : "")}
        <div class="pname">${esc(cut(p.name, LIMITS.name))}</div><div class="pscore">${p.score}</div></div>
      <div class="pblock"><span>${p.rank}</span></div></div>`;
  };
  const rest = ranks.slice(3, 8).map((p) => `<div class="lrow card ${away(v, p.name) ? "grey" : ""}">
      <div class="lrank">${p.rank}</div>${avatarFor(p.name, idxOf(v, p.name), away(v, p.name) ? "grey" : "")}
      <div class="lname">${esc(cut(p.name, LIMITS.name))}</div><div class="lscore">${p.score}</div></div>`).join("");
  return withOverlay(shell(o, "podium", {
    round: "Final Results",
    ...timerOf(v, offset),
    body: `<div class="pod">
      <section class="podium">${col(1, "silver")}${col(0, "gold")}${col(2, "bronze")}</section>
      <section class="leaders">${rest}</section>
      <section class="pod-actions"><div class="pod-msg">${ranks[0] && ranks[1] && ranks[0].rank === ranks[1].rank ? "IT'S A TIE AT THE TOP!" : "WELL PLAYED!"}</div></section>
      ${CONFETTI}
    </div>`,
  }), status, v.phase.frozen);
}

export function postgameLive(o: Orientation, v: any, status: ConnStatus, offset: number) {
  const d = v.data, me = v.you?.name;
  const answered = d.answered.includes(me);
  const seated = !!v.you?.seated;
  const rows = d.ranks.slice(0, 8).map((p: any, i: number) => `<div class="lrow card ${away(v, p.name) ? "grey" : ""}">
      <div class="lrank">${i + 1}</div>${avatarFor(p.name, idxOf(v, p.name), away(v, p.name) ? "grey" : "")}
      <div class="lname">${esc(cut(p.name, LIMITS.name))}</div><div class="lscore">${p.score}</div></div>`).join("");
  return withOverlay(shell(o, "postgame", {
    round: "Play Again?",
    ...timerOf(v, offset),
    body: `<div class="pg">
      <section class="pg-rows">${rows}</section>
      <section class="pg-acts">
        <div class="ready-wrap"><div class="ready-count"><b>${d.answered.length}/${v.phase.ready.total}</b> ANSWERED</div></div>
        <div class="pg-again">${seated ? `<button class="btn ${answered ? "off" : "red"}" data-act="again">${answered ? "WAITING…" : "PLAY AGAIN"}</button>` : `<button class="btn off">WATCHING</button>`}</div>
        <div class="pg-leave">${seated ? `<button class="btn ghost ${answered ? "off" : ""}" data-act="leave">LEAVE</button>` : `<button class="btn ghost" data-act="leave">LEAVE</button>`}</div>
      </section>
    </div>`,
  }), status, v.phase.frozen);
}

/* ------------------------------------------------------------------ fixtures */
const fxPlayers = PLAYERS.map((p) => ({ name: p.name, score: p.score, connected: !p.grey, seated: true }));
const sorted = [...PLAYERS].sort((a, b) => b.score - a.score);
const ranks = sorted.map((p) => ({ name: p.name, score: p.score, rank: 1 + sorted.filter((x) => x.score > p.score).length }));
const base = (kind: string, data: any) => ({
  you: { name: "Kabir", seated: true, owner: true, score: 185 }, players: fxPlayers, curses: true, owner: "Kabir", curse: null,
  phase: { kind, id: 31, deadline: null, dur: 90000, frozen: false, ready: { done: 2, total: 7 }, waiting: false }, data,
});
export const fixturePodium = (o: Orientation) => podiumLive(o, base("podium", { ranks }), "open", 0);
export const fixturePostgame = (o: Orientation) => postgameLive(o, base("postgame", { answered: ["Kabir", "Ishita"], ranks }), "open", 0);
