/**
 * Binding — `sojutsu-battle-math.md` §9.
 *
 *   a = ((3 × MaxHP − 2 × CurrentHP) × CatchRate × TalismanBonus) / (3 × MaxHP) × StatusBonus
 *   b = 1048560 / √(√(16711680 / a))
 *
 * Four rolls of random(0..65535); capture succeeds if all four are < b. The number of rolls
 * that pass is the number of shakes shown, so a near-miss looks like a near-miss.
 */
import type { StatusKind, TalismanKind } from './types.ts';
import { statusCaptureBonus } from './status.ts';
import type { Rng } from './rng.ts';

export const TALISMAN_BONUS: Record<TalismanKind, number> = {
  basic: 1.0,
  great: 1.5,
  ultra: 2.0,
};

export const TALISMAN_LABEL: Record<TalismanKind, string> = {
  basic: 'Binding Talisman',
  great: 'Great Talisman',
  ultra: 'Ultra Talisman',
};

export interface CaptureInput {
  readonly maxHp: number;
  readonly currentHp: number;
  readonly catchRate: number;
  readonly talisman: TalismanKind;
  readonly status: StatusKind;
  /**
   * Chain held at the moment the target fainted, expressed as a multiplier on the talisman
   * bonus. See DESIGN.md [A-3] — a held chain is worth something after the fight is won.
   */
  readonly chainBonus?: number;
}

export interface CaptureResult {
  readonly caught: boolean;
  /** 0-4. How many of the four rolls passed — drives the shake animation. */
  readonly shakes: number;
  /** The `b` threshold, for tuning and for the debug overlay. */
  readonly threshold: number;
  /** Probability of a clean catch on this attempt, for tests and telemetry. */
  readonly probability: number;
}

/** The `a` term. Clamped to (0, 255] as the formula's domain requires. */
export function captureA(input: CaptureInput): number {
  const { maxHp, currentHp, catchRate, talisman, status } = input;
  const talismanBonus = TALISMAN_BONUS[talisman] * (input.chainBonus ?? 1);
  const hpTerm = 3 * maxHp - 2 * Math.max(1, currentHp);
  const a = ((hpTerm * catchRate * talismanBonus) / (3 * maxHp)) * statusCaptureBonus(status);
  return Math.max(1, Math.min(255, a));
}

/** The `b` shake threshold. */
export function captureB(a: number): number {
  return 1048560 / Math.sqrt(Math.sqrt(16711680 / a));
}

export function captureProbability(input: CaptureInput): number {
  const b = captureB(captureA(input));
  const perRoll = Math.min(1, b / 65536);
  return perRoll ** 4;
}

export function attemptCapture(input: CaptureInput, rng: Rng): CaptureResult {
  const a = captureA(input);
  const b = captureB(a);

  let shakes = 0;
  for (let i = 0; i < 4; i++) {
    if (rng.int(0, 65535) < b) shakes += 1;
    else break; // stop at the first failure — the shake count is the near-miss story
  }

  return {
    caught: shakes === 4,
    shakes,
    threshold: b,
    probability: captureProbability(input),
  };
}

/* ------------------------------------------------------------------ flee */

/**
 * §8: FleeChance = (UserSpeed × 32 / ((TargetSpeed / 4) mod 256) + 30 × attempts) / 256
 *
 * The `mod 256` can land on zero, which the original handles as a guaranteed escape.
 */
export function fleeChance(userSpeed: number, targetSpeed: number, attempts: number): number {
  const divisor = Math.floor(targetSpeed / 4) % 256;
  if (divisor <= 0) return 1;
  const raw = ((userSpeed * 32) / divisor + 30 * attempts) / 256;
  return Math.max(0, Math.min(1, raw));
}

export function attemptFlee(userSpeed: number, targetSpeed: number, attempts: number, rng: Rng): boolean {
  return rng.chance(fleeChance(userSpeed, targetSpeed, attempts));
}
