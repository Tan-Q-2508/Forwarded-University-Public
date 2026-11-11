// Seeded RNG whose state lives inside the game state (mulberry32). Pure: advance by mutating a passed-in holder.
export interface RngHolder { rng: number }

export function rand(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(h: RngHolder, n: number): number {
  return Math.floor(rand(h) * n);
}

export function shuffle<T>(h: RngHolder, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(h, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(h: RngHolder, arr: readonly T[]): T {
  return arr[randInt(h, arr.length)];
}
