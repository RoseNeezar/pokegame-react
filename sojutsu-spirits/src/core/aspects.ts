/**
 * Aspect effectiveness — `sojutsu-battle-math.md` §3.
 *
 * The chart is the modern 18-aspect table with the document's two required corrections
 * (Ghost → Psychic is 2×, Ice resists Ice). Both are asserted at ingest time, so the data
 * cannot silently regress to the Gen-1 behaviour.
 */
import chart from '../data/generated/aspect-chart.json' with { type: 'json' };
import type { Aspect } from './types.ts';

const CHART = chart as Record<string, Record<string, number>>;

export type Effectiveness = 'immune' | 'resisted' | 'neutral' | 'effective';

/** Single-cell lookup. */
export function aspectCell(attacking: Aspect, defending: Aspect): number {
  return CHART[attacking]?.[defending] ?? 1;
}

/**
 * Full multiplier against a defender's Aspects. A dual-Aspect defender can reach ×4 or ×0.25,
 * and any 0 cell zeroes the product — the move then reports no effect at all.
 */
export function aspectMultiplier(attacking: Aspect, defending: readonly Aspect[]): number {
  let mult = 1;
  for (const d of defending) mult *= aspectCell(attacking, d);
  return mult;
}

/** 1.5 if the move's Aspect matches one of the user's, else 1.0. */
export function stab(moveAspect: Aspect, userAspects: readonly Aspect[]): number {
  return userAspects.includes(moveAspect) ? 1.5 : 1;
}

export function describeEffectiveness(mult: number): Effectiveness {
  if (mult === 0) return 'immune';
  if (mult < 1) return 'resisted';
  if (mult > 1) return 'effective';
  return 'neutral';
}

/** Player-facing line shown after a hit resolves. */
export function effectivenessMessage(mult: number): string | null {
  switch (describeEffectiveness(mult)) {
    case 'immune':
      return 'It has no effect.';
    case 'resisted':
      return mult <= 0.25 ? "It's barely felt." : "It's not very effective.";
    case 'effective':
      return mult >= 4 ? "It's devastating!" : "It's very effective!";
    default:
      return null;
  }
}
