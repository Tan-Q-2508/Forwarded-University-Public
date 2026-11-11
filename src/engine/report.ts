// Which item (question or personality) and which options can a player report on the screen they are looking at?
// Pure: reads the room state, returns ids and texts. The phone only ever says "the question" or "option N".
import type { State } from "./types";

export interface ReportItem {
  id: string; // question id (q0001) or personality id (p001)
  personality: boolean;
  options: { text: string; real: boolean }[]; // same order as the phone shows them (Round 3: the hints shown so far)
}

export function reportItem(s: State): ReportItem | null {
  const ph = s.phase, d = ph.d;
  const opts = (xs: any[]) => (xs ?? []).map((o) => ({ text: String(o.text), real: !!(o.isTrue || o.real) }));
  switch (ph.kind) {
    case "r1q": return { id: d.qid, personality: false, options: opts(d.options) };
    case "r1reveal": return { id: s.game.r1.ids[d.qi], personality: false, options: opts(d.options) };
    case "r1lore": return { id: s.game.r1.ids[d.qi], personality: false, options: [] };
    case "r2write": return { id: d.qid, personality: false, options: [] };
    case "r2guess": case "r2vote": case "r2reveal": return d.qid ? { id: d.qid, personality: false, options: opts(d.options) } : null;
    case "r3hint": case "r3reveal": {
      const cur = s.game.r3.cur;
      const pr = cur ? s.game.r3.ps[cur.pid] : null;
      if (!cur || !pr) return null;
      const shown = ph.kind === "r3hint" ? cur.hint : pr.hints.length;
      return { id: cur.pid, personality: true, options: pr.hints.slice(0, shown).map((text) => ({ text, real: false })) };
    }
    default: return null;
  }
}
