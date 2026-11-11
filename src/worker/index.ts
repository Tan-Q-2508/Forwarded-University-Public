import { isValidCode, randomCode } from "./code";
import { loadContent } from "./content";
export { Room } from "./room";
import type { Room } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
  DB: D1Database;
  DEV_CONTENT?: string;
  ALLOW_TEST_CONTENT?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Best-effort abuse guard: each room costs a Durable Object, so cap creation per client per minute
// (per Worker isolate, which is enough to stop a casual script; real DDoS protection is Cloudflare's job).
const creations = new Map<string, { t: number; n: number }>();
function tooManyRooms(ip: string): boolean {
  const now = Date.now();
  if (creations.size > 5000) creations.clear();
  const c = creations.get(ip);
  if (!c || now - c.t > 60_000) { creations.set(ip, { t: now, n: 1 }); return false; }
  return ++c.n > 8;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api","rooms",...] or ["ws",CODE]

    // POST /api/rooms -> create a room with a fresh unique code
    if (parts[0] === "api" && parts[1] === "rooms" && parts.length === 2 && request.method === "POST") {
      if (tooManyRooms(request.headers.get("cf-connecting-ip") ?? "local")) return json({ error: "slow_down" }, 429);
      for (let i = 0; i < 20; i++) {
        const code = randomCode();
        const res = await env.ROOM.getByName(code).fetch("https://room/init", { method: "POST", headers: { "x-room-code": code } });
        if (res.status === 200) return json({ code });
      }
      return json({ error: "no_free_code" }, 503);
    }
    // GET /api/rooms/CODE -> does the room exist?
    if (parts[0] === "api" && parts[1] === "rooms" && parts.length === 3 && request.method === "GET") {
      const code = parts[2].toUpperCase();
      if (!isValidCode(code)) return json({ exists: false });
      const res = await env.ROOM.getByName(code).fetch("https://room/status");
      return json(await res.json());
    }
    // GET /api/names -> the searchable list for Round 3 guesses (answers + decoys; not a secret, it is a dropdown)
    if (parts[0] === "api" && parts[1] === "names" && request.method === "GET") {
      return new Response(JSON.stringify((await loadContent(env)).names), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
    }
    // GET /ws/CODE -> WebSocket upgrade, handled by that room's Durable Object
    if (parts[0] === "ws" && parts.length === 2) {
      const code = parts[1].toUpperCase();
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket upgrade", { status: 426 });
      if (request.method !== "GET" || !isValidCode(code)) return new Response("Bad request", { status: 400 });
      return env.ROOM.getByName(code).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
