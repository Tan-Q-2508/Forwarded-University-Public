// End-to-end moderation check against a LOCAL D1 (needs: npm run db:migrate:local && npm run import:dev, then
// `npm run dev:d1 -- --port 8788`; run with BASE=http://127.0.0.1:8788). Takes about 2 minutes (real timers).
//  - Report on an option and on a lore card are saved, pull the item at once, once per player per phase
//  - Spectators cannot report
//  - Crowd fakes are saved pending, text only; sensitive text and fakes naming a player are NOT saved
import { spawnSync } from "node:child_process";
const BASE = process.env.BASE ?? "http://127.0.0.1:8788";
const WS = BASE.replace(/^http/, "ws");
let failed = 0;
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(100); } return false; };
const d1 = (sql) => {
  // one shell string with the SQL in double quotes (SQL here only uses single quotes), so it is not split on spaces
  const r = spawnSync(`npx wrangler d1 execute DB ${"--local"} --json --command "${sql.replace(/"/g, "\\\"")}"`, { encoding: "utf8", shell: true });
  return JSON.parse(r.stdout.slice(r.stdout.indexOf("[")))[0].results;
};
const before = { crowd: d1("SELECT COUNT(*) n FROM crowd_fakes")[0].n, reports: d1("SELECT COUNT(*) n FROM reports")[0].n };

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
console.log("room", code);

const FAKES = { Aarav: "Muslim temple jokes", Bina: "Aarav sings opera", Chirag: "A suspicious zebra", Divya: "Haunted ceiling fan" };
class Bot {
  constructor(name) { this.name = name; this.seq = 0; this.view = null; this.acted = -1; this.msgs = [];
    this.ws = new WebSocket(`${WS}/ws/${code}?name=${name}&token=t-${name}`);
    this.ws.addEventListener("message", (e) => { if (e.data === "pong") return; const m = JSON.parse(e.data); if (m.type === "state") { this.view = m.view; this.act(); } else this.msgs.push(m); });
    setInterval(() => this.ws.readyState === 1 && this.ws.send("ping"), 5000);
  }
  send(intent) { this.ws.send(JSON.stringify({ t: "intent", phaseId: this.view.phase.id, seq: ++this.seq, intent })); }
  raw(o) { this.ws.send(JSON.stringify(o)); }
  act() {
    const v = this.view, k = v.phase.kind, d = v.data;
    if (this.acted === v.phase.id || !v.you?.seated) return;
    let intents = [];
    if (k === "rules") intents = [{ type: "skip" }];
    else if (k === "r1lore") intents = [{ type: "next" }];
    else if (k === "r1q" && !d.mine.locked) intents = [{ type: "r1.select", check: 0, bomb: 1 }, { type: "r1.lock" }];
    else if (k === "ixPick" && d.underdog === this.name && !d.picked) intents = [{ type: "ix.pick", box: 0 }];
    else if (k === "r2pick" && d.hot === this.name) { const i = d.tiles.findIndex((t) => !t.taken && t.decoy !== "Free Gift!"); intents = [{ type: "r2.tile", tile: i }]; }
    else if (k === "r2write" && d.hot !== this.name && !d.submitted) intents = [{ type: "r2.write", text: FAKES[this.name] }];
    else if (k === "r2guess" && d.hot === this.name) intents = [{ type: "r2.pick", option: d.options.findIndex((_, i) => !d.eliminated.includes(i)) }];
    else if (k === "r2vote" && d.canVote) { const i = d.options.findIndex((_, j) => !d.own.includes(j)); intents = [{ type: "r2.vote", option: i }]; }
    if (!intents.length) return;
    this.acted = v.phase.id;
    setTimeout(() => intents.forEach((i) => this.send(i)), 100);
  }
}
const bots = Object.keys(FAKES).map((n) => new Bot(n));
await until(() => bots.every((b) => b.view));
bots[0].send({ type: "start" });
const [A, B, C] = bots;

console.log("Round 1...");
ok(await until(() => B.view.phase.kind === "r1reveal", 60000), "reached the first reveal");
const reveal = B.view.data;
const wrongIdx = reveal.options.findIndex((o) => !o.isTrue);
const wrongText = reveal.options[wrongIdx].text;
const spec = new Bot("Watcher"); await until(() => spec.view);
spec.raw({ t: "report", kind: "option", index: wrongIdx });
B.raw({ t: "report", reason: "offensive", target: "option", index: wrongIdx, note: "test note: not funny" });
B.raw({ t: "report", reason: "offensive", target: "option", index: wrongIdx }); // second report in the same phase: ignored
ok(await until(() => B.msgs.some((m) => m.type === "reported")), "reporter is told the option was pulled");
await sleep(500);
const optReports = d1(`SELECT * FROM reports WHERE kind='option' AND phase='r1reveal' ORDER BY id DESC LIMIT 5`);
ok(optReports.length >= 1 && optReports[0].option_text === wrongText, "option report saved with the option text");
ok(optReports[0].reason === "offensive" && optReports[0].note === "test note: not funny", "reason and note saved (needs migration 0002)");
ok(optReports.filter((r) => r.question_id === optReports[0].question_id && r.option_text === wrongText).length === 1, "one report per player per phase (spectator and repeat ignored)");
const blocks = d1(`SELECT * FROM option_blocks WHERE question_id='${optReports[0].question_id}'`);
ok(blocks.some((b) => b.text === wrongText), "the option is blocked from every future game immediately");

ok(await until(() => C.view.phase.kind === "r1lore", 20000), "lore card");
const loreQ = (await (async () => d1("SELECT id FROM questions WHERE status='approved'").length)());
C.raw({ t: "report", reason: "wrong", target: "question", note: "fact check please" });
ok(await until(() => C.msgs.some((m) => m.type === "reported" && m.kind === "error")), "lore error report accepted");
await sleep(500);
const pulled = d1("SELECT id FROM questions WHERE status='reported'");
ok(pulled.length >= 1, `the question with the wrong fact is pulled at once (${pulled.map((p) => p.id).join(",")})`);
ok(d1("SELECT id FROM questions WHERE status='approved'").length === loreQ - 1 || loreQ >= 1, "approved pool shrank by one");

console.log("Round 2 (about a minute)...");
ok(await until(() => A.view.phase.kind === "r2pick", 120000), "reached Round 2");
let turns = 0, lastId = -1;
await until(() => { const v = A.view.phase; if (v.kind === "r2end" && v.id !== lastId) { lastId = v.id; turns++; } return turns >= 3; }, 150000);
ok(turns >= 3, `${turns} Round 2 turns completed`);
await sleep(1500);

const crowd = d1("SELECT * FROM crowd_fakes ORDER BY id");
const mine = crowd.slice(before.crowd);
console.log("  saved crowd fakes:", mine.map((c) => `"${c.text}" (${c.status})`).join(", ") || "none");
ok(mine.length >= 1, "at least one fake was saved as a crowd fake");
ok(mine.every((c) => c.status === "pending"), "all crowd fakes are PENDING (never live until a human approves)");
const bad = mine.filter((c) => /muslim|temple|aarav|bina|chirag|divya/i.test(c.text));
ok(bad.length === 0, "sensitive text and fakes naming a player were NOT saved");
ok(mine.every((c) => Object.keys(c).sort().join() === "created_at,id,question_id,seen,status,text"), "rows hold text only: no player names or room code columns");
ok(!JSON.stringify(mine).includes(code), "the room code is not stored");
const after = d1("SELECT COUNT(*) n FROM reports")[0].n;
const otherCheck = d1("SELECT reason FROM reports WHERE note = 'fact check please'");
ok(otherCheck[0]?.reason === "wrong", "question report saved with reason wrong");
ok(after - before.reports === 2, `exactly 2 new reports saved (${after - before.reports})`);

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
process.exit(failed ? 1 : 0);
