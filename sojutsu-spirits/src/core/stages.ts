/**
 * Stat stages and the accuracy/evasion table — `sojutsu-battle-math.md` §5 and §6.
 *
 * These are two *different* tables and conflating them is a classic source of drift:
 *   • stats     use (2 + stage) / 2  and  2 / (2 - stage)     — the 2/2 table
 *   • acc / eva use (3 + stage) / 3  and  3 / (3 - stage)     — the 3/3 table
 */
import type { StageKey } from './types.ts';

export const STAGE_MIN = -6;
export const STAGE_MAX = 6;

export type Stages = Record<StageKey, number>;

export function freshStages(): Stages {
  return { attack: 0, defense: 0, speed: 0, special: 0, accuracy: 0, evasion: 0 };
}

export function clampStage(stage: number): number {
  return Math.max(STAGE_MIN, Math.min(STAGE_MAX, stage));
}

/**
 * Applies a stage change and reports what actually happened, so the battle log can say
 * "it won't go any higher" rather than silently doing nothing.
 */
export function applyStage(
  stages: Stages,
  key: StageKey,
  delta: number,
): { applied: number; atLimit: boolean } {
  const before = stages[key];
  const after = clampStage(before + delta);
  stages[key] = after;
  return { applied: after - before, atLimit: after === before && delta !== 0 };
}

/** The 2/2 table: −6 → 0.25, 0 → 1.00, +6 → 4.00. */
export function statStageMultiplier(stage: number): number {
  const s = clampStage(stage);
  return s >= 0 ? (2 + s) / 2 : 2 / (2 - s);
}

/** The 3/3 table: −6 → 0.33, 0 → 1.00, +6 → 3.00. */
export function accuracyStageMultiplier(stage: number): number {
  const s = clampStage(stage);
  return s >= 0 ? (3 + s) / 3 : 3 / (3 - s);
}

export const MIN_HIT_CHANCE = 1 / 256;

/**
 * HitChance = MoveAccuracy × (AccStage / EvaStage), capped at 100% and floored at 1/256 —
 * never unmissable, never unusable.
 */
export function hitChance(moveAccuracy: number, accStage: number, evaStage: number): number {
  const raw =
    (moveAccuracy / 100) * (accuracyStageMultiplier(accStage) / accuracyStageMultiplier(evaStage));
  return Math.max(MIN_HIT_CHANCE, Math.min(1, raw));
}
