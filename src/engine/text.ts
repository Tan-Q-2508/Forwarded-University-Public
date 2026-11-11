// Text safety and similarity helpers. Used by the server to validate every typed string.

export const LIMITS = { question: 140, setup: 160, option: 60, fake: 60, name: 12, hint: 90, lore: 72, curse: 70 } as const;

// Invisible, control and right-to-left trick characters.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

export function sanitize(s: unknown, max: number): string {
  if (typeof s !== "string") return "";
  return s.replace(INVISIBLE, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Same cleanup for EVERY option (real answer included) so formatting never gives the truth away. */
export function formatOption(s: string): string {
  let t = sanitize(s, LIMITS.option).replace(/[.!\s]+$/g, "");
  if (t.length) t = t.charAt(0).toUpperCase() + t.slice(1);
  return t;
}

/** Lowercase letters+digits only, numbers normalised ("1,000" equals "1000"). */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** True when `fake` is too close to `real` (equal, contained, or fuzzy-equal). */
export function tooSimilar(fake: string, real: string): boolean {
  const a = norm(fake), b = norm(real);
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 6 && long.includes(short) && short.length / long.length >= 0.7) return true;
  return 1 - lev(a, b) / Math.max(a.length, b.length) >= 0.85;
}

// Starter abuse list (English + Hinglish in English letters). The content team extends this; it is the
// in-room filter. A stricter filter runs before anything enters the shared pool.
const BLOCKED = ["fuck", "shit", "bitch", "bastard", "asshole", "slut", "whore", "chutiya", "madarchod", "bhenchod", "behenchod", "gandu", "randi", "harami", "bhosdi", "lauda", "nigger", "retard"];

export function isBlocked(s: string): boolean {
  const n = s.toLowerCase().replace(/[@4]/g, "a").replace(/[3]/g, "e").replace(/[1!|]/g, "i").replace(/[0]/g, "o").replace(/[$5]/g, "s").replace(/[^a-z]+/g, "");
  return BLOCKED.some((w) => n.includes(w));
}

export function validName(raw: unknown): string | null {
  const n = sanitize(raw, LIMITS.name + 20);
  if (n.length < 1 || n.length > LIMITS.name) return null;
  if (isBlocked(n)) return null;
  return n;
}
