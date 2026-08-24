/**
 * Experience, growth curves, evolution, money and the obedience cap.
 * `sojutsu-battle-math.md` §10, §11, §12, §13.
 */
import type { GrowthCurve, SpeciesDef } from './types.ts';

export const MAX_LEVEL = 100;

/** Total XP required to *reach* level n on each curve, per §10. */
function totalXpFor(curve: GrowthCurve, n: number): number {
  if (n <= 1) return 0;
  switch (curve) {
    case 'Fast':
      return Math.floor(0.8 * n ** 3);
    case 'Medium Fast':
      return Math.floor(n ** 3);
    case 'Medium Slow':
      return Math.max(0, Math.floor(1.2 * n ** 3 - 15 * n ** 2 + 100 * n - 140));
    case 'Slow':
      return Math.floor(1.25 * n ** 3);
  }
}

/**
 * Build-time lookup tables.
 *
 * §10 is explicit: there is no closed inverse, so precompute 100 entries per curve and
 * binary-search them. Do not solve the cubic at runtime.
 */
const CURVES: GrowthCurve[] = ['Fast', 'Medium Fast', 'Medium Slow', 'Slow'];

const XP_TABLE: Record<GrowthCurve, number[]> = Object.fromEntries(
  CURVES.map((c) => [c, Array.from({ length: MAX_LEVEL + 1 }, (_, n) => totalXpFor(c, n))]),
) as Record<GrowthCurve, number[]>;

export function xpToReachLevel(curve: GrowthCurve, level: number): number {
  const table = XP_TABLE[curve];
  return table[Math.max(1, Math.min(MAX_LEVEL, level))] ?? 0;
}

/** Binary search of the precomputed table. */
export function levelFromXp(curve: GrowthCurve, xp: number): number {
  const table = XP_TABLE[curve];
  let lo = 1;
  let hi = MAX_LEVEL;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((table[mid] ?? 0) <= xp) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** XP still needed to reach the next level, and how far through the current one we are. */
export function xpProgress(
  curve: GrowthCurve,
  xp: number,
): { level: number; intoLevel: number; forLevel: number; ratio: number } {
  const level = levelFromXp(curve, xp);
  if (level >= MAX_LEVEL) return { level, intoLevel: 0, forLevel: 0, ratio: 1 };
  const floorXp = xpToReachLevel(curve, level);
  const nextXp = xpToReachLevel(curve, level + 1);
  const forLevel = Math.max(1, nextXp - floorXp);
  const intoLevel = Math.max(0, xp - floorXp);
  return { level, intoLevel, forLevel, ratio: Math.min(1, intoLevel / forLevel) };
}

/**
 * XP = floor( (BaseYield × DefeatedLevel) / 7 ) / participants, ×1.5 for traded spirits (§10).
 */
export function xpAward(
  baseYield: number,
  defeatedLevel: number,
  participants: number,
  traded = false,
): number {
  const raw = Math.floor((baseYield * defeatedLevel) / 7) / Math.max(1, participants);
  return Math.max(1, Math.floor(raw * (traded ? 1.5 : 1)));
}

/* ------------------------------------------------------------- evolution */

export interface EvolutionCheck {
  readonly evolves: boolean;
  readonly into: string | null;
}

/**
 * §11: check evolution *after* the XP award resolves, and only when the level actually
 * incremented. In v1 every Stage 2 evolves straight into Final A with no condition — Final B
 * is deferred, so there is no branch to evaluate.
 */
export function checkEvolution(species: SpeciesDef, newLevel: number, levelActuallyRose: boolean): EvolutionCheck {
  if (!levelActuallyRose) return { evolves: false, into: null };
  if (species.evolvesAtLevel === null || species.evolvesInto === null) return { evolves: false, into: null };
  if (newLevel < species.evolvesAtLevel) return { evolves: false, into: null };
  return { evolves: true, into: species.evolvesInto };
}

/* ------------------------------------------------------------------ money */

export function prizeMoney(baseMoney: number, highestLevel: number, sigilsOwned: number): number {
  return Math.max(1, Math.floor(baseMoney * highestLevel * (1 + sigilsOwned * 0.5)));
}

export function blackoutLoss(playerMoney: number): number {
  return Math.floor(playerMoney / 2);
}

/* -------------------------------------------------------------- obedience */

/** §13. Values above 3 sigils are provisional pending Part-2 ace levels. */
const OBEDIENCE_CEILING = [15, 25, 35, 42, 49, 56, MAX_LEVEL];

export function obedienceCeiling(sigils: number): number {
  return OBEDIENCE_CEILING[Math.max(0, Math.min(6, sigils))] ?? MAX_LEVEL;
}

/** Only traded spirits can disobey — one you bound yourself always listens. */
export function willObey(level: number, sigils: number, traded: boolean): boolean {
  if (!traded) return true;
  return level <= obedienceCeiling(sigils);
}
