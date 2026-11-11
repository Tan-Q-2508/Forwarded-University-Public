// The Room Durable Object: a THIN layer. Sockets, alarms, saving. All rules live in src/engine.
// Free-plan care: WebSocket Hibernation, auto-response heartbeats, SQLite writes only when the engine asks
// (phase changes + lock-ins), one alarm at a time and only when the deadline really changes.
import { DurableObject } from "cloudflare:workers";
import { newRoom, reduce } from "../engine/engine";
import type { Effect, Event, State } from "../engine/types";
import { viewFor } from "../engine/view";
import { checkShared, looksPrivate } from "../engine/moderation";
import { invalidateContent, loadContent } from "./content";
import type { ContentPack } from "../engine/types";
import type { Env } from "./index";
import { reportItem } from "../engine/report";

interface Attachment {
  conn: string; // id of this socket, used to answer its join attempt
  name: string | null; // player name once joined
  at: number; // connect time
}

const MAX_MSG_BYTES = 2048;
const RATE_PER_SEC = 25;
const STALE_MS = 30_000; // no ping for this long = treated as disconnected (client pings every 5 s)
const WS_CLOSE = { badJoin: 4001, replaced: 4002, closed: 4003 } as const;

export class Room extends DurableObject<Env> {
  private state: State | null = null;
  private rate = new Map<WebSocket, { sec: number; n: number }>();
  private content: ContentPack = { questions: [], personalities: [], names: [], curses: [] };
  private writes: Promise<unknown>[] = []; // D1 writes started by effects; awaited before a handler returns
  private reported = new Set<string>(); // what each player already reported on this screen
  private reportCount = new Map<string, number>(); // reports per player per screen (max 3)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat answered by the runtime without waking a hibernated room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS snap (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
      const row = ctx.storage.sql.exec("SELECT v FROM snap WHERE k = 'state'").toArray()[0];
      if (row) this.state = JSON.parse(row.v as string) as State;
      this.reconcile();
    });
  }

  /**
   * After a real restart (deploy, crash) every socket is gone but the snapshot still says "connected".
   * After a plain hibernation wake the sockets survive. Either way: a player is connected only if a live
   * socket carries their name. Anyone else gets a normal disconnect (greys out, may rejoin, empty-room timer).
   */
  private reconcile() {
    if (!this.state) return;
    const live = new Set(this.ctx.getWebSockets().map((w) => (w.deserializeAttachment() as Attachment | null)?.name?.toLowerCase()));
    for (const p of this.state.players) {
      if (p.connected && !live.has(p.key)) this.dispatch({ type: "disconnect", at: Date.now(), name: p.name });
    }
  }

  /* ---------------------------------------------------------------- HTTP / upgrade */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      if (this.state) return new Response("exists", { status: 409 });
      const seed = crypto.getRandomValues(new Int32Array(1))[0];
      this.state = newRoom(request.headers.get("x-room-code") ?? "????", seed, Date.now());
      this.persist();
      return new Response("ok");
    }
    if (url.pathname === "/status") {
      return Response.json({ exists: !!this.state && !this.state.closed });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    if (!this.state || this.state.closed) return new Response("room_not_found", { status: 404 });

    await this.ensureContent();
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server); // hibernation-aware accept
    const att: Attachment = { conn: crypto.randomUUID(), name: null, at: Date.now() };
    server.serializeAttachment(att);
    const name = url.searchParams.get("name") ?? "";
    const token = url.searchParams.get("token") ?? undefined;
    this.dispatch({ type: "join", at: Date.now(), name, token, conn: att.conn });
    await this.flush();
    return new Response(null, { status: 101, webSocket: client });
  }

  /* ---------------------------------------------------------------- socket handlers */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.state || typeof message !== "string" || message.length > MAX_MSG_BYTES) return;
    if (this.limited(ws)) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    let msg: any;
    try { msg = JSON.parse(message); } catch { return; }
    this.sweepStale();
    if (!att?.name || !msg || typeof msg !== "object") return;
    if (msg.t === "sync") return this.sendView(ws);
    await this.ensureContent();
    if (msg.t === "intent") {
      this.dispatch({ type: "intent", at: Date.now(), name: att.name, phaseId: msg.phaseId, seq: msg.seq, intent: msg.intent });
    } else if (msg.t === "report") {
      this.writes.push(this.report(att.name, msg));
    }
    await this.flush();
  }

  async webSocketClose(ws: WebSocket): Promise<void> { this.onGone(ws); }
  async webSocketError(ws: WebSocket): Promise<void> { this.onGone(ws); }

  async alarm(): Promise<void> {
    if (!this.state) return;
    try {
      await this.ensureContent();
      this.sweepStale();
      this.dispatch({ type: "alarm", at: Date.now() });
      await this.flush();
    } catch (err) {
      // never let an exception burn the alarm's retries: log and re-arm shortly
      console.error("alarm failed", err);
      await this.ctx.storage.setAlarm(Date.now() + 2000);
    }
  }

  /* ---------------------------------------------------------------- engine plumbing */
  private dispatch(ev: Event) {
    if (!this.state) return;
    const { state, effects } = reduce(this.state, ev, { content: this.content });
    this.state = state;
    this.apply(effects);
  }

  private apply(effects: Effect[]) {
    let save = false, broadcast = false, wipe = false;
    let alarm: { at: number | null } | null = null;
    for (const e of effects) {
      switch (e.t) {
        case "save": save = true; break;
        case "broadcast": broadcast = true; break;
        case "alarm": alarm = { at: e.at }; break;
        case "wipe": wipe = true; break;
        case "crowdFake": this.writes.push(this.saveCrowd(e.questionId, e.text)); break;
        case "send": this.sendTo(e.to, e.msg); break;
        case "reply": this.reply(e.conn, e.msg); break;
      }
    }
    if (wipe) return this.wipe();
    if (save) this.persist();
    if (alarm) { alarm.at === null ? void this.ctx.storage.deleteAlarm() : void this.ctx.storage.setAlarm(alarm.at); }
    if (broadcast) this.broadcast();
  }

  private persist() {
    if (!this.state) return;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO snap (k, v) VALUES ('state', ?)", JSON.stringify(this.state));
  }

  private wipe() {
    for (const ws of this.ctx.getWebSockets()) { try { ws.close(WS_CLOSE.closed, "room_closed"); } catch { /* already closed */ } }
    this.state = null;
    void this.ctx.storage.deleteAll(); // also deletes the alarm (compatibility date >= 2026-02-24)
  }

  /* ---------------------------------------------------------------- content + moderation (D1) */
  private async ensureContent() { this.content = await loadContent(this.env); }
  private async flush() { if (this.writes.length) await Promise.allSettled(this.writes.splice(0)); }

  /** A top-2 fake from a Round 2 turn becomes a PENDING crowd fake: text only, only if it is safe for other groups. */
  private async saveCrowd(questionId: string, text: string) {
    if (!this.env.DB || !this.state) return;
    const verdict = checkShared(text);
    if (!verdict.ok || looksPrivate(text, this.state.players.map((p) => p.name), this.state.code)) return; // stays private to this room
    try {
      await this.env.DB.prepare(
        "INSERT INTO crowd_fakes (question_id, text, status, seen, created_at) VALUES (?, ?, 'pending', 1, ?) ON CONFLICT (question_id, text) DO UPDATE SET seen = seen + 1",
      ).bind(questionId, text, new Date().toISOString()).run();
    } catch (err) { console.error("crowd fake not saved", err); }
  }

  /**
   * Report button (on every question screen). The phone only says WHY (offensive | wrong | other), WHAT (the question,
   * or option number N) and an optional note. The server works out which question / option / personality that is from
   * the room's own state, allows a few reports per player per screen, saves them, and pulls the item at once when the
   * reason is "offensive" or "wrong". "Other" is only logged for a human.
   */
  private async report(name: string, msg: any) {
    const s = this.state;
    const p = s?.players.find((x) => x.name === name);
    if (!s || !p?.seated || !this.env.DB) return;
    const it = reportItem(s);
    if (!it) return;
    // old clients sent {kind:"error"} / {kind:"option"}; keep them working
    const reason: "offensive" | "wrong" | "other" = ["offensive", "wrong", "other"].includes(msg.reason) ? msg.reason : msg.kind === "error" ? "wrong" : "offensive";
    const wantsOption = msg.target ? msg.target === "option" : msg.kind === "option";
    const opt = wantsOption ? it.options[Number.isInteger(msg.index) ? msg.index : -1] : undefined;
    if (wantsOption && !opt) return;
    const note = typeof msg.note === "string" ? msg.note.replace(/\s+/g, " ").trim().slice(0, 140) : "";
    const key = `${s.phase.id}|${p.key}|${opt ? msg.index : "q"}`;
    const per = `${s.phase.id}|${p.key}`;
    if (this.reported.has(key) || (this.reportCount.get(per) ?? 0) >= 3) return; // same thing twice, or more than 3 per screen
    this.reported.add(key);
    this.reportCount.set(per, (this.reportCount.get(per) ?? 0) + 1);
    if (this.reported.size > 200) { this.reported.clear(); this.reportCount.clear(); }

    const pull = reason !== "other";
    const now = new Date().toISOString();
    const db = this.env.DB;
    const kind = opt ? "option" : "question";
    const optionText = opt ? opt.text : null;
    const pullWhole = pull && (!opt || opt.real || it.personality); // the question itself, its true answer, or any personality hint
    const stmts = (extended: boolean) => {
      const out = [extended
        ? db.prepare("INSERT INTO reports (question_id, kind, option_text, phase, status, created_at, reason, note) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)").bind(it.id, kind, optionText, s.phase.kind, now, reason, note || null)
        : db.prepare("INSERT INTO reports (question_id, kind, option_text, phase, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(it.id, kind === "question" ? "error" : kind, optionText, s.phase.kind, now)];
      if (pullWhole) {
        out.push(it.personality
          ? db.prepare("UPDATE personalities SET status = 'reported' WHERE id = ? AND status = 'approved'").bind(it.id)
          : db.prepare("UPDATE questions SET status = 'reported' WHERE id = ? AND status = 'approved'").bind(it.id));
      } else if (pull && opt) {
        out.push(db.prepare("INSERT OR IGNORE INTO option_blocks (question_id, text, reason, created_at) VALUES (?, ?, 'reported', ?)").bind(it.id, opt.text, now));
        out.push(db.prepare("UPDATE crowd_fakes SET status = 'reported' WHERE question_id = ? AND text = ?").bind(it.id, opt.text));
      }
      return out;
    };
    try {
      try { await db.batch(stmts(true)); } catch (err) { console.warn("report: reason/note columns missing (run db:migrate:remote)? saving without them", err); await db.batch(stmts(false)); }
      if (pull) invalidateContent();
      this.sendTo(name, { type: "reported", pulled: pull, kind: pullWhole && !opt ? "error" : "option" });
    } catch (err) { console.error("report not saved", err); this.reported.delete(key); this.reportCount.set(per, Math.max(0, (this.reportCount.get(per) ?? 1) - 1)); }
  }

  /* ---------------------------------------------------------------- sending */
  private send(ws: WebSocket, obj: unknown) { try { ws.send(JSON.stringify(obj)); } catch { /* socket already gone */ } }

  private sendView(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!this.state || !att?.name) return;
    this.send(ws, { type: "state", now: Date.now(), view: viewFor(this.state, att.name) });
  }

  private broadcast() {
    for (const ws of this.ctx.getWebSockets()) this.sendView(ws);
  }

  private sendTo(name: string, msg: Record<string, unknown>) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.name?.toLowerCase() !== name.toLowerCase()) continue;
      this.send(ws, msg);
      if (msg.type === "replaced") { // same device took the seat: tell and drop the old tab
        ws.serializeAttachment({ ...att, name: null });
        try { ws.close(WS_CLOSE.replaced, "replaced"); } catch { /* ignore */ }
      }
    }
  }

  private reply(conn: string | undefined, msg: Record<string, unknown>) {
    const ws = this.ctx.getWebSockets().find((w) => (w.deserializeAttachment() as Attachment | null)?.conn === conn);
    if (!ws) return;
    const att = ws.deserializeAttachment() as Attachment;
    this.send(ws, msg);
    if (msg.type === "joined") ws.serializeAttachment({ ...att, name: msg.name as string });
    else if (msg.type === "error") {
      // The join runs inside the upgrade request, before the client end exists, so a close sent now can be lost
      // and a later timer cannot be relied on. The client closes on {type:"error"}; meanwhile this socket has
      // no name, so it is never a player, never receives state, and is never counted.
      ws.serializeAttachment({ ...att, name: null });
    }
  }

  /* ---------------------------------------------------------------- liveness + limits */
  private onGone(ws: WebSocket) {
    this.rate.delete(ws);
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!this.state || !att?.name) return;
    const stillThere = this.ctx.getWebSockets().some((w) => w !== ws && (w.deserializeAttachment() as Attachment | null)?.name?.toLowerCase() === att.name!.toLowerCase());
    if (!stillThere) this.dispatch({ type: "disconnect", at: Date.now(), name: att.name });
  }

  /** Sockets that stopped pinging (suspended phone, dead network) grey out like a clean disconnect. */
  private sweepStale() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att?.name) continue;
      const last = Math.max(this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0, att.at);
      if (now - last > STALE_MS) {
        try { ws.close(1001, "stale"); } catch { /* ignore */ }
        this.onGone(ws);
      }
    }
  }

  private limited(ws: WebSocket): boolean {
    const sec = Math.floor(Date.now() / 1000);
    const r = this.rate.get(ws);
    if (!r || r.sec !== sec) { this.rate.set(ws, { sec, n: 1 }); return false; }
    return ++r.n > RATE_PER_SEC;
  }
}
