/**
 * Stat calculation, Grade rolls and Resonance.
 *
 * Implements `sojutsu-battle-math.md` §1 exactly, including the HP quirk the document
 * explicitly tells us not to "fix".
 */
import type { BaseStats, Grade, Resonance, SpeciesDef, StatKey } from './types.ts';
import type { Rng } from './rng.ts';

export const RESONANCE_CAP = 65535;
export const GRADE_MAX = 15;

/** floor(sqrt(resonance) / 4) — caps at +63, per §1. */
export function resonanceBonus(resonance: number): number {
  return Math.floor(Math.sqrt(Math.max(0, Math.min(RESONANCE_CAP, resonance))) / 4);
}

/**
 * HP = floor( ((Base + Grade) × 2 + floor(√Resonance / 4)) × Level / 100 ) + Level + 10
 *
 * HP is the only stat with `+ Level + 10` rather than `+ 5`. That is deliberate.
 */
export function computeHp(base: number, grade: number, resonance: number, level: number): number {
  const inner = (base + grade) * 2 + resonanceBonus(resonance);
  return Math.floor((inner * level) / 100) + level + 10;
}

/** Stat = floor( ((Base + Grade) × 2 + floor(√Resonance / 4)) × Level / 100 ) + 5 */
export function computeStat(base: number, grade: number, resonance: number, level: number): number {
  const inner = (base + grade) * 2 + resonanceBonus(resonance);
  return Math.floor((inner * level) / 100) + 5;
}

export interface ComputedStats {
  readonly maxHp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly special: number;
}

export function computeStats(
  base: BaseStats,
  grade: Grade,
  resonance: Resonance,
  level: number,
): ComputedStats {
  return {
    maxHp: computeHp(base.hp, grade.hp, resonance.hp, level),
    attack: computeStat(base.attack, grade.attack, resonance.attack, level),
    defense: computeStat(base.defense, grade.defense, resonance.defense, level),
    speed: computeStat(base.speed, grade.speed, resonance.speed, level),
    special: computeStat(base.special, grade.special, resonance.special, level),
  };
}

/**
 * Rolls a Grade.
 *
 * Attack/Defense/Speed/Special are each `random(0..15)`; HP is derived from their
 * least-significant bits, which is what ties a perfect HP roll to specific combinations
 * elsewhere and makes genuinely perfect spirits rare rather than merely uncommon.
 */
export function rollGrade(rng: Rng): Grade {
  const attack = rng.int(0, GRADE_MAX);
  const defense = rng.int(0, GRADE_MAX);
  const speed = rng.int(0, GRADE_MAX);
  const special = rng.int(0, GRADE_MAX);
  return { attack, defense, speed, special, hp: deriveHpGrade(attack, defense, speed, special) };
}

export function deriveHpGrade(attack: number, defense: number, speed: number, special: number): number {
  return (attack & 1) * 8 + (defense & 1) * 4 + (speed & 1) * 2 + (special & 1);
}

export function perfectGrade(): Grade {
  return { hp: 15, attack: 15, defense: 15, speed: 15, special: 15 };
}

export function zeroGrade(): Grade {
  return { hp: 0, attack: 0, defense: 0, speed: 0, special: 0 };
}

export function zeroResonance(): Resonance {
  return { hp: 0, attack: 0, defense: 0, speed: 0, special: 0 };
}

/**
 * Resonance gain, §1: on defeating a spirit, each participant gains that species' base stat
 * into the matching pool, capped at 65535.
 */
export function awardResonance(into: Resonance, defeated: SpeciesDef): void {
  const keys: StatKey[] = ['hp', 'attack', 'defense', 'speed', 'special'];
  for (const k of keys) {
    into[k] = Math.min(RESONANCE_CAP, into[k] + defeated.base[k]);
  }
}
