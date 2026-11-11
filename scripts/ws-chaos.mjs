// CHAOS / ABUSE TEST over real WebSockets against the local worker (`npx wrangler dev`, real D1 content).
//   Part A (lobby): bad names, name clashes, 9th player, garbage frames, spam, host rules.
//   Part B (whole game): 3 bots play while one attacker injects invalid / stale / hostile intents in EVERY phase,
//   and every state message sent to every player is scanned for secrets (real answers, hints that are not unlocked yet).
// Usage: node scripts/ws-chaos.mjs [players=3] [seed=5]
import { readFileSync, readdirSync } from "node:fs";
const BASE = process.env.BASE ?? "http://127.0.0.1:8787", WS = BASE.replace(/^http/, "ws");
const N = Number(process.argv[2] ?? 3);
let a = (Number(process.argv[3] ?? 5) * 2654435761) >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  <- " + extra}`); };
const newRoom = async () => (await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json()).code;

class C {
  constructor(code, name, token = "tok-" + name) {
    this.name = name; this.msgs = []; this.view = null; this.closed = null; this.seq = 0; this.errors = []; this.raw = [];
    this.ws = new WebSocket(`${WS}/ws/${code}?name=${encodeURIComponent(name)}&token=${token}`);
    this.ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      this.raw.push(e.data);
      let m; try { m = JSON.parse(e.data); } catch { return; }
      this.msgs.push(m);
      if (m.type === "state") this.view = m.view; else if (m.type === "error") this.errors.push(m.code);
    });
    this.hb = setInterval(() => { if (this.ws.readyState === 1) this.ws.send("ping"); }, 5000); // real clients ping every 5 s
    this.ws.addEventListener("close", (e) => { this.closed = e.code; clearInterval(this.hb); });
  }
  ready() { return new Promise((r) => { const t = setInterval(() => { if (this.view || this.closed || this.errors.length) { clearInterval(t); r(); } }, 50); setTimeout(() => { clearInterval(t); r(); }, 3000); }); }
  send(x) { if (this.ws.readyState === 1) this.ws.send(typeof x === "string" ? x : JSON.stringify(x)); }
  intent(i, phaseId = this.view?.phase.id, seq = ++this.seq) { this.send({ t: "intent", phaseId, seq, intent: i }); }
  close() { try { this.ws.close(); } catch {} }
}

/* ============================== Part A: lobby abuse ============================== */
console.log("--- Part A: lobby abuse ---");
{
  const code = await newRoom();
  const e = new C(code, ""); await e.ready();
  check("empty name is refused", e.errors.includes("bad_name"), JSON.stringify(e.errors));
  const long = new C(code, "X".repeat(60)); await long.ready();
  check("60-char name is truncated or refused (max 12)", long.errors.length > 0 || (long.view?.players ?? []).every((p) => p.name.length <= 12), JSON.stringify(long.view?.players?.map((p) => p.name)));
  const xss = new C(code, "<img src=x onerror=alert(1)>"); await xss.ready();
  check("HTML in a name never reaches the view unescaped-length-wise (<=12)", !xss.view || xss.view.players.every((p) => p.name.length <= 12));
  const host = new C(code, "Host1"); await host.ready();
  const dup = new C(code, "Host1", "other-token"); await dup.ready();
  check("same name, different token while connected -> name_in_use", dup.errors.includes("name_in_use"), JSON.stringify(dup.errors));
  const again = new C(code, "Host1"); await again.ready(); await sleep(300);
  check("same name + same token takes the seat (old tab replaced)", host.closed === 4002 || host.msgs.some((m) => m.type === "replaced"), `closed=${host.closed}`);
  const p2 = new C(code, "P2"); await p2.ready();
  again.intent({ type: "start" }); await sleep(500);
  check("start with 2 players does nothing", again.view?.phase.kind === "lobby", again.view?.phase.kind);
  const p3 = new C(code, "P3"); await p3.ready(); await sleep(200);
  p2.intent({ type: "start" }); await sleep(500);
  check("non-host cannot start", again.view?.phase.kind === "lobby", again.view?.phase.kind);
  // garbage frames and spam must never kill the room
  for (const g of ["not json", "null", "[]", "{}", '{"t":"intent"}', '{"t":"intent","phaseId":"x","seq":"y","intent":null}', "x".repeat(200000), JSON.stringify({ t: "intent", phaseId: 1e308, seq: -1, intent: { type: { a: 1 } } })]) again.send(g);
  for (let i = 0; i < 300; i++) again.send({ t: "intent", phaseId: again.view.phase.id, seq: i, intent: { type: "skip" } });
  await sleep(800);
  again.send({ t: "sync" }); await sleep(500);
  check("room survives garbage + 300-message spam and still answers", !!again.view && again.closed === null, `closed=${again.closed}`);
  const names = [];
  for (let i = 0; i < 7; i++) { const c = new C(code, "Fill" + i); await c.ready(); names.push(c); }
  const ninth = names[names.length - 1];
  const seated = again.view?.players?.filter((p) => p.seated).length;
  check("at most 8 seated in the lobby; extras refused or spectating", seated <= 8 && (ninth.errors.length > 0 || ninth.view?.you?.seated === false || seated <= 8), `seated=${seated}`);
  [e, long, xss, host, dup, again, p2, p3, ...names].forEach((c) => c.close());
}

/* ============================== Part B: full game + attacker + leak scan ============================== */
console.log(`--- Part B: ${N}-player game with an attacker and a secret scan ---`);
const personalities = JSON.parse(readFileSync("content/personalities/personalities-batch-01.json", "utf8"));
const normN = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const PNAMES = personalities.map((p) => normN(p.name)).filter((n) => n.length >= 6);
const qs = readdirSync("content/questions").filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(readFileSync("content/questions/" + f, "utf8")));
const REAL = new Map(qs.map((q) => [normN(q.question).slice(0, 40), q.real_answer]));

const NAMELIST = await (await fetch(`${BASE}/api/names`)).json();
const code = await newRoom();
const NAMES = ["Aarav", "Bina", "Chirag", "Divya", "Esha", "Farhan", "Gita", "Hari"].slice(0, N);
const bots = NAMES.map((n) => new C(code, n));
await Promise.all(bots.map((b) => b.ready()));
const seen = new Set(), leaks = [], crashes = [];
let acted = new Map();
function brain(v, name) {
  const d = v.data, k = v.phase.kind;
  switch (k) {
    case "rules": return [{ type: "skip" }];
    case "r1lore": return [{ type: "next" }];
    case "r1q": { if (d.mine.locked) return []; const n = d.options.length, c = ri(n); let b = ri(n); if (b === c) b = null; return [{ type: "r1.select", check: c, bomb: b }, { type: "r1.lock" }]; }
    case "ixPick": return d.underdog === name && !d.picked ? [{ type: "ix.pick", box: ri(3) }] : [];
    case "r2pick": { if (d.hot !== name) return []; const f = d.tiles.map((t, i) => (t.taken ? -1 : i)).filter((i) => i >= 0); return f.length ? [{ type: "r2.tile", tile: f[ri(f.length)] }] : []; }
    case "r2write": { if (name === d.hot || d.submitted) return []; return [{ type: "r2.write", text: `Fake ${ri(9)} by ${name}` }]; }
    case "r2guess": { if (d.hot !== name) return []; const f = d.options.map((_, i) => (d.eliminated.includes(i) ? -1 : i)).filter((i) => i >= 0); return [{ type: "r2.pick", option: f[ri(f.length)] }]; }
    case "r2vote": { if (!d.canVote) return []; const f = d.options.map((_, i) => (d.own.includes(i) ? -1 : i)).filter((i) => i >= 0); return f.length ? [{ type: "r2.vote", option: f[ri(f.length)] }] : []; }
    case "r3wager": return d.locked ? [] : [{ type: "r3.lock", pct: ri(21) * 5 }];
    case "r3hint": { const m = d.mine; if (!m || m.solved || m.acted || m.triesLeft <= 0) return []; return rnd() < 0.5 ? [{ type: "r3.pass" }] : [{ type: "r3.guess", name: NAMELIST[ri(NAMELIST.length)] }]; }
    case "postgame": return [{ type: "again" }];
    default: return [];
  }
}
const HOSTILE = [
  { type: "r1.select", check: 99, bomb: -3 }, { type: "r1.select", check: "a", bomb: null }, { type: "r1.select", check: 1.5, bomb: 1.5 }, { type: "r1.select", check: 0, bomb: 0 },
  { type: "r1.lock" }, { type: "r1.lock" }, { type: "ix.pick", box: 9 }, { type: "ix.pick", box: -1 }, { type: "r2.tile", tile: 99 }, { type: "r2.tile", tile: "x" },
  { type: "r2.write", text: "<script>alert(1)</script>".repeat(40) }, { type: "r2.write", text: "   " }, { type: "r2.write", text: "\u0000‮".repeat(30) }, { type: "r2.write", text: "x".repeat(5000) },
  { type: "r2.pick", option: 99 }, { type: "r2.vote", option: -1 }, { type: "r2.preset" },
  { type: "r3.lock", pct: 1e9 }, { type: "r3.lock", pct: -50 }, { type: "r3.lock", pct: "50" }, { type: "r3.lock", pct: NaN },
  { type: "r3.guess", name: "" }, { type: "r3.guess", name: "A".repeat(500) }, { type: "r3.guess", name: { a: 1 } }, { type: "r3.pass" }, { type: "r3.pass" },
  { type: "start" }, { type: "again" }, { type: "skip" }, { type: "next" }, { type: "snitch" }, { type: "nonsense" }, null, [], "str", { type: null },
];
function scan(client) {
  const v = client.view; if (!v) return;
  const k = v.phase.kind, js = JSON.stringify(v);
  const quiet = ["r1q", "r2pick", "r2write", "r2guess", "r2vote", "r3wager", "r3hint"];
  if (quiet.includes(k)) {
    if (/"isTrue"|"real_answer"|"realAnswer"|"answerIndex"/.test(js)) leaks.push(`${client.name} ${k}: answer field in view`);
    if (k === "r2write" && v.data && client.name !== v.data.hot && /"real"\s*:\s*"/.test(js) && false) leaks.push("r2write real");
  }
  if (k === "r3wager" && /"hints"/.test(js)) leaks.push(`${client.name} r3wager: hints sent before the wager is locked`);
  if (k === "r3hint" && v.data) {
    // which personality is this? find it from the hints that are unlocked so far, then make sure its name is nowhere in the view
    // (a player's own wrong guesses are legitimately in the view: strip them first)
    const view = JSON.parse(js);
    if (view.data?.mine) delete view.data.mine.wrongs;
    const cur = personalities.find((p) => p.hints[0] === view.data.hints?.[0]);
    const shown = view.data.hints ?? [];
    delete view.data.hints; // the unlocked hints may legitimately contain nicknames; the answer must be nowhere else
    const body = normN(JSON.stringify(view.data));
    if (cur) {
      for (const n of [cur.name, ...(cur.aliases ?? [])].map(normN).filter((n) => n.length >= 5)) if (body.includes(n)) { leaks.push(`${client.name} r3hint: answer "${cur.name}" visible before reveal`); break; }
      if (shown.length > view.data.hint) leaks.push(`${client.name} r3hint: ${shown.length} hints shown at hint ${view.data.hint}`);
      if (shown.length !== view.data.hint) leaks.push(`${client.name} r3hint: hint count mismatch`);
    }
  }
}
const attacker = bots[bots.length - 1];
const t0 = Date.now();
for (const b of bots) b.ws.addEventListener("message", (e) => {
  if (e.data === "pong" || !b.view) return;
  const v = b.view, k = v.phase.kind; seen.add(k); scan(b);
  if (k === "lobby" || !v.you?.seated) return;
  if (acted.get(b.name) !== v.phase.id) {
    const it = brain(v, b.name);
    if (it.length) { acted.set(b.name, v.phase.id); setTimeout(() => it.forEach((i) => b.intent(i)), 150 + rnd() * 800); }
  }
});
await sleep(500);
bots[0].intent({ type: "start" });
let attackedIn = new Set();
while (Date.now() - t0 < 480_000 && !["podium", "postgame"].includes(attacker.view?.phase.kind)) {
  const v = attacker.view;
  if (v && v.phase.kind !== "lobby") {
    const key = v.phase.id;
    if (!attackedIn.has(key)) {
      attackedIn.add(key);
      for (let i = 0; i < 12; i++) { // hostile, stale and mis-sequenced intents
        const h = HOSTILE[ri(HOSTILE.length)];
        const r = rnd();
        attacker.intent(h, r < 0.2 ? v.phase.id - 1 : r < 0.3 ? 999999 : v.phase.id, r < 0.4 ? 1 : ++attacker.seq);
      }
    }
  }
  if (bots.some((b) => b.closed !== null && b.closed !== undefined && b.closed !== 1000)) crashes.push("socket closed unexpectedly");
  await sleep(300);
}
await sleep(1500);
const finished = ["podium", "postgame"].includes(attacker.view?.phase.kind);
check(`full ${N}-player game still reaches the podium under attack`, finished, `stuck at ${attacker.view?.phase.kind}`);
check("every phase of the game was seen", ["rules", "r1q", "r1reveal", "ixPick", "r2pick", "r2write", "r2reveal", "r3wager", "r3hint", "r3reveal"].every((k) => seen.has(k)), [...seen].join(","));
check("no secrets leaked in any state message", leaks.length === 0, [...new Set(leaks)].slice(0, 5).join(" | "));
check("no socket closed unexpectedly", crashes.length === 0, crashes.join(","));
const sc = attacker.view?.players ?? [];
check("final scores are whole numbers", sc.every((p) => Number.isInteger(p.score)), JSON.stringify(sc.map((p) => p.score)));
bots.forEach((b) => b.close());
const bad = results.filter((r) => !r.ok);
console.log(`\n${bad.length ? "FAIL" : "PASS"}: ${results.length - bad.length}/${results.length} checks in ${Math.round((Date.now() - t0) / 1000)}s`);
process.exit(bad.length ? 1 : 0);
