/* eslint-disable @typescript-eslint/no-explicit-any */
// Content validation: used by the import script (hard fail) and by the pack builder at load time
// (a bad item is SKIPPED and logged, never crashes a game).
import { LIMITS, isBlocked, norm } from "./text.ts";

const URL_RE = /^https?:\/\/[^\s]+$/i;
const MARK = /EXAMPLE ONLY|NOT REAL NEWS|EXAMPLE FIXTURE|\bTEST\b/;
const str = (x: unknown, max: number, min = 1) => typeof x === "string" && x.trim().length >= min && x.length <= max;

export interface VOpts { requireApproved?: boolean; allowMarkers?: boolean } // allowMarkers: local dev only (synthetic TEST rows)

export function validateQuestion(q: any, opts: VOpts = {}): string[] {
  const p: string[] = [];
  const add = (m: string) => p.push(m);
  if (!q || typeof q !== "object") return ["not an object"];
  if (!/^q\d{4}$/.test(q.id ?? "")) add("id must look like q0001");
  if (opts.requireApproved && q.status !== "approved") add(`status is "${q.status}", only "approved" is playable`);
  if (!["IN", "WORLD"].includes(q.region)) add("region must be IN or WORLD");
  if (!str(q.question, LIMITS.question)) add(`question missing or over ${LIMITS.question} chars`);
  if (q.setup !== undefined && !str(q.setup, LIMITS.setup, 0)) add(`setup over ${LIMITS.setup} chars`);
  if (!str(q.real_answer, LIMITS.option)) add(`real_answer missing or over ${LIMITS.option} chars`);
  if (!Array.isArray(q.topic_tags) || !q.topic_tags.length) add("topic_tags needs at least one tag");
  if (!str(q.r2_decoy_category, 40)) add("r2_decoy_category missing or over 40 chars");
  if (!Array.isArray(q.r2_house_lies) || q.r2_house_lies.length < 3 || q.r2_house_lies.some((l: unknown) => !str(l, LIMITS.fake))) add("r2_house_lies needs 3+ items of 60 chars or less");
  if (q.r2_alias_answers !== undefined && (!Array.isArray(q.r2_alias_answers) || q.r2_alias_answers.some((l: unknown) => !str(l, LIMITS.option)))) add("r2_alias_answers must be strings of 60 chars or less");

  const wrong = Array.isArray(q.wrong_options) ? q.wrong_options : [];
  if (wrong.length < 4 || wrong.length > 12) add("wrong_options needs 4 to 12 items");
  const usable = wrong.filter((w: any) => w && (!w.status || w.status === "approved"));
  if (usable.length < 4) add("at least 4 wrong options must be approved (a round needs 5+ options in total)");
  const seen = new Set<string>([norm(String(q.real_answer ?? ""))]);
  for (const w of wrong) {
    if (!w || !str(w.text, LIMITS.option)) { add(`a wrong option is empty or over ${LIMITS.option} chars`); continue; }
    const k = norm(w.text);
    if (seen.has(k)) add(`duplicate option (or equal to the real answer): "${w.text}"`);
    seen.add(k);
    if (isBlocked(w.text)) add(`abusive wrong option: "${w.text}"`);
  }
  const lore = q.lore;
  if (!lore || !Array.isArray(lore.comparisons) || lore.comparisons.length < 2 || lore.comparisons.length > 3) add("lore.comparisons needs 2 or 3 items");
  else for (const c of lore.comparisons) if (!str(c?.text, LIMITS.lore) || !str(c?.math, 40)) add(`lore comparison text over ${LIMITS.lore} or math over 40 chars`);
  if (!str(lore?.card_caption, 120)) add("lore.card_caption missing or over 120 chars");
  if (!str(q.source?.newspaper, 80)) add("source.newspaper missing");
  if (!Array.isArray(q.source_urls) || !q.source_urls.length || q.source_urls.some((u: unknown) => typeof u !== "string" || !URL_RE.test(u))) add("source_urls needs at least one http(s) link");
  if (q.status === "approved" || q.status === "verified") {
    if ((q.verification?.sources_confirmed ?? 0) < 1) add("verification.sources_confirmed must be 1 or more (one reputable, linked source is enough)");
    if (q.sensitivity?.cleared !== true) add("sensitivity.cleared must be true");
  }
  if (!opts.allowMarkers && MARK.test(JSON.stringify(q))) add("contains EXAMPLE / TEST markers: samples and fixtures must never reach production");
  return p;
}

export function validatePersonality(x: any, opts: VOpts = {}): string[] {
  const p: string[] = [];
  if (!x || typeof x !== "object") return ["not an object"];
  if (!/^p\d{3}$/.test(x.id ?? "")) p.push("id must look like p001");
  if (opts.requireApproved && x.status !== undefined && x.status !== "approved") p.push(`status is "${x.status}", only "approved" is playable`);
  if (!str(x.name, 40)) p.push("name missing or over 40 chars");
  if (!Array.isArray(x.hints) || x.hints.length !== 5 || x.hints.some((h: unknown) => !str(h, LIMITS.hint))) p.push(`hints needs exactly 5 items of ${LIMITS.hint} chars or less`);
  else if (typeof x.name === "string") {
    const n = norm(x.name);
    const last = norm(String(x.name).split(/\s+/).pop() ?? "");
    for (const h of x.hints) if (norm(h).includes(n) || (last.length >= 5 && norm(h).includes(last))) p.push(`a hint gives the name away: "${h}"`);
  }
  if (x.aliases !== undefined && (!Array.isArray(x.aliases) || x.aliases.some((a: unknown) => !str(a, 40)))) p.push("aliases must be strings of 40 chars or less");
  if (!str(x.illustration_brief, 400)) p.push("illustration_brief missing (stylised illustration only, never a photo)");
  if (x.sensitivity?.cleared !== true) p.push("sensitivity.cleared must be true");
  if (!opts.allowMarkers && MARK.test(JSON.stringify(x))) p.push("contains EXAMPLE / TEST markers");
  return p;
}

export function validateCurse(text: unknown): string[] {
  if (typeof text !== "string" || !text.trim()) return ["empty"];
  const filled = text.replace("{target}", "x".repeat(LIMITS.name));
  const p: string[] = [];
  if (filled.length > LIMITS.curse) p.push(`over ${LIMITS.curse} chars once {target} is filled in`);
  if (isBlocked(text)) p.push("abusive");
  return p;
}
