// TEST BOTS over real WebSockets: players join a real Room Durable Object, play Round 1 (rules card, 4 questions,
// reveals, lore cards), and drop / rejoin at random moments. One bot leaves for good after question 1.
// Needs `npm run dev:worker` running (DEV_CONTENT=1). Usage: node scripts/ws-bots.mjs [players=4] [seed=1] [existingRoomCode]
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
const N = Number(process.argv[2] ?? 4);
const seed0 = Number(process.argv[3] ?? 1);
let a = seed0 * 2654435761 >>> 0;
const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ["Aarav", "Bina", "Chirag", "Divya", "Esha", "Farhan", "Gita", "Hari"].slice(0, N);

const JOIN = process.argv[4]; // optional: join an existing room (host presses Start in a real browser)
const code = JOIN ?? (await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json()).code;
console.log(`room ${code}, ${N} bots, seed ${seed0}`);

const stats = { reveals: new Set(), lore: new Set(), drops: 0, rejoins: 0, errors: [], last: null, maxQ: -1 };
let finished = false;

class Bot {
  constructor(name, leaveAfterQ1 = false) { this.name = name; this.seq = 0; this.view = null; this.ws = null; this.alive = true; this.leaveAfterQ1 = leaveAfterQ1; this.acted = -1; this.dropped = new Set(); }
  connect() {
    const ws = (this.ws = new WebSocket(`${WS}/ws/${code}?name=${this.name}&token=tok-${this.name}`));
    ws.addEventListener("message", (e) => {
      if (e.data === "pong") return;
      const m = JSON.parse(e.data);
      if (m.type === "error") { stats.errors.push(`${this.name}: ${m.code}`); return; }
      if (m.type === "state") { this.view = m.view; this.onState(); }
    });
    this.ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 5000);
    ws.addEventListener("close", () => clearInterval(this.ping));
  }
  send(intent) { if (this.ws?.readyState === 1 && this.view) this.ws.send(JSON.stringify({ t: "intent", phaseId: this.view.phase.id, seq: ++this.seq, intent })); }
  drop() { stats.drops++; try { this.ws.close(); } catch {} this.view = null; }
  async dropAndMaybeRejoin(ms) {
    this.drop();
    if (this.leaveAfterQ1) { this.alive = false; return; }
    await sleep(ms);
    if (!finished) { stats.rejoins++; this.connect(); }
  }
  onState() {
    const v = this.view, k = v.phase.kind, id = v.phase.id;
    stats.last = k;
    if (k === "r1q") stats.maxQ = Math.max(stats.maxQ, v.data.qi);
    if (k === "r1reveal") stats.reveals.add(v.data.qi);
    if (k === "r1lore") stats.lore.add(v.data.qi);
    if (k === "ixPick" || k === "rules" && v.data.next === "r2") { if (stats.reveals.size === 4) finished = true; }
    if (!v.you?.seated || this.acted === id) return;
    const jitter = 100 + rnd() * 900;
    if (rnd() < 0.08 && k !== "lobby" && !this.dropped.has(id)) { this.dropped.add(id); this.acted = -1; return void this.dropAndMaybeRejoin(500 + rnd() * 2500); } // once per phase; plays the phase after rejoining
    if (this.leaveAfterQ1 && k === "r1lore" && v.data.qi === 0) { this.acted = id; return void this.dropAndMaybeRejoin(0); }
    if (k === "rules") { this.acted = id; setTimeout(() => this.send({ type: "skip" }), jitter); }
    else if (k === "r1lore") { this.acted = id; setTimeout(() => this.send({ type: "next" }), jitter); }
    else if (k === "r1q" && !v.data.mine.locked) {
      this.acted = id;
      const n = v.data.options.length, c = Math.floor(rnd() * n); let b = Math.floor(rnd() * n); if (b === c) b = null;
      setTimeout(() => { this.send({ type: "r1.select", check: c, bomb: b }); this.send({ type: "r1.lock" }); }, jitter);
    }
  }
}

const bots = NAMES.map((n, i) => new Bot(n, i === N - 1 && N > 3));
bots.forEach((b) => b.connect());
await sleep(800);
if (!JOIN) bots[0].send({ type: "start" });

const t0 = Date.now();
while (!finished && Date.now() - t0 < 150_000) await sleep(500);
const ok = finished && stats.reveals.size === 4 && stats.lore.size >= 3 && stats.errors.length === 0;
console.log(`${ok ? "PASS" : "FAIL"}: reveals=${[...stats.reveals]} lore=${[...stats.lore]} drops=${stats.drops} rejoins=${stats.rejoins} lastPhase=${stats.last} errors=${stats.errors.join(",") || "none"} in ${Math.round((Date.now() - t0) / 1000)}s`);
bots.forEach((b) => { try { b.ws.close(); } catch {} });
process.exit(ok ? 0 : 1);
