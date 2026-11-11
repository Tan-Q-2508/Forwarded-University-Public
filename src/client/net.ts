// WebSocket client: heartbeat every 5 s, exponential backoff with jitter, instant reconnect when the page
// becomes visible again (phones leave the browser to open the voice-call app), server-time offset.
export interface NetHandlers {
  onState(view: any, serverNow: number): void;
  onStatus(s: "connecting" | "open" | "reconnecting"): void;
  onFatal(code: string): void; // name_in_use, room_closed, replaced, bad_name, room_full ...
  onMsg?(msg: any): void; // private messages: rejected / guessResult ...
}

export class Net {
  private ws: WebSocket | null = null;
  private tries = 0;
  private seq = 0;
  private hb: number | undefined;
  private retry: number | undefined;
  private stopped = false;
  view: any = null;
  offset = 0; // serverNow - clientNow

  constructor(private code: string, private name: string, private token: string, private h: NetHandlers) {
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onVisible);
  }

  private onVisible = () => {
    if (this.stopped || document.visibilityState === "hidden") return;
    if (!this.ws || this.ws.readyState > 1) this.connect(true);
  };

  connect(immediate = false) {
    if (this.stopped) return;
    clearTimeout(this.retry);
    this.h.onStatus(this.tries === 0 && !this.view ? "connecting" : "reconnecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.code}?name=${encodeURIComponent(this.name)}&token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    let gotMessage = false;
    ws.onopen = () => {
      clearInterval(this.hb);
      this.hb = window.setInterval(() => { if (ws.readyState === 1) ws.send("ping"); }, 5000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      gotMessage = true;
      if (m.type === "state") { this.tries = 0; this.view = m.view; this.offset = m.now - Date.now(); this.h.onStatus("open"); this.h.onState(m.view, m.now); }
      else if (m.type === "error") this.fatal(m.code);
      else if (m.type === "replaced") this.fatal("replaced");
      else this.h.onMsg?.(m);
    };
    ws.onclose = (e) => {
      clearInterval(this.hb);
      if (this.stopped || this.ws !== ws) return;
      if (e.code === 4003) return this.fatal("room_closed");
      if (e.code === 4002) return this.fatal("replaced");
      this.scheduleRetry(immediate && !gotMessage);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private async scheduleRetry(fast: boolean) {
    this.h.onStatus("reconnecting");
    // if the room was deleted while we were away, stop instead of retrying forever
    try {
      const r = await fetch(`/api/rooms/${this.code}`);
      if (r.ok && (await r.json()).exists === false) return this.fatal("room_closed");
    } catch { /* offline: keep retrying */ }
    const base = Math.min(8000, 500 * 2 ** this.tries++);
    this.retry = window.setTimeout(() => this.connect(), fast ? 300 : base / 2 + Math.random() * base / 2);
  }

  private fatal(code: string) {
    this.stop();
    this.h.onFatal(code);
  }

  /** Send a player intent stamped with the phase id the player is looking at and a rising sequence number. */
  send(intent: unknown) {
    if (!this.ws || this.ws.readyState !== 1 || !this.view) return;
    this.ws.send(JSON.stringify({ t: "intent", phaseId: this.view.phase.id, seq: ++this.seq, intent }));
  }

  /** Non-intent messages (report). Same open-socket rule as send(). */
  sendRaw(obj: unknown) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }

  stop() {
    this.stopped = true;
    clearInterval(this.hb);
    clearTimeout(this.retry);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onVisible);
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}
