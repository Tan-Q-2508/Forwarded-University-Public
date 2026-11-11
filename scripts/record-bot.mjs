// SCREEN RECORDING OF ONE BOT: a real browser (Playwright, video on) joins a room as the host, then socket bots fill the
// other seats. The browser "plays" by sending intents through the real client (window.__fu.net), so the video shows
// exactly what a player sees, from the rules screen to the podium.  Needs the local worker: `npm run dev:full` or `npx wrangler dev`.
// Usage: node scripts/record-bot.mjs [otherPlayers=4] [seed=7] [outDir=test-results/recording]
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, renameSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const others = Number(process.argv[2] ?? 4), seed = process.argv[3] ?? "7", out = process.argv[4] ?? "test-results/recording";
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
console.log(`room ${code}: 1 recorded browser player + ${others} socket bots`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${BASE}/?room=${code}`);
await page.fill("#in-name", "Zoya");
await page.click('[data-act="join"]');
await page.waitForFunction(() => window.__fu?.view?.you?.seated, null, { timeout: 15000 });

const child = spawn(process.execPath, ["scripts/ws-game.mjs", String(others), seed, "0", code], { stdio: ["ignore", "pipe", "pipe"] });
let childOut = "";
child.stdout.on("data", (d) => (childOut += d));
child.stderr.on("data", (d) => (childOut += d));

// wait for enough players, then press START like the host would
await page.waitForSelector('[data-act="start"]:not(.off)', { timeout: 30000 });
await sleep(2500); // let the viewer see the lobby
await page.click('[data-act="start"]');

// the bot brain, running inside the page and acting through the real client connection
await page.evaluate(() => {
  const NAME = "Zoya";
  let acted = -1;
  const ri = (n) => Math.floor(Math.random() * n);
  const brain = (v, a) => {
    const d = v.data, k = v.phase.kind;
    switch (k) {
      case "rules": return [{ type: "skip" }];
      case "r1lore": return [{ type: "next" }];
      case "r1q": { if (d.mine?.locked) return []; const n = d.options.length, c = ri(n); let b = ri(n); if (b === c) b = null; return [{ type: "r1.select", check: c, bomb: b }, { type: "r1.lock" }]; }
      case "ixPick": return d.underdog === NAME && !d.picked ? [{ type: "ix.pick", box: ri(3) }] : [];
      case "r2pick": { if (d.hot !== NAME) return []; const f = d.tiles.map((t, i) => (t.taken ? -1 : i)).filter((i) => i >= 0); return f.length ? [{ type: "r2.tile", tile: f[ri(f.length)] }] : []; }
      case "r2write": { if (NAME === d.hot || d.submitted) return []; const w = ["Mummy ne bola yahi sahi hai", "A forwarded message from uncle", "Chacha ji ki gossip-free zone", "Sharma ji ka beta did this first", "Rishta aunty approved"]; return [{ type: "r2.write", text: w[ri(w.length)] }]; }
      case "r2guess": { if (d.hot !== NAME) return []; const f = d.options.map((_, i) => (d.eliminated.includes(i) ? -1 : i)).filter((i) => i >= 0); return [{ type: "r2.pick", option: f[ri(f.length)] }]; }
      case "r2vote": { if (!d.canVote) return []; const f = d.options.map((_, i) => (d.own.includes(i) ? -1 : i)).filter((i) => i >= 0); return f.length ? [{ type: "r2.vote", option: f[ri(f.length)] }] : []; }
      case "r3wager": return d.locked ? [] : [{ type: "r3.lock", pct: 25 + ri(4) * 5 }];
      case "r3hint": { const m = d.mine; if (!m || m.solved || m.acted || m.triesLeft <= 0) return []; const n = a.r3.names; return Math.random() < 0.5 || !n.length ? [{ type: "r3.pass" }] : [{ type: "r3.guess", name: n[ri(n.length)] }]; }
      case "postgame": return [];
      default: return [];
    }
  };
  setInterval(() => {
    const a = window.__fu, v = a.view;
    if (!v || !a.net || !v.you?.seated || v.phase.kind === "lobby") return;
    const id = v.phase.id;
    if (acted === id) return;
    const intents = brain(v, a);
    if (!intents.length) return;
    acted = id;
    const delay = 1500 + Math.random() * 3500; // human-ish pause so the video is watchable
    setTimeout(() => intents.forEach((i) => a.net.send(i)), delay);
  }, 400);
});

const seen = new Set();
const t0 = Date.now();
let kind = "";
while (Date.now() - t0 < 900_000) {
  kind = await page.evaluate(() => window.__fu?.view?.phase?.kind ?? "");
  if (kind && !seen.has(kind)) { seen.add(kind); await page.screenshot({ path: `${out}/phase-${String(seen.size).padStart(2, "0")}-${kind}.png` }); console.log(`+${Math.round((Date.now() - t0) / 1000)}s ${kind}`); }
  if (kind === "podium" || kind === "postgame") break;
  await sleep(700);
}
await sleep(9000); // linger on the podium
const video = await page.video().path();
await ctx.close();
await browser.close();
child.kill();
const final = `${out}/forwarded-university-bot-gameplay.webm`;
renameSync(video, final);
console.log(`phases seen: ${[...seen].join(", ")}`);
console.log(`page errors: ${errors.length ? errors.slice(0, 5).join(" | ") : "none"}`);
console.log(`bots: ${childOut.trim().split("\n").slice(-2).join(" / ")}`);
console.log(`video: ${final}`);
process.exit(kind === "podium" || kind === "postgame" ? 0 : 1);
