import { makeContent } from "../engine/devContent";
import { buildPack } from "../engine/pack";
import type { ContentPack } from "../engine/types";
import type { Env } from "./index";

const EMPTY: ContentPack = { questions: [], personalities: [], names: [], curses: [] };
const TTL_MS = 60_000; // a report pulls an option at once in this isolate and within a minute everywhere
let dev: ContentPack | null = null;
let cache: { at: number; pack: ContentPack } | null = null;

export const invalidateContent = () => { cache = null; };

/**
 * The playable content pack. Production reads the D1 bank (approved rows only, validated, reported options removed,
 * at most 10 approved crowd fakes per question). Local dev with DEV_CONTENT=1 uses synthetic TEST content.
 * A bad row is skipped and logged; a failed read keeps the last good pack. An empty pack means Start is refused.
 */
export async function loadContent(env: Env): Promise<ContentPack> {
  if (env.DEV_CONTENT === "1") return (dev ??= makeContent(40, 12));
  if (cache && Date.now() - cache.at < TTL_MS) return cache.pack;
  if (!env.DB) return cache?.pack ?? EMPTY;
  try {
    const r = await env.DB.batch([
      env.DB.prepare("SELECT json FROM questions WHERE status = 'approved'"),
      env.DB.prepare("SELECT json FROM personalities WHERE status = 'approved'"),
      env.DB.prepare("SELECT name FROM names"),
      env.DB.prepare("SELECT text FROM curses WHERE status = 'approved'"),
      env.DB.prepare("SELECT question_id, text FROM crowd_fakes WHERE status = 'approved'"),
      env.DB.prepare("SELECT question_id, text FROM option_blocks"),
    ]);
    const col = (i: number, k: string) => (r[i].results as any[]).map((x) => x[k] as string);
    const { pack, skipped } = buildPack(
      { questions: col(0, "json"), personalities: col(1, "json"), names: col(2, "name"), curses: col(3, "text"), crowd: r[4].results as any[], blocks: r[5].results as any[] },
      { allowMarkers: env.ALLOW_TEST_CONTENT === "1" },
    );
    if (skipped.length) console.warn(`content: skipped ${skipped.length} bad item(s): ${skipped.slice(0, 5).join(" | ")}`);
    cache = { at: Date.now(), pack };
    return pack;
  } catch (err) {
    console.error("content load failed", err);
    return cache?.pack ?? EMPTY;
  }
}
