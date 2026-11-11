/* eslint-disable @typescript-eslint/no-explicit-any */
// Builds the playable ContentPack from database rows. Pure (no D1 here) so it is unit tested.
// Anything invalid is SKIPPED and reported, never thrown: a bad row must not break a game.
import { norm } from "./text.ts";
import { validateCurse, validatePersonality, validateQuestion } from "./validate.ts";
import type { ContentPack, PersonalityLite, QuestionLite } from "./types.ts";

export const MAX_CROWD_PER_QUESTION = 10;

export interface PackRows {
  questions: string[]; // JSON text of approved question rows
  personalities: string[]; // JSON text of approved personality rows
  names: string[];
  curses: string[];
  crowd: { question_id: string; text: string }[]; // approved crowd fakes
  blocks: { question_id: string; text: string }[]; // options pulled by reports
}

export function buildPack(rows: PackRows, opts: { allowMarkers?: boolean } = {}): { pack: ContentPack; skipped: string[] } {
  const skipped: string[] = [];
  const blocked = new Set(rows.blocks.map((b) => `${b.question_id}|${norm(b.text)}`));
  const crowd = new Map<string, string[]>();
  for (const c of rows.crowd) crowd.set(c.question_id, [...(crowd.get(c.question_id) ?? []), c.text]);

  const questions: QuestionLite[] = [];
  for (const raw of rows.questions) {
    let q: any;
    try { q = JSON.parse(raw); } catch { skipped.push("a question row is not valid JSON"); continue; }
    q.wrong_options = (q.wrong_options ?? []).filter((w: any) => !blocked.has(`${q.id}|${norm(w?.text ?? "")}`));
    const have = new Set<string>(q.wrong_options.map((w: any) => norm(w.text)));
    for (const text of (crowd.get(q.id) ?? []).slice(0, MAX_CROWD_PER_QUESTION)) {
      if (blocked.has(`${q.id}|${norm(text)}`) || have.has(norm(text)) || q.wrong_options.length >= 12) continue;
      q.wrong_options.push({ text, origin: "crowd", status: "approved" });
      have.add(norm(text));
    }
    const problems = validateQuestion(q, { requireApproved: true, allowMarkers: opts.allowMarkers });
    if (problems.length) { skipped.push(`${q.id ?? "?"}: ${problems[0]}`); continue; }
    questions.push(q as QuestionLite);
  }

  // The searchable list must contain every answer (and accepted alias): enforced here, at load.
  const nameSet = new Set(rows.names.map(norm));
  const names = [...rows.names];
  const personalities: PersonalityLite[] = [];
  for (const raw of rows.personalities) {
    let x: any;
    try { x = JSON.parse(raw); } catch { skipped.push("a personality row is not valid JSON"); continue; }
    const problems = validatePersonality(x, { requireApproved: true, allowMarkers: opts.allowMarkers });
    if (problems.length) { skipped.push(`${x.id ?? "?"}: ${problems[0]}`); continue; }
    for (const n of [x.name, ...(x.aliases ?? [])]) if (!nameSet.has(norm(n))) { nameSet.add(norm(n)); names.push(n); }
    personalities.push({ id: x.id, name: x.name, aliases: x.aliases ?? [], hints: x.hints });
  }
  const curses = rows.curses.filter((c) => { const p = validateCurse(c); if (p.length) skipped.push(`curse "${c}": ${p[0]}`); return !p.length; });
  return { pack: { questions, personalities, names, curses }, skipped };
}
