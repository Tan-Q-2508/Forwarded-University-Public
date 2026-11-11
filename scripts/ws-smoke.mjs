// Multi-socket smoke test against a running `wrangler dev` (default http://127.0.0.1:8787).
// Usage: npm run dev:worker   (in another terminal)   then   npm run test:ws
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const WS = BASE.replace(/^http/, "ws");
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(code, name, token) {
    this.name = name; this.view = null; this.msgs = []; this.closed = null; this.seq = 0;
    this.ws = new WebSocket(`${WS}/ws/${code}?name=${encodeURIComponent(name)}${token ? "&token=" + token : ""}`);
    this.ws.addEventListener("message", (e) => {
      if (e.data === "pong") { this.pong = true; return; }
      const m = JSON.parse(e.data); this.msgs.push(m);
      if (m.type === "state") this.view = m.view;
    });
    this.ws.addEventListener("close", (e) => { this.closed = e.code; });
  }
  async ready(ms = 3000) { const t = Date.now(); while (!this.view && !this.closed && Date.now() - t < ms) await sleep(20); return this; }
  intent(intent, phaseId = this.view.phase.id) { this.ws.send(JSON.stringify({ t: "intent", phaseId, seq: ++this.seq, intent })); }
  close() { this.ws.close(); }
}
async function until(fn, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(25); } return false; }

const create = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
const code = create.code;
console.log("room", code);
ok(/^[A-HJ-KM-NP-Z]{4}$/.test(code), "room code is 4 letters, no I/O/L");
ok((await (await fetch(`${BASE}/api/rooms/${code}`)).json()).exists === true, "status says the room exists");
ok((await (await fetch(`${BASE}/api/rooms/ZZZZ`)).json()).exists === false, "unknown room does not exist");

const a = await new Client(code, "Aarav", "tokA").ready();
const b = await new Client(code, "Bina").ready();
const c = await new Client(code, "Chirag").ready();
await until(() => a.view.players.length === 3);
ok(a.view.phase.kind === "lobby" && a.view.players.length === 3, "3 players in the lobby, broadcast to everyone");
ok(a.view.you.owner && !b.view.you.owner, "first player is the owner");

const dup = await new Client(code, "bina").ready();
await until(() => dup.msgs.some((m) => m.code === "name_in_use"));
ok(dup.msgs.some((m) => m.code === "name_in_use") && !dup.view, "same name (any case) is refused: name_in_use, no state sent");
dup.close();
await sleep(100);
ok(a.view.players.length === 3, "the refused socket did not become a player");

a.ws.send("ping");
ok(await until(() => a.pong), "heartbeat ping gets an auto-response pong");

b.intent({ type: "ready", ready: true });
ok(await until(() => a.view.players.find((p) => p.name === "Bina").ready), "ready toggle reaches the other players");

b.intent({ type: "start" });
await sleep(150);
ok(a.view.phase.kind === "lobby", "only the owner can start");
a.intent({ type: "start" });
ok(await until(() => a.view.phase.kind === "rules"), "owner starts the game -> rules card");
ok(b.view.phase.deadline > Date.now() - 5000, "phase deadline is a server timestamp");

const late = await new Client(code, "Latecomer").ready();
ok(late.view.you.seated === false, "mid-game joiner is a spectator");
late.intent({ type: "skip" });

b.close();
ok(await until(() => a.view.players.find((p) => p.name === "Bina").connected === false), "closed socket greys the player out");
const b2 = await new Client(code, "bina").ready();
ok(b2.view.you.seated && b2.view.players.find((p) => p.name === "Bina").connected, "rejoin with same name returns to the seat");

const a2 = await new Client(code, "Aarav", "tokA").ready();
await until(() => a.closed === 4002);
ok(a.closed === 4002 && a.msgs.some((m) => m.type === "replaced"), "same device takes over; old tab is told it was replaced");

for (const cl of [a2, b2, c]) cl.intent({ type: "skip" });
ok(await until(() => a2.view.phase.kind === "r1q"), "all skip -> Round 1 question");
const txt = JSON.stringify(a2.view);
ok(!txt.includes("isTrue") && !txt.includes('"truth"'), "player view contains no secrets");
ok(a2.view.data.options.length >= 5, "question has options");

a2.intent({ type: "r1.select", check: 0, bomb: 0 });
await sleep(150);
ok(a2.view.data.mine.check === null, "server rejects ✅ and 💣 on the same option");
a2.intent({ type: "r1.select", check: 0, bomb: 1 }, a2.view.phase.id - 1);
await sleep(150);
ok(a2.view.data.mine.check === null, "stale phase id is dropped");

console.log(failed ? `\n${failed} FAILED` : "\nall ok");
[a2, b2, c, late].forEach((x) => x.close());
process.exit(failed ? 1 : 0);
