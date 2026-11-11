/* eslint-disable @typescript-eslint/no-explicit-any */
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/screens.css";
import "./styles/live.css";
import "./styles/r2.css";
import "./styles/r3.css";
import "./styles/modal.css";
import { homeScreen, liveScreen, type ConnStatus, type HomeState } from "./live";
import { nextSelection, stepFor } from "./r1";
import { matches, outcomesHtml, sugHtml, wagerAmount } from "./r3";
import { isMuted, play, setMuted, unlockAudio } from "./sound";
import { Net } from "./net";
import { REPORT_IDS, SCREENS, type Orientation } from "./screens";
import { modalHtml, newReport, reportMessage, reportReady, type Modal } from "./report";
import { setChrome, withModal } from "./ui";

const root = document.getElementById("stage-root")!;
const nav = document.getElementById("dev-nav")!;
const params = new URLSearchParams(location.search);

/** Landscape stage if the window is wider than tall, portrait otherwise. */
let lockO: Orientation | null = null; // frozen while the phone keyboard is open (the visible area shrinks and must not flip the stage)
function pickOrientation(): Orientation {
  if (lockO) return lockO;
  const forced = params.get("o");
  if (forced === "land" || forced === "port") return forced;
  return window.innerWidth > window.innerHeight ? "land" : "port";
}

/** Scale the whole stage uniformly to fit; the backdrop fills the leftover space. */
function fit() {
  const stage = root.firstElementChild as HTMLElement | null;
  if (!stage) return;
  const o = stage.classList.contains("land") ? "land" : "port";
  const W = o === "land" ? 1920 : 1080;
  const H = o === "land" ? 1080 : 1920;
  const vv = window.visualViewport;
  const vw = vv?.width ?? window.innerWidth;
  const vh = vv?.height ?? window.innerHeight;
  const top = vv?.offsetTop ?? 0;
  // Typing screen with the keyboard up: fit to the WIDTH and pin the stage to the top. The write screen keeps the
  // prompt, text box and buttons in its top ~1000 units, so they stay visible and nothing scrolls.
  if (o === "port" && keyboardMode()) {
    const s = vw / W;
    stage.style.transform = `translate(0px, ${top}px) scale(${s})`;
    return;
  }
  const s = Math.min(vw / W, vh / H);
  stage.style.transform = `translate(${(vw - W * s) / 2}px, ${(vh - H * s) / 2 + top}px) scale(${s})`;
}
const isTyping = (id?: string | null) => id === "in-fake" || id === "in-guess" || id === "in-report";
const keyboardMode = () => params.get("kb") === "1" || (isTyping(document.activeElement?.id) && (window.visualViewport?.height ?? innerHeight) < innerHeight * 0.82);
const mount = (html: string) => { root.innerHTML = html; fit(); };

/* ================================================================== design gallery (#lobby, #r1-question ...) */
const designId = () => SCREENS.find((s) => s.id === location.hash.replace("#", ""))?.id ?? null;

function drawDesign() {
  const id = designId()!;
  setChrome(REPORT_IDS.has(id));
  mount(SCREENS.find((s) => s.id === id)!.render(pickOrientation()));
  document.body.dataset.ready = "1";
  nav.innerHTML = SCREENS.map((s) => `<a href="#${s.id}" ${s.id === id ? 'aria-current="true"' : ""}>${s.label}</a>`).join("");
}

/* ================================================================== the real app */
const store = (k: string, v?: string | null): string | null => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch { /* private mode: the app still works, it just forgets */ }
  return null;
};
const token = (() => { let t = store("fu-token"); if (!t) { t = crypto.randomUUID(); store("fu-token", t); } return t; })();

const ERR: Record<string, string> = {
  name_in_use: "That name is already in use in this room.",
  bad_name: "Names are 1 to 12 characters, no rude words.",
  room_full: "That room is full.",
  room_closed: "That room has closed.",
  replaced: "You opened this room in another tab, so this one stopped.",
  content_not_ready: "The question bank is not loaded yet.",
};

const app = {
  home: { code: (params.get("room") ?? store("fu-code") ?? "").toUpperCase().slice(0, 4), name: store("fu-name") ?? "", error: "", busy: false } as HomeState,
  view: null as any,
  status: "connecting" as ConnStatus,
  net: null as Net | null,
  notice: "",
  wake: null as any,
  revealPid: -1,
  revealFinal: false,
  phaseId: -1,
  sel: null as number | null,
  modal: null as Modal,
  voted: null as number | null,
  write: { draft: "", error: "", offerPreset: false },
  r3: { pct: 25, query: "", chosen: null as string | null, names: [] as string[] },
  namesLoading: false,
};

(window as any).__fu = app; // debug handle for the in-browser checks
function draw() {
  const o = pickOrientation();
  let html: string;
  if (!app.net || !app.view) html = homeScreen(o, app.home);
  else {
    const ph = app.view.phase;
    if (ph.kind === "r1reveal" && app.revealPid !== ph.id) {
      // joined or came back mid-reveal: show the finished result, not a replay (steps are timed by the server)
      app.revealPid = ph.id;
      app.revealFinal = ph.dur - (ph.deadline - (Date.now() + app.net.offset)) > 1500;
    }
    if (ph.id !== app.phaseId) { // new phase: forget taps and drafts from the last one
      app.phaseId = ph.id; app.sel = null; app.voted = null; if (app.modal?.kind === "report") app.modal = null; /* a report form belongs to one screen */  app.write = { draft: "", error: "", offerPreset: false };
      app.r3.pct = app.view.data?.defaultPct ?? 25; app.r3.query = ""; app.r3.chosen = null;
      if (ph.kind === "r3hint" && !app.r3.names.length && !app.namesLoading) {
        app.namesLoading = true;
        fetch("/api/names").then((r) => r.json()).then((n) => { app.r3.names = n; }).catch(() => { /* retry next hint */ }).finally(() => { app.namesLoading = false; });
      }
    } else if (document.activeElement?.id === "in-report") {
      return; // typing a report note: another player's state change must not rebuild the page and drop the keyboard
    } else if ((ph.kind === "r2write" || ph.kind === "r3hint") && isTyping(document.activeElement?.id)) {
      // somebody else's state change must not rebuild the page while you type (it would drop the keyboard)
      const rc = document.querySelector(".ready-count");
      if (rc) rc.innerHTML = `<b>${ph.ready.done}/${ph.ready.total}</b> READY`;
      return;
    }
    html = liveScreen(o, app.view, app.status, app.net.offset, { revealFinal: app.revealFinal, sel: app.sel, voted: app.voted, write: app.write, r3: app.r3 });
  }
  if (app.modal) html = withModal(html, modalHtml(o, app.view, app.modal));
  mount(html);
  if (app.notice) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = app.notice;
    t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite");
    root.firstElementChild!.appendChild(t);
  }
  document.body.dataset.ready = "1";
}

/** Sound for what just changed in the room. Never on the first state after (re)joining: no replays. */
function sfxForState(prev: any, next: any) {
  if (!prev) return;
  const nk = next.phase.kind;
  if (prev.phase.id !== next.phase.id) {
    if (nk === "podium") play("fanfare");
    else if (nk === "r2reveal" || nk === "ixResult") play("reveal");
    else if (nk === "r3reveal") { const row = next.data.rows.find((r: any) => r.name === next.you?.name); play(row && row.delta < 0 ? "wrong" : row && row.delta > 0 ? "correct" : "reveal"); }
    else if (nk !== "r1reveal" && nk !== "lobby") play("whoosh");
  } else if (prev.you && next.you && next.you.score > prev.you.score && nk !== "r1reveal") play("coin");
  if (!prev.curse?.window && next.curse?.window) play("siren");
}
let lastTick = -1;

function toast(msg: string) { app.notice = msg; draw(); setTimeout(() => { if (app.notice === msg) { app.notice = ""; draw(); } }, 3000); }

async function connect(code: string, name: string) {
  app.net?.stop();
  app.view = null;
  app.status = "connecting";
  store("fu-code", code); store("fu-name", name);
  try { app.wake = await (navigator as any).wakeLock?.request("screen"); } catch { /* not allowed: fine */ }
  app.net = new Net(code, name, token, {
    onState: (v) => { sfxForState(app.view, v); app.view = v; draw(); },
    onStatus: (s) => { if (app.status !== s) { app.status = s; if (app.view) draw(); } },
    onFatal: (c) => {
      app.net = null; app.view = null;
      if (c === "room_closed") store("fu-code", null);
      app.home = { ...app.home, busy: false, error: ERR[c] ?? "Could not join: " + c };
      draw();
    },
    onMsg: (m) => {
      if (m.type === "error") toast(m.code === "not_in_list" ? "That name is not in the list." : ERR[m.code] ?? m.code);
      if (m.type === "reported") toast(m.pulled ? "Thanks! It is pulled until we review it." : "Thanks! We will take a look.");
      if (m.type === "guessResult") play(m.correct ? "correct" : "wrong");
      if (m.type === "guessResult") toast(m.correct ? "✔ CORRECT!" : `✘ WRONG. ${m.triesLeft} LEFT`);
      if (m.type === "rejected") {
        const why: Record<string, string> = { empty: "Type something first.", blocked: "Keep it clean, please.", too_close_to_truth: "Too close to the real answer. Try something sillier." };
        app.write = { ...app.write, error: (why[m.reason] ?? "That one will not work.") + (m.offerPreset ? " Or tap PRESET LIE." : ""), offerPreset: !!m.offerPreset };
        draw();
      }
    },
  });
  app.net.connect();
}

async function joinRoom(code: string, name: string) {
  code = code.trim().toUpperCase(); name = name.trim();
  app.home = { code, name, error: "", busy: true };
  if (!/^[A-HJ-KM-NP-Z]{4}$/.test(code)) return fail("Room codes are 4 letters (no I, O or L).");
  if (name.length < 1 || name.length > 12) return fail("Names are 1 to 12 characters.");
  try {
    const r = await (await fetch(`/api/rooms/${code}`)).json();
    if (!r.exists) return fail("No room with that code.");
  } catch { return fail("Could not reach the server."); }
  await connect(code, name);
}
function fail(error: string) { app.home = { ...app.home, busy: false, error }; draw(); }

async function createRoom(name: string) {
  name = name.trim();
  app.home = { ...app.home, name, error: "", busy: true };
  if (name.length < 1 || name.length > 12) return fail("Names are 1 to 12 characters.");
  try {
    const r = await fetch("/api/rooms", { method: "POST" });
    if (!r.ok) return fail("Could not create a room. Try again.");
    await joinRoom((await r.json()).code, name);
  } catch { fail("Could not reach the server."); }
}

root.addEventListener("focusin", (e) => {
  if (!isTyping((e.target as HTMLElement).id)) return;
  lockO = pickOrientation();
  setTimeout(() => { window.scrollTo(0, 0); fit(); }, 250); // after the keyboard animation
});
root.addEventListener("focusout", (e) => {
  if (!isTyping((e.target as HTMLElement).id)) return;
  lockO = null;
  setTimeout(fit, 100);
});
function submitFake() {
  const text = app.write.draft.trim();
  if (!text || !app.net) return;
  app.net.send({ type: "r2.write", text });
}
root.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "wg-range") { // live preview only; the server hears it on release
    app.r3.pct = Number(t.value);
    const d = app.view?.data;
    if (d) {
      const amt = wagerAmount(d.score, app.r3.pct, false);
      document.querySelector(".wg-pct")!.textContent = app.r3.pct + "%";
      document.getElementById("wg-amt")!.textContent = String(amt);
      document.getElementById("wg-outs")!.innerHTML = outcomesHtml(amt, false);
    }
    return;
  }
  if (t.id === "in-guess") {
    app.r3.query = t.value;
    const exact = app.r3.names.find((n) => n.toLowerCase() === t.value.trim().toLowerCase());
    app.r3.chosen = exact ?? null;
    const sug = document.getElementById("sug");
    if (sug) { const list = exact ? [] : matches(app.r3.names, t.value); sug.innerHTML = sugHtml(list); sug.hidden = list.length === 0; }
    document.querySelector('[data-act="guess3"]')?.classList.toggle("off", !app.r3.chosen);
    return;
  }
  if (t.id === "in-fake") {
    app.write.draft = t.value.slice(0, 60);
    const c = document.querySelector<HTMLElement>(".w-count");
    if (c) { c.textContent = String(60 - app.write.draft.length); c.classList.toggle("low", 60 - app.write.draft.length <= 10); }
    document.querySelector('[data-act="write"]')?.classList.toggle("off", !app.write.draft.trim());
    return;
  }
  if (t.id === "in-report" && app.modal?.kind === "report") { app.modal = { ...app.modal, note: t.value.slice(0, 140) }; return; }
  if (t.id === "in-code") { t.value = t.value.toUpperCase().replace(/[^A-Z]/g, ""); app.home.code = t.value; }
  if (t.id === "in-name") app.home.name = t.value;
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && app.modal) { app.modal = null; draw(); } });
root.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key !== "Enter") return;
  const id = (e.target as HTMLElement).id;
  if (id === "in-report") { if (app.modal?.kind === "report" && reportReady(app.modal)) sendReport(); else (e.target as HTMLElement).blur(); }
  else if (id === "in-fake") submitFake();
  else if (id === "in-guess") { const first = app.r3.chosen ?? matches(app.r3.names, app.r3.query)[0]; if (first) { app.r3.chosen = first; app.r3.query = first; sendGuess(); } }
  else if (id?.startsWith("in-")) joinRoom(app.home.code, app.home.name);
});
root.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "wg-range") app.net?.send({ type: "r3.slider", pct: Number(t.value) });
});
function sendGuess() {
  if (!app.net) return;
  if (!app.r3.chosen) return toast("Pick a name from the list.");
  app.net.send({ type: "r3.guess", name: app.r3.chosen });
}
function sendReport() {
  const m = app.modal;
  if (m?.kind !== "report" || !reportReady(m) || !app.net) return;
  app.net.sendRaw(reportMessage(m));
  app.modal = null;
  draw();
}
function leaveRoom() {
  app.net?.send({ type: "leave" });
  const net = app.net;
  setTimeout(() => { net?.stop(); }, 300);
  app.net = null; app.view = null;
  store("fu-code", null);
  app.home = { ...app.home, code: "", busy: false, error: "You left the room." };
  draw();
}
root.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
  if (!b || b.classList.contains("off")) return;
  const on = b.dataset.on === "1";
  switch (b.dataset.act) {
    case "join": return void joinRoom(app.home.code, app.home.name);
    case "create": return void createRoom(app.home.name);
    case "ready": return app.net?.send({ type: "ready", ready: !on });
    case "curses": return app.net?.send({ type: "curses", on: !on });
    case "start": return app.net?.send({ type: "start" });
    case "skip": return app.net?.send({ type: "skip" });
    case "next": return app.net?.send({ type: "next" });
    case "ixbox": return app.net?.send({ type: "ix.pick", box: Number(b.dataset.i) });
    case "snitch": return app.net?.send({ type: "snitch" });
    case "tile": return app.net?.send({ type: "r2.tile", tile: Number(b.dataset.i) });
    case "opt": app.sel = Number(b.dataset.i); return draw();
    case "guess": if (app.sel !== null) app.net?.send({ type: "r2.pick", option: app.sel }); return;
    case "vote": app.voted = Number(b.dataset.i); app.net?.send({ type: "r2.vote", option: app.voted }); return draw();
    case "wager": return app.net?.send({ type: "r3.lock", pct: app.r3.pct });
    case "sug": // picking a name closes the keyboard (iOS keeps focus on the input when a button is tapped) and redraws
      app.r3.chosen = b.dataset.name ?? null; app.r3.query = app.r3.chosen ?? "";
      (document.activeElement as HTMLElement | null)?.blur();
      return draw();
    case "guess3": return sendGuess();
    case "pass": return app.net?.send({ type: "r3.pass" });
    case "unpass": return app.net?.send({ type: "r3.unpass" });
    case "again": return app.net?.send({ type: "again" });
    case "leave": return leaveRoom();
    case "write": return submitFake();
    case "preset": return app.net?.send({ type: "r2.preset" });
    case "lock": return sendLock(true);
    case "unlock": return sendLock(false);
    case "mute": setMuted(!isMuted()); if (!isMuted()) play("click"); return draw();
    case "rules-open": app.modal = { kind: "rules", tab: 0 }; return draw();
    case "rules-tab": if (app.modal?.kind === "rules") app.modal = { kind: "rules", tab: Number(b.dataset.i) }; return draw();
    case "report-open": app.modal = newReport(b.dataset.preset === "wrong" ? "wrong" : undefined); return draw();
    case "rep-reason": if (app.modal?.kind === "report") app.modal = { ...app.modal, reason: b.dataset.r as any }; return draw();
    case "rep-target": if (app.modal?.kind === "report") app.modal = { ...app.modal, target: Number(b.dataset.i) }; return draw();
    case "rep-send": return sendReport();
    case "modal-close": app.modal = null; return draw();
  }
});

// Round 1 taps: instant on screen, the server re-checks every rule and its answer wins.
root.addEventListener("click", (e) => {
  const m = (e.target as HTMLElement).closest("[data-mark]") as HTMLElement | null;
  if (!m || !app.net || app.view?.phase.kind !== "r1q" || app.view.data.mine.locked) return;
  const sel = nextSelection(app.view.data.mine, m.dataset.mark as "check" | "bomb", Number(m.dataset.i));
  app.view.data.mine = { ...app.view.data.mine, ...sel };
  app.net.send({ type: "r1.select", check: sel.check, bomb: sel.bomb });
  draw();
});
function sendLock(lock: boolean) {
  if (!app.net || app.view?.phase.kind !== "r1q") return;
  app.net.send({ type: lock ? "r1.lock" : "r1.unlock" });
  app.view.data.mine = { ...app.view.data.mine, locked: lock };
  draw();
}

// countdowns are display only; the server's deadline decides when a phase ends
setInterval(() => {
  const el = document.querySelector<HTMLElement>(".timer[data-deadline]");
  if (!el || !app.net) return;
  const s = Math.max(0, Math.ceil((Number(el.dataset.deadline) - (Date.now() + app.net.offset)) / 1000));
  el.textContent = String(s);
  el.classList.toggle("hurry", s <= 10);
  if (s <= 5 && s > 0 && s !== lastTick) play("tick");
  lastTick = s;
}, 250);
// reveal animation steps follow the server's clock
setInterval(() => {
  const rows = document.querySelector<HTMLElement>(".rrows[data-start]");
  if (!rows || !app.net || rows.dataset.final === "1") return;
  const step = String(stepFor(Date.now() + app.net.offset - Number(rows.dataset.start)));
  if (rows.dataset.step !== step) {
    rows.dataset.step = step;
    if (step === "1") play("pop");
    else if (step === "2") { play("bomb"); setTimeout(() => play("boom"), 350); }
    else if (step === "3") { // did I back the truth?
      const me = app.view?.you?.name, opts = app.view?.data?.options ?? [];
      play(opts.some((o: any) => o.isTrue && o.checks.includes(me)) ? "correct" : "wrong");
    }
  }
}, 200);

// audio can only start after a tap; every tap also gives a soft click
document.addEventListener("pointerdown", unlockAudio, { capture: true });
document.addEventListener("keydown", unlockAudio, { capture: true });
root.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button, [data-act]") as HTMLElement | null;
  if (!b || b.classList.contains("off")) return;
  const a = b.dataset.act;
  if (a === "mute") return; // plays its own
  play(a === "lock" || a === "wager" || a === "guess" || a === "guess3" || a === "write" ? "lock" : "click");
}, true);

/* ================================================================== boot */
function boot() {
  if (designId()) { document.body.classList.toggle("no-dev", params.get("dev") === "0"); return drawDesign(); }
  document.body.classList.add("no-dev");
  draw();
  const saved = { code: store("fu-code"), name: store("fu-name") };
  if (!params.get("room") && saved.code && saved.name) void joinRoom(saved.code, saved.name); // refresh = back in your seat
}

let lastO = pickOrientation();
const redraw = () => (designId() ? drawDesign() : draw());
window.addEventListener("hashchange", boot);
window.addEventListener("resize", () => { const o = pickOrientation(); if (o !== lastO) { lastO = o; redraw(); } else fit(); });
window.visualViewport?.addEventListener("resize", fit);
boot();
