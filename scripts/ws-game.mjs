// TEST BOTS: play a WHOLE game (rules, Round 1, Interlude, Round 2, Round 3, podium) over real WebSockets through
// the real Room Durable Object, dropping and rejoining at random moments. Needs `npm run dev:worker`.
// Usage: node scripts/ws-game.mjs [players=4] [seed=1] [dropRate=0.04] [existingRoomCode]      (about 3 to 5 minutes: real timers)
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const N = Number(process.argv[2] ?? 4), seed0 = Number(process.argv[3] ?? 1), DROP = Number(process.argv[4] ?? 0.04);
let a = (seed0 * 2654435761) >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ["Aarav", "Bina", "Chirag", "Divya", "Esha", "Farhan", "Gita", "Hari"].slice(0, N);

const JOIN = process.argv[5]; // optional: join an existing room; the human host presses Start in a browser
const NAMELIST = await (await fetch(`${BASE}/api/names`)).json(); // real Round 3 dropdown names
const code = JOIN ?? (await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json()).code;
console.log(`room ${code}, ${N} bots, seed ${seed0}, drop rate ${DROP}`);
const seen = new Set(), stats = { closes: [], drops: 0, rejoins: 0, errors: [], rejected: 0, sent: 0, pings: 0 };
let finished = false, last = null;
const t0 = Date.now();

/** What a client would do with this view (reads only the view, like the real UI). */
function brain(v, name) {
  const d = v.data, k = v.phase.kind;
  switch (k) {
    case "rules": return [{ type: "skip" }];
    case "r1lore": return [{ type: "next" }];
    case "r1q": { if (d.mine.locked) return []; const n = d.options.length, c = ri(n); let b = ri(n); if (b === c) b = null; return [{ type: "r1.select", check: c, bomb: b }, { type: "r1.lock" }]; }
    case "ixPick": return d.underdog === name && !d.picked ? [{ type: "ix.pick", box: ri(3) }] : [];
    case "r2pick": { if (d.hot !== name) return []; const f = d.tiles.map((t, i) => (t.taken ? -1 : i)).filter((i) => i >= 0); return f.length ? [{ type: "r2.tile", tile: f[ri(f.length)] }] : []; }
    case "r2write": { if (name === d.hot || d.submitted) return []; const x = rnd(); if (x < 0.15) return [{ type: "r2.write", text: d.real }, { type: "r2.preset" }]; return [{ type: "r2.write", text: `Fake ${ri(5)} by ${name}` }]; }
    case "r2guess": { if (d.hot !== name) return []; const f = d.options.map((_, i) => (d.eliminated.includes(i) ? -1 : i)).filter((i) => i >= 0); return [{ type: "r2.pick", option: f[ri(f.length)] }]; }
    case "r2vote": { if (!d.canVote) return []; const f = d.options.map((_, i) => (d.own.includes(i) ? -1 : i)).filter((i) => i >= 0); return f.length ? [{ type: "r2.vote", option: f[ri(f.length)] }] : []; }
    case "r3wager": return d.locked ? [] : [{ type: "r3.lock", pct: ri(21) * 5 }];
    case "r3hint": { const m = d.mine; if (!m || m.solved || m.acted || m.triesLeft <= 0) return []; return rnd() < 0.55 ? [{ type: "r3.pass" }] : [{ type: "r3.guess", name: NAMELIST[ri(NAMELIST.length)] }]; }
    case "postgame": return [{ type: "again" }];
    default: return [];
  }
}

class Bot {
  constructor(name) { this.name = name; this.seq = 0; this.view = null; this.acted = -1; this.dropped = new Set(); }
  connect() {
    const ws = (this.ws = new WebSocket(`${WS}/ws/${code}?name=${this.name}&token=tok-${this.name}`));
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      const m = JSON.parse(e.data);
      if (m.type === "error") stats.errors.push(`${this.name}:${m.code}`);
      else if (m.type === "rejected") stats.rejected++;
      else if (m.type === "state") { this.view = m.view; this.onState(); }
    });
    this.ping = setInterval(() => { if (ws.readyState === 1) { stats.pings++; ws.send("ping"); } }, 5000);
    ws.addEventListener("close", (e) => { clearInterval(this.ping); if (!this.deliberate && !finished) { stats.closes.push(`${this.name}:${e.code}:${e.reason}`); console.log(`UNEXPECTED CLOSE ${this.name} code ${e.code} ${e.reason} at ${last} +${Math.round((Date.now() - t0) / 1000)}s`); } const was = this.deliberate; this.deliberate = false; if (!was && !finished) { stats.unexpected = (stats.unexpected ?? 0) + 1; this.view = null; setTimeout(() => !finished && this.connect(), 400 + rnd() * 1600); /* like the real client: reconnect after a lost connection */ } });
  }
  send(intent) { if (this.ws?.readyState === 1 && this.view) stats.sent++; if (this.ws?.readyState === 1 && this.view) this.ws.send(JSON.stringify({ t: "intent", phaseId: this.view.phase.id, seq: ++this.seq, intent })); }
  async dropAndRejoin(ms) { stats.drops++; this.deliberate = true; try { this.ws.close(); } catch {} this.view = null; await sleep(ms); if (!finished) { stats.rejoins++; this.connect(); } }
  onState() {
    const v = this.view, k = v.phase.kind, id = v.phase.id;
    last = k; seen.add(k);
    if (k === "podium" || k === "postgame") finished = true;
    if (!v.you?.seated || k === "lobby") return;
    if (rnd() < DROP && !this.dropped.has(id)) { this.dropped.add(id); this.acted = -1; return void this.dropAndRejoin(300 + rnd() * 2500); }
    if (v.curse?.active && v.curse.canSnitch && rnd() < 0.15) setTimeout(() => this.send({ type: "snitch" }), 200 + rnd() * 1500);
    if (this.acted === id) return;
    const intents = brain(v, this.name);
    if (!intents.length) return;
    this.acted = id;
    setTimeout(() => { for (const i of intents) this.send(i); }, 150 + rnd() * 900);
  }
}

const bots = NAMES.map((n) => new Bot(n));
bots.forEach((b) => b.connect());
await sleep(800);
if (!JOIN) bots[0].send({ type: "start" });
while (!finished && Date.now() - t0 < 1_200_000) await sleep(1000);

const need = ["rules", "r1q", "r1reveal", "r1lore", "ixPick", "ixResult", "r2pick", "r2write", "r2guess", "r2reveal", "r3wager", "r3hint", "r3reveal", "podium"];
// with heavy drops a disconnected hot seat is (correctly) skipped, so the per-turn phases may never appear
const turnOnly = new Set(["r2write", "r2guess", "r2reveal"]);
const missing = need.filter((k) => !seen.has(k) && !(DROP > 0.02 && turnOnly.has(k)));
const board = bots.find((b) => b.view)?.view.players ?? [];
const okScores = board.every((p) => Number.isInteger(p.score) && p.score >= 0);
const ok = finished && !missing.length && okScores && !stats.errors.length;
console.log(`${ok ? "PASS" : "FAIL"}: reached ${last}, phases seen ${seen.size}, missing [${missing}], drops ${stats.drops}/${stats.rejoins} rejoins, rejected fakes ${stats.rejected}, errors [${stats.errors}], incoming messages ${stats.sent} (+${stats.pings} heartbeats auto-answered), scores ${board.map((p) => `${p.name}:${p.score}`).join(" ")} in ${Math.round((Date.now() - t0) / 1000)}s`);
bots.forEach((b) => { try { b.ws.close(); } catch {} });
process.exit(ok ? 0 : 1);
