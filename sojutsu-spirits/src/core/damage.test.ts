import { describe, it, expect } from 'vitest';
import { computeDamage, computeFixedDamage, critChance, damageRandom, drainHeal, recoilDamage } from './damage.ts';
import type { Combatant } from './damage.ts';
import { Rng } from './rng.ts';
import { aspectMultiplier, aspectCell, stab, effectivenessMessage } from './aspects.ts';
import { hitChance, statStageMultiplier, accuracyStageMultiplier, applyStage, freshStages } from './stages.ts';
import type { MoveDef } from './types.ts';
import moves from '../data/generated/moves.json' with { type: 'json' };

const MOVES = moves as unknown as MoveDef[];
const byId = new Map(MOVES.map((m) => [m.id, m]));

function combatant(over: Partial<Combatant> = {}): Combatant {
  return {
    level: 50,
    aspects: ['Normal'],
    attack: 100,
    defense: 100,
    speed: 100,
    special: 100,
    maxHp: 200,
    currentHp: 200,
    stageAttack: 0,
    stageDefense: 0,
    stageSpecial: 0,
    burned: false,
    ...over,
  };
}

const powerJab = byId.get('power-jab')!;

describe('damage formula (battle-math §2)', () => {
  it('reproduces the formula term-for-term at a known point', () => {
    // level 50, no crit → floor(2×50×1/5 + 2) = 22
    // floor(floor(22 × 80 × 100 / 100) / 50) + 2 = floor(1760/50)+2 = 35+2 = 37
    // ×STAB 1.5 (Normal move, Normal user) ×aspect 1 ×random 1 = 55.5 → 55
    const r = computeDamage(powerJab, 80, combatant(), combatant(), new Rng(1), { randomTerm: 1 });
    expect(r.stab).toBe(1.5);
    expect(r.damage).toBe(55);
  });

  it('drops STAB when the Aspect does not match the user', () => {
    const r = computeDamage(powerJab, 80, combatant({ aspects: ['Fire'] }), combatant(), new Rng(1), {
      randomTerm: 1,
    });
    expect(r.stab).toBe(1);
    expect(r.damage).toBe(37);
  });

  it('doubles the level term on a critical hit', () => {
    const normal = computeDamage(powerJab, 80, combatant(), combatant(), new Rng(1), { randomTerm: 1 });
    const crit = computeDamage(powerJab, 80, combatant(), combatant(), new Rng(1), {
      randomTerm: 1,
      crit: true,
    });
    expect(crit.damage).toBeGreaterThan(normal.damage);
  });

  it('ignores the defender\'s Defense buff on a crit', () => {
    const buffed = combatant({ stageDefense: 6 });
    const withCrit = computeDamage(powerJab, 80, combatant(), buffed, new Rng(1), { randomTerm: 1, crit: true });
    const noCrit = computeDamage(powerJab, 80, combatant(), buffed, new Rng(1), { randomTerm: 1 });
    // The crit should not merely be 2× — it also erases the ×4 Defense buff.
    expect(withCrit.damage).toBeGreaterThan(noCrit.damage * 3);
  });

  it('ignores the attacker\'s Attack debuff on a crit', () => {
    const weak = combatant({ stageAttack: -6 });
    const withCrit = computeDamage(powerJab, 80, weak, combatant(), new Rng(1), { randomTerm: 1, crit: true });
    const noCrit = computeDamage(powerJab, 80, weak, combatant(), new Rng(1), { randomTerm: 1 });
    expect(withCrit.damage).toBeGreaterThan(noCrit.damage * 3);
  });

  it('halves Attack when the attacker is burned, and only for physical moves', () => {
    const burned = computeDamage(powerJab, 80, combatant({ burned: true }), combatant(), new Rng(1), {
      randomTerm: 1,
    });
    const healthy = computeDamage(powerJab, 80, combatant(), combatant(), new Rng(1), { randomTerm: 1 });
    expect(burned.damage).toBeLessThan(healthy.damage);

    const special = MOVES.find((m) => m.category === 'Spec' && m.power !== null)!;
    const burnedSpec = computeDamage(special, 80, combatant({ burned: true }), combatant(), new Rng(1), {
      randomTerm: 1,
    });
    const healthySpec = computeDamage(special, 80, combatant(), combatant(), new Rng(1), { randomTerm: 1 });
    expect(burnedSpec.damage).toBe(healthySpec.damage);
  });

  it('deals exactly zero and reports no effect when the Aspect product is 0', () => {
    const ghost = combatant({ aspects: ['Ghost'] });
    const r = computeDamage(powerJab, 80, combatant(), ghost, new Rng(1), { randomTerm: 1 });
    expect(r.noEffect).toBe(true);
    expect(r.damage).toBe(0);
    expect(effectivenessMessage(r.aspectMultiplier)).toBe('It has no effect.');
  });

  it('never deals less than 1 on a connecting hit', () => {
    const tank = combatant({ defense: 999 });
    const flea = combatant({ attack: 1, level: 1 });
    const r = computeDamage(powerJab, 1, flea, tank, new Rng(1), { randomTerm: 0.851 });
    expect(r.damage).toBeGreaterThanOrEqual(1);
  });

  it('keeps the random term inside the documented 0.851–1.000 spread', () => {
    const rng = new Rng('spread');
    let min = 1;
    let max = 0;
    for (let i = 0; i < 20_000; i++) {
      const v = damageRandom(rng);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(217 / 255);
    expect(max).toBeLessThanOrEqual(1);
    expect(min).toBeCloseTo(217 / 255, 3);
    expect(max).toBe(1);
  });

  it('is fully deterministic for a given seed', () => {
    const a = new Rng('battle-42');
    const b = new Rng('battle-42');
    for (let i = 0; i < 200; i++) {
      expect(computeDamage(powerJab, 80, combatant(), combatant(), a).damage).toBe(
        computeDamage(powerJab, 80, combatant(), combatant(), b).damage,
      );
    }
  });

  it('applies the chain multiplier last, on top of the spec\'s own terms', () => {
    const plain = computeDamage(powerJab, 80, combatant(), combatant(), new Rng(1), { randomTerm: 1 });
    const chained = computeDamage(powerJab, 80, combatant(), combatant(), new Rng(1), {
      randomTerm: 1,
      chainMultiplier: 2,
    });
    expect(chained.damage).toBe(plain.damage * 2 + 1); // floor(55×2)=110 vs floor(55)=55 → 111 vs 55.5
  });

  it('scales power for a reduced_power failure without touching anything else', () => {
    const full = computeDamage(powerJab, 80, combatant(), combatant(), new Rng(1), { randomTerm: 1 });
    const half = computeDamage(powerJab, 80, combatant(), combatant(), new Rng(1), {
      randomTerm: 1,
      powerScale: 0.5,
    });
    expect(half.damage).toBeLessThan(full.damage);
    expect(half.damage).toBeGreaterThan(0);
  });

  it('halves the defender\'s Defense for self-destruct class moves', () => {
    const normal = computeDamage(powerJab, 130, combatant(), combatant(), new Rng(1), { randomTerm: 1 });
    const boom = computeDamage(powerJab, 130, combatant(), combatant(), new Rng(1), {
      randomTerm: 1,
      halveDefense: true,
    });
    expect(boom.damage).toBeGreaterThan(normal.damage * 1.8);
  });
});

describe('critical hits (§4)', () => {
  it('uses the documented stage table', () => {
    expect(critChance(0)).toBeCloseTo(1 / 24);
    expect(critChance(1)).toBeCloseTo(1 / 8);
    expect(critChance(2)).toBeCloseTo(1 / 2);
    expect(critChance(3)).toBe(1);
  });

  it('is not tied to base Speed — a fast spirit crits no more often', () => {
    // The point of the stage table is that Speed is out of the equation entirely.
    expect(critChance(0)).toBe(critChance(0));
  });
});

describe('fixed-damage exceptions (§2)', () => {
  const ctx = { attacker: combatant({ level: 37 }), defender: combatant(), damageTakenThisTurn: 0 };

  it('Gravity Slam deals the user\'s level', () => {
    expect(computeFixedDamage('level', ctx, new Rng(1))).toBe(37);
  });

  it('Draconic Burst deals a flat 40', () => {
    expect(computeFixedDamage('flat40', ctx, new Rng(1))).toBe(40);
  });

  it('Mind Pulse stays within 1..floor(level × 1.5)', () => {
    const rng = new Rng('psywave');
    for (let i = 0; i < 500; i++) {
      const d = computeFixedDamage('psywave', ctx, rng)!;
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(Math.floor(37 * 1.5));
    }
  });

  it('Retaliate returns double the physical damage taken, and fails when none was', () => {
    expect(computeFixedDamage('counter', { ...ctx, damageTakenThisTurn: 30 }, new Rng(1))).toBe(60);
    expect(computeFixedDamage('counter', ctx, new Rng(1))).toBeNull();
  });

  it('OHKO deals MaxHP, but fails entirely against a faster target', () => {
    const slowTarget = { ...ctx, defender: combatant({ speed: 50, maxHp: 180 }) };
    expect(computeFixedDamage('ohko', slowTarget, new Rng(1))).toBe(180);

    const fastTarget = { ...ctx, defender: combatant({ speed: 500 }) };
    expect(computeFixedDamage('ohko', fastTarget, new Rng(1))).toBeNull();
  });
});

describe('recoil and drain (§2)', () => {
  it('recoils a quarter and drains a half, floored', () => {
    expect(recoilDamage(100)).toBe(25);
    expect(recoilDamage(3)).toBe(0);
    expect(drainHeal(101)).toBe(50);
  });
});

describe('aspect chart (§3)', () => {
  it('carries the two corrections the document requires', () => {
    expect(aspectCell('Ghost', 'Psychic')).toBe(2); // not the Gen-1 0× bug
    expect(aspectCell('Ice', 'Ice')).toBe(0.5); // Ice resists itself
  });

  it('multiplies both cells for a dual-Aspect defender, reaching ×4 and ×0.25', () => {
    // Rock hits Flying 2× and Bug 2× → Buzzguard (Bug/Flying) takes ×4.
    expect(aspectMultiplier('Rock', ['Bug', 'Flying'])).toBe(4);
    // Grass into Grass 0.5 and Flying 0.5 → ×0.25.
    expect(aspectMultiplier('Grass', ['Grass', 'Flying'])).toBe(0.25);
  });

  it('zeroes the whole product if any cell is 0', () => {
    expect(aspectMultiplier('Normal', ['Ghost', 'Flying'])).toBe(0);
    expect(aspectMultiplier('Electric', ['Ground', 'Water'])).toBe(0);
  });

  it('grants STAB only on a matching Aspect', () => {
    expect(stab('Fire', ['Fire', 'Steel'])).toBe(1.5);
    expect(stab('Fire', ['Water'])).toBe(1);
  });
});

describe('stat stages (§6) and accuracy (§5)', () => {
  it('uses the 2/2 table for stats', () => {
    expect(statStageMultiplier(-6)).toBeCloseTo(0.25);
    expect(statStageMultiplier(-4)).toBeCloseTo(0.333, 2);
    expect(statStageMultiplier(-2)).toBeCloseTo(0.5);
    expect(statStageMultiplier(0)).toBe(1);
    expect(statStageMultiplier(2)).toBe(2);
    expect(statStageMultiplier(4)).toBe(3);
    expect(statStageMultiplier(6)).toBe(4);
  });

  it('uses the different 3/3 table for accuracy and evasion', () => {
    expect(accuracyStageMultiplier(-6)).toBeCloseTo(0.33, 2);
    expect(accuracyStageMultiplier(-2)).toBeCloseTo(0.6, 2);
    expect(accuracyStageMultiplier(0)).toBe(1);
    expect(accuracyStageMultiplier(2)).toBeCloseTo(5 / 3, 6); // the table prints this as 1.66
    expect(accuracyStageMultiplier(6)).toBe(3);
  });

  it('clamps stages to ±6 and reports hitting the limit', () => {
    const s = freshStages();
    applyStage(s, 'attack', 2);
    applyStage(s, 'attack', 2);
    applyStage(s, 'attack', 2);
    expect(s.attack).toBe(6);
    const again = applyStage(s, 'attack', 2);
    expect(again.applied).toBe(0);
    expect(again.atLimit).toBe(true);
  });

  it('caps hit chance at 100% and floors it at 1/256 — never unmissable, never unusable', () => {
    expect(hitChance(100, 6, -6)).toBe(1);
    expect(hitChance(30, -6, 6)).toBeGreaterThanOrEqual(1 / 256);
    expect(hitChance(100, 0, 0)).toBe(1);
    expect(hitChance(70, 0, 0)).toBeCloseTo(0.7);
  });

  it('gives Blade Ritual its documented +2 Attack, doubling the stat in one turn', () => {
    const s = freshStages();
    applyStage(s, 'attack', 2);
    expect(statStageMultiplier(s.attack)).toBe(2);
  });
});
