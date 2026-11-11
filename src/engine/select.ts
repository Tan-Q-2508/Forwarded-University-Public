import { type RngHolder, shuffle } from "./rng";
import type { PersonalityLite, QuestionLite } from "./types";

export const RESET_BELOW = 15;

interface UsedLists { usedQ: string[]; usedP: string[]; game: { gameUsedQ: string[] } }

/**
 * Pick n questions. Never repeats inside a game. Per-room used list resets when fewer than 15 unused remain.
 * Tries to mix India/world and avoid shared topic tags; relaxes those if the pool is too small.
 */
export function pickQuestions(h: RngHolder, u: UsedLists, pool: QuestionLite[], n: number): QuestionLite[] {
  const avail = pool.filter((q) => !u.game.gameUsedQ.includes(q.id));
  let fresh = avail.filter((q) => !u.usedQ.includes(q.id));
  if (fresh.length < RESET_BELOW || fresh.length < n) {
    u.usedQ = [];
    fresh = avail;
  }
  const order = shuffle(h, fresh);
  const chosen: QuestionLite[] = [];
  const tags = new Set<string>();
  const wantIN = Math.ceil(n * 0.65);
  let inCount = 0;
  const take = (q: QuestionLite) => {
    chosen.push(q);
    q.topic_tags.forEach((t) => tags.add(t));
    if (q.region === "IN") inCount++;
  };
  // pass 1: disjoint tags, region mix roughly 65/35
  for (const q of order) {
    if (chosen.length >= n) break;
    if (q.topic_tags.some((t) => tags.has(t))) continue;
    if (q.region === "IN" ? inCount >= wantIN : n - chosen.length <= wantIN - inCount) continue;
    take(q);
  }
  // pass 2: relax region, keep tags disjoint
  for (const q of order) {
    if (chosen.length >= n) break;
    if (chosen.includes(q) || q.topic_tags.some((t) => tags.has(t))) continue;
    take(q);
  }
  // pass 3: relax everything (tiny pools must never crash a game)
  for (const q of order) {
    if (chosen.length >= n) break;
    if (!chosen.includes(q)) take(q);
  }
  // last resort: pool smaller than n even ignoring game-used (content bug, but never crash)
  if (chosen.length < n) {
    for (const q of shuffle(h, pool)) {
      if (chosen.length >= n) break;
      if (!chosen.includes(q)) chosen.push(q);
    }
  }
  for (const q of chosen) {
    u.game.gameUsedQ.push(q.id);
    if (!u.usedQ.includes(q.id)) u.usedQ.push(q.id);
  }
  return chosen;
}

export function pickPersonalities(h: RngHolder, u: UsedLists, pool: PersonalityLite[], n: number): PersonalityLite[] {
  let fresh = pool.filter((p) => !u.usedP.includes(p.id));
  if (fresh.length < n) {
    u.usedP = [];
    fresh = pool.slice();
  }
  const chosen = shuffle(h, fresh).slice(0, n);
  for (const p of chosen) u.usedP.push(p.id);
  return chosen;
}
