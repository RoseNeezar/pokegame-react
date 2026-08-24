import { describe, it, expect } from 'vitest';
import { computeHp, computeStat, deriveHpGrade, resonanceBonus, rollGrade, awardResonance, zeroResonance } from './stats.ts';
import { Rng } from './rng.ts';
import type { SpeciesDef } from './types.ts';

describe('stat calculation (battle-math §1)', () => {
  it('matches the document\'s worked example — Fawnix at Lv 20, perfect Grade', () => {
    // ((41 + 15) × 2 + 0) × 20/100 = 22.4 → 22;  22 + 20 + 10 = 52
    expect(computeHp(41, 15, 0, 20)).toBe(52);
  });

  it('matches the document\'s worked example — Fawnix at Lv 20, worst Grade', () => {
    // ((41 + 0) × 2 + 0) × 20/100 = 16.4 → 16;  16 + 20 + 10 = 46
    expect(computeHp(41, 0, 0, 20)).toBe(46);
  });

  it('gives the 6 HP spread the document calls "the right feel"', () => {
    expect(computeHp(41, 15, 0, 20) - computeHp(41, 0, 0, 20)).toBe(6);
  });

  it('applies +5, not +Level+10, to non-HP stats', () => {
    expect(computeStat(41, 15, 0, 20)).toBe(Math.floor((56 * 2 * 20) / 100) + 5);
  });

  it('caps the Resonance contribution at +63', () => {
    expect(resonanceBonus(65535)).toBe(63);
    expect(resonanceBonus(0)).toBe(0);
    expect(resonanceBonus(1_000_000)).toBe(63); // clamped before the sqrt
  });

  it('grows HP faster in absolute terms than other stats, as the +Level+10 term intends', () => {
    const hpGain = computeHp(60, 8, 0, 50) - computeHp(60, 8, 0, 10);
    const atkGain = computeStat(60, 8, 0, 50) - computeStat(60, 8, 0, 10);
    // Same inner term, so the gap is exactly the extra 40 levels the HP formula adds.
    expect(hpGain - atkGain).toBe(40);
    expect(hpGain).toBeGreaterThan(atkGain);
  });
});

describe('Grade rolls', () => {
  it('derives HP Grade from the LSBs of the other four', () => {
    expect(deriveHpGrade(15, 15, 15, 15)).toBe(15);
    expect(deriveHpGrade(14, 14, 14, 14)).toBe(0);
    expect(deriveHpGrade(1, 0, 0, 0)).toBe(8);
    expect(deriveHpGrade(0, 1, 0, 0)).toBe(4);
    expect(deriveHpGrade(0, 0, 1, 0)).toBe(2);
    expect(deriveHpGrade(0, 0, 0, 1)).toBe(1);
  });

  it('keeps every rolled Grade in range and self-consistent', () => {
    const rng = new Rng('grade-spread');
    for (let i = 0; i < 2000; i++) {
      const g = rollGrade(rng);
      for (const v of [g.attack, g.defense, g.speed, g.special, g.hp]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(15);
      }
      expect(g.hp).toBe(deriveHpGrade(g.attack, g.defense, g.speed, g.special));
    }
  });

  it('makes a perfect spirit genuinely rare — 1 in 65536, not 1 in 16', () => {
    const rng = new Rng('perfection');
    let perfect = 0;
    const trials = 200_000;
    for (let i = 0; i < trials; i++) {
      const g = rollGrade(rng);
      if (g.attack === 15 && g.defense === 15 && g.speed === 15 && g.special === 15) perfect++;
    }
    // Expected ≈ 3 in 200k. Assert only that it is vanishingly rare.
    expect(perfect).toBeLessThan(20);
  });
});

describe('Resonance', () => {
  const dummy = { base: { hp: 41, attack: 44, defense: 43, speed: 72, special: 70 } } as SpeciesDef;

  it('adds the defeated species\' base stats into the matching pools', () => {
    const r = zeroResonance();
    awardResonance(r, dummy);
    expect(r).toEqual({ hp: 41, attack: 44, defense: 43, speed: 72, special: 70 });
  });

  it('caps each pool at 65535', () => {
    const r = { hp: 65530, attack: 0, defense: 0, speed: 0, special: 0 };
    awardResonance(r, dummy);
    expect(r.hp).toBe(65535);
  });
});
