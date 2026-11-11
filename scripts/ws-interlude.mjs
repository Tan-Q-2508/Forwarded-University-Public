// Scenario over real WebSockets (needs `npm run dev:worker`): 4 bots play Round 1, then the Interlude.
// The Dealer's bot reads the box contents, the Underdog picks the Curse Box, two other bots tap BUSTED!.
// Checks who sees what at every step. Takes about 45 s (real timers).
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
let failed = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); } return false; };
let a = 12345;
const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
console.log("room", code);

class Bot {
  constructor(name) { this.name = name; this.seq = 0; this.view = null; this.acted = -1; this.auto = true;
    this.ws = new WebSocket(`${WS}/ws/${code}?name=${name}&token=t-${name}`);
    this.ws.addEventListener("message", (e) => { if (e.data === "pong") return; const m = JSON.parse(e.data); if (m.type === "state") { this.view = m.view; this.act(); } });
    setInterval(() => this.ws.readyState === 1 && this.ws.send("ping"), 5000);
  }
  send(intent) { this.ws.send(JSON.stringify({ t: "intent", phaseId: this.view.phase.id, seq: ++this.seq, intent })); }
  act() {
    const v = this.view, k = v.phase.kind;
    if (!this.auto || this.acted === v.phase.id || !v.you?.seated) return;
    if (k === "rules") { this.acted = v.phase.id; setTimeout(() => this.send({ type: "skip" }), 100); }
    else if (k === "r1lore") { this.acted = v.phase.id; setTimeout(() => this.send({ type: "next" }), 100); }
    else if (k === "r1q" && !v.data.mine.locked) {
      this.acted = v.phase.id; const n = v.data.options.length, c = Math.floor(rnd() * n); let b = Math.floor(rnd() * n); if (b === c) b = null;
      setTimeout(() => { this.send({ type: "r1.select", check: c, bomb: b }); this.send({ type: "r1.lock" }); }, 100);
    }
  }
}
const names = ["Aarav", "Bina", "Chirag", "Divya"];
const bots = names.map((n) => new Bot(n));
await until(() => bots.every((b) => b.view));
bots[0].send({ type: "start" });

console.log("playing Round 1 (about 40 s)...");
ok(await until(() => bots[0].view.phase.kind === "ixPick", 120000), "Round 1 ends in the Interlude");
const v0 = bots[0].view;
const by = Object.fromEntries(bots.map((b) => [b.name, b]));
const { underdog, dealer } = v0.data;
const scores = Object.fromEntries(v0.players.map((p) => [p.name, p.score]));
ok(underdog !== dealer, `Dealer ${dealer} and Underdog ${underdog} are different players`);
ok(Object.values(scores).every((s) => s >= scores[underdog]), "Underdog has the lowest score (ties allowed)");
ok(Object.values(scores).every((s) => s <= scores[dealer]), "Dealer has the highest score (ties allowed)");
ok(Array.isArray(by[dealer].view.data.boxes) && by[dealer].view.data.boxes.length === 3, "only the Dealer is told what is in the boxes");
ok(bots.filter((b) => b.name !== dealer).every((b) => b.view.data.boxes === undefined), "nobody else is told");

const cIdx = by[dealer].view.data.boxes.indexOf("C");
by[underdog].send({ type: "ix.pick", box: cIdx });
ok(await until(() => by[underdog].view.phase.kind === "ixResult", 5000), "Underdog's pick opens the result screen");
ok(by[underdog].view.data.kind === "C" && by[dealer].view.data.kind === "C", "the Curse Box was opened (public result)");
const cu = by[underdog].view.curse;
ok(cu?.mine && typeof cu.text === "string" && cu.text.length > 0 && cu.text.length <= 70, "cursed player is shown the curse text (<= 70 chars)");
const others = bots.filter((b) => b.name !== underdog);
ok(others.every((b) => b.view.curse?.active && !b.view.curse.mine && b.view.curse.text === undefined), "everyone else knows someone is cursed but not the text");
ok(JSON.stringify(others[0].view).indexOf(cu.text) === -1, "the curse text appears nowhere in other players' views");
const after = Object.fromEntries(by[underdog].view.players.map((p) => [p.name, p.score]));
ok(after[underdog] === scores[underdog] + 1, "Underdog got +1 from the Curse Box");

bots.forEach((b) => (b.auto = false));
bots.forEach((b) => (b.acted = -1));
ok(await until(() => by[underdog].view.phase.kind === "rules", 10000), "after the 5 s result: Round 2 rules card");
bots.forEach((b) => b.send({ type: "skip" }));
ok(await until(() => by[underdog].view.phase.kind === "r2pick", 20000), "everyone skips: Round 2 begins");
ok(by[underdog].view.data.hot === underdog, "the cursed player takes the first Hot Seat");

const [s1, s2] = others.filter((b) => b.name !== underdog);
const before = by[s1.name].view.players.find((p) => p.name === s1.name).score;
s1.send({ type: "snitch" });
ok(await until(() => s2.view.curse?.window?.votes === 1, 3000), "first BUSTED! tap opens a window: 1 vote");
ok(s2.view.curse.window.need === 2 && s1.view.curse.window.voted === true && s2.view.curse.window.voted === false, "window shows need=2 and who has voted");
s2.send({ type: "snitch" });
ok(await until(() => by[underdog].view.curse === null && s1.view.curse === null, 3000), "second tap reaches the threshold: the curse is over for everyone");
const after2 = s1.view.players.find((p) => p.name === s1.name).score;
ok(after2 === before + 15, "first tapper earned +15");

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
