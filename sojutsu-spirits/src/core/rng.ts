/**
 * Seeded RNG.
 *
 * Every random draw in the engine goes through this. Nothing in `src/core` or `src/math` calls
 * `Math.random`, which is what makes a battle reproducible from (seed, inputs) and the damage
 * formula testable against fixed vectors — `sojutsu-battle-math.md` §14 asks for exactly that
 * before anything is built on top of the formula.
 *
 * xorshift128 — small, fast, and good enough for a game; it is not cryptographic and is not
 * meant to be.
 */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number | string = 0x5eed) {
    let h = typeof seed === 'string' ? hashString(seed) : (seed >>> 0) || 1;
    // splitmix32 the seed out into four words so nearby seeds diverge immediately.
    this.s0 = (h = splitmix32(h));
    this.s1 = (h = splitmix32(h));
    this.s2 = (h = splitmix32(h));
    this.s3 = splitmix32(h);
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Raw 32-bit unsigned draw. */
  next(): number {
    const t = this.s1 << 9;
    let r = (this.s0 * 5) >>> 0;
    r = (((r << 7) | (r >>> 25)) * 9) >>> 0;

    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;

    this.s0 >>>= 0;
    this.s1 >>>= 0;
    this.s2 >>>= 0;
    this.s3 >>>= 0;
    return r;
  }

  /** Float in [0, 1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Integer in [min, max], inclusive on both ends — the form the battle spec is written in. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`Rng.int: max ${max} < min ${min}`);
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** True with probability `n / d` — the shape most of the battle spec's odds are written in. */
  odds(n: number, d: number): boolean {
    return this.int(1, d) <= n;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[this.int(0, items.length - 1)]!;
  }

  /** Weighted pick. Weights need not sum to 1. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    if (items.length === 0) throw new Error('Rng.weighted: empty list');
    let total = 0;
    for (const it of items) total += Math.max(0, weightOf(it));
    if (total <= 0) return this.pick(items);
    let roll = this.float() * total;
    for (const it of items) {
      roll -= Math.max(0, weightOf(it));
      if (roll < 0) return it;
    }
    return items[items.length - 1]!;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = items[i]!;
      items[i] = items[j]!;
      items[j] = a;
    }
    return items;
  }

  /** Snapshot / restore, so a save file can resume an in-progress battle exactly. */
  getState(): [number, number, number, number] {
    return [this.s0, this.s1, this.s2, this.s3];
  }

  setState(state: readonly [number, number, number, number]): void {
    this.s0 = state[0] >>> 0;
    this.s1 = state[1] >>> 0;
    this.s2 = state[2] >>> 0;
    this.s3 = state[3] >>> 0;
  }
}

function splitmix32(a: number): number {
  a = (a + 0x9e3779b9) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
  return (t ^ (t >>> 15)) >>> 0;
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}
