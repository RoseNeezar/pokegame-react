/**
 * Damage — `sojutsu-battle-math.md` §2, §4.
 *
 * Base = floor( floor( floor(2 × Level × Crit / 5 + 2) × Power × A / D ) / 50 ) + 2
 * Damage = Base × STAB × Aspect × Random          Random = random(217..255) / 255
 *
 * The nested floors are not decorative — they are the formula, and moving one changes every
 * damage roll in the game. They are written out here in the same order the document writes them.
 */
import type { Aspect, MoveCategory, MoveDef } from './types.ts';
import type { Rng } from './rng.ts';
import { aspectMultiplier, stab } from './aspects.ts';
import { statStageMultiplier } from './stages.ts';

export const CRIT_STAGE_ODDS: Record<number, number> = {
  0: 1 / 24,
  1: 1 / 8,
  2: 1 / 2,
  3: 1,
};

export function critChance(stage: number): number {
  const s = Math.max(0, Math.min(3, Math.floor(stage)));
  return CRIT_STAGE_ODDS[s] ?? 1 / 24;
}

export function rollCrit(rng: Rng, stage: number): boolean {
  const p = critChance(stage);
  return p >= 1 ? true : rng.chance(p);
}

/** random(217..255) / 255 — a 0.851–1.000 spread. */
export function damageRandom(rng: Rng): number {
  return rng.int(217, 255) / 255;
}

export interface Combatant {
  readonly level: number;
  readonly aspects: readonly Aspect[];
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly special: number;
  readonly maxHp: number;
  readonly currentHp: number;
  /** Live stat stages. */
  readonly stageAttack: number;
  readonly stageDefense: number;
  readonly stageSpecial: number;
  readonly burned: boolean;
}

export interface DamageOptions {
  readonly crit?: boolean;
  /** Forces the random term — used by tests and by fixed-damage moves. */
  readonly randomTerm?: number;
  /** Self-destruct class halves the target's Defense for the calculation (§2). */
  readonly halveDefense?: boolean;
  /** Chain multiplier from the math layer. Applied last, after the spec's own terms. */
  readonly chainMultiplier?: number;
  /** Scales Power before the formula — how `reduced_power` failures are expressed. */
  readonly powerScale?: number;
}

export interface DamageResult {
  readonly damage: number;
  readonly crit: boolean;
  readonly aspectMultiplier: number;
  readonly stab: number;
  readonly randomTerm: number;
  readonly chainMultiplier: number;
  /** True when the Aspect product is 0 — the move reports no effect and deals nothing. */
  readonly noEffect: boolean;
}

/**
 * Picks the attack/defense pair for a category.
 *
 * Gen-1 lineage: Special is one stat used for both special attack and special defense, which is
 * what the stat tables in `sojutsu_spirit_data.csv` are built around.
 */
function offenseDefense(
  category: MoveCategory,
  attacker: Combatant,
  defender: Combatant,
  crit: boolean,
  halveDefense: boolean,
): { a: number; d: number } {
  const physical = category === 'Phys';

  let a = physical ? attacker.attack : attacker.special;
  let d = physical ? defender.defense : defender.special;

  if (crit) {
    // §4: crits ignore the defender's Defense buffs and the attacker's Attack debuffs.
    const aStage = physical ? attacker.stageAttack : attacker.stageSpecial;
    const dStage = physical ? defender.stageDefense : defender.stageSpecial;
    a = Math.floor(a * statStageMultiplier(Math.max(0, aStage)));
    d = Math.floor(d * statStageMultiplier(Math.min(0, dStage)));
  } else {
    a = Math.floor(a * statStageMultiplier(physical ? attacker.stageAttack : attacker.stageSpecial));
    d = Math.floor(d * statStageMultiplier(physical ? defender.stageDefense : defender.stageSpecial));
  }

  // §7: Burn halves Attack. Physical only — it is an Attack debuff, not a Special one.
  if (physical && attacker.burned) a = Math.floor(a / 2);

  if (halveDefense) d = Math.floor(d / 2);

  return { a: Math.max(1, a), d: Math.max(1, d) };
}

export function computeDamage(
  move: MoveDef,
  power: number,
  attacker: Combatant,
  defender: Combatant,
  rng: Rng,
  opts: DamageOptions = {},
): DamageResult {
  const aspect = aspectMultiplier(move.aspect, defender.aspects);
  const chainMultiplier = opts.chainMultiplier ?? 1;

  if (aspect === 0) {
    return {
      damage: 0,
      crit: false,
      aspectMultiplier: 0,
      stab: 1,
      randomTerm: 1,
      chainMultiplier,
      noEffect: true,
    };
  }

  const crit = opts.crit ?? false;
  const scaledPower = Math.max(1, Math.floor(power * (opts.powerScale ?? 1)));
  const { a, d } = offenseDefense(move.category, attacker, defender, crit, opts.halveDefense ?? false);

  const critTerm = crit ? 2 : 1;
  const levelTerm = Math.floor((2 * attacker.level * critTerm) / 5 + 2);

  let base = Math.floor(Math.floor((levelTerm * scaledPower * a) / d) / 50) + 2;

  const stabTerm = stab(move.aspect, attacker.aspects);
  const randomTerm = opts.randomTerm ?? damageRandom(rng);

  base = base * stabTerm * aspect * randomTerm * chainMultiplier;

  // §2: minimum damage on any connecting hit is 1.
  const damage = Math.max(1, Math.floor(base));

  return { damage, crit, aspectMultiplier: aspect, stab: stabTerm, randomTerm, chainMultiplier, noEffect: false };
}

/* ------------------------------------------------------- fixed-damage moves */

/** The §2 fixed-damage exceptions, keyed by move id. */
export type FixedDamageKind = 'level' | 'flat40' | 'psywave' | 'counter' | 'ohko';

const FIXED_DAMAGE: Record<string, FixedDamageKind> = {
  'gravity-slam': 'level',
  'draconic-burst': 'flat40',
  'mind-pulse': 'psywave',
  retaliate: 'counter',
};

export function fixedDamageKind(move: MoveDef): FixedDamageKind | null {
  if (FIXED_DAMAGE[move.id]) return FIXED_DAMAGE[move.id]!;
  if (isOhko(move)) return 'ohko';
  return null;
}

export function isOhko(move: MoveDef): boolean {
  return /one[- ]hit|ohko|instant(ly)? faint/i.test(move.effect ?? '') || move.powerNote === 'OHKO';
}

export interface FixedDamageContext {
  readonly attacker: Combatant;
  readonly defender: Combatant;
  /** Physical damage the user took this turn — Retaliate's input. */
  readonly damageTakenThisTurn: number;
}

/**
 * Fixed-damage moves ignore the §2 formula entirely.
 * Returns null when the move cannot connect at all (OHKO against a faster target).
 */
export function computeFixedDamage(
  kind: FixedDamageKind,
  ctx: FixedDamageContext,
  rng: Rng,
): number | null {
  switch (kind) {
    case 'level':
      return ctx.attacker.level;
    case 'flat40':
      return 40;
    case 'psywave':
      return rng.int(1, Math.max(1, Math.floor(ctx.attacker.level * 1.5)));
    case 'counter':
      return ctx.damageTakenThisTurn > 0 ? ctx.damageTakenThisTurn * 2 : null;
    case 'ohko':
      // §2: fails entirely if the target's Speed exceeds the user's.
      return ctx.defender.speed > ctx.attacker.speed ? null : ctx.defender.maxHp;
    default:
      return null;
  }
}

/* ----------------------------------------------------------- recoil / drain */

export function recoilDamage(damageDealt: number): number {
  return Math.floor(damageDealt / 4);
}

export function drainHeal(damageDealt: number): number {
  return Math.floor(damageDealt / 2);
}
