import { describe, it, expect } from 'vitest';
import {
  xpToReachLevel,
  levelFromXp,
  xpAward,
  xpProgress,
  checkEvolution,
  prizeMoney,
  blackoutLoss,
  obedienceCeiling,
  willObey,
} from './progression.ts';
import { attemptCapture, captureA, captureB, captureProbability, fleeChance } from './capture.ts';
import { Rng } from './rng.ts';
import type { SpeciesDef } from './types.ts';
import species from '../data/generated/species.json' with { type: 'json' };

const SPECIES = species as unknown as SpeciesDef[];
const byId = new Map(SPECIES.map((s) => [s.id, s]));

describe('growth curves (§10)', () => {
  it('matches the document\'s stated Lv 30 totals', () => {
    expect(xpToReachLevel('Medium Slow', 30)).toBe(21_760);
    expect(xpToReachLevel('Medium Fast', 30)).toBe(27_000);
    expect(xpToReachLevel('Slow', 30)).toBe(33_750);
  });

  it('matches the CSV\'s own "Total XP at Evo Lv" column for every evolving species', () => {
    // The species CSV independently states the XP total at each evolution level. If our curve
    // implementation disagrees with it, one of the two is wrong — and both are shipped data.
    const cases: Array<[string, number, number]> = [
      ['gearbit', 15, 3375], // Medium Fast, 15³
      ['knighton', 30, 27_000],
      ['spriglim', 16, 2535], // Medium Slow
      ['fawnix', 16, 2535],
      ['leafkin', 30, 21_760],
    ];
    for (const [id, level, expected] of cases) {
      const s = byId.get(id)!;
      expect(`${id}@${level}`).toBe(`${id}@${s.evolvesAtLevel}`);
      expect(xpToReachLevel(s.growth, level)).toBe(expected);
    }
  });

  it('is monotonic and inverts cleanly', () => {
    for (const curve of ['Fast', 'Medium Fast', 'Medium Slow', 'Slow'] as const) {
      for (let lv = 2; lv <= 100; lv++) {
        expect(xpToReachLevel(curve, lv)).toBeGreaterThan(xpToReachLevel(curve, lv - 1));
      }
      for (let lv = 1; lv <= 100; lv++) {
        expect(levelFromXp(curve, xpToReachLevel(curve, lv))).toBe(lv);
        if (lv < 100) expect(levelFromXp(curve, xpToReachLevel(curve, lv + 1) - 1)).toBe(lv);
      }
    }
  });

  it('reports progress through the current level', () => {
    const p = xpProgress('Medium Fast', 27_000);
    expect(p.level).toBe(30);
    expect(p.intoLevel).toBe(0);
    expect(p.ratio).toBe(0);

    const mid = xpProgress('Medium Fast', 27_000 + Math.floor((29_791 - 27_000) / 2));
    expect(mid.level).toBe(30);
    expect(mid.ratio).toBeGreaterThan(0.4);
    expect(mid.ratio).toBeLessThan(0.6);
  });
});

describe('experience award (§10)', () => {
  it('divides by participants and floors', () => {
    expect(xpAward(55, 14, 1)).toBe(Math.floor((55 * 14) / 7));
    expect(xpAward(55, 14, 2)).toBe(Math.floor(Math.floor((55 * 14) / 7) / 2));
  });

  it('applies ×1.5 to traded spirits', () => {
    expect(xpAward(120, 20, 1, true)).toBe(Math.floor(Math.floor((120 * 20) / 7) * 1.5));
  });

  it('never awards zero', () => {
    expect(xpAward(1, 1, 6)).toBeGreaterThanOrEqual(1);
  });
});

describe('evolution (§11)', () => {
  it('evolves only when the level actually incremented', () => {
    const fawnix = byId.get('fawnix')!;
    expect(checkEvolution(fawnix, 16, false).evolves).toBe(false);
    expect(checkEvolution(fawnix, 16, true).evolves).toBe(true);
    expect(checkEvolution(fawnix, 16, true).into).toBe('vulpine');
  });

  it('does not evolve below the trigger level', () => {
    expect(checkEvolution(byId.get('fawnix')!, 15, true).evolves).toBe(false);
  });

  it('leaves final forms alone', () => {
    expect(checkEvolution(byId.get('ferravulp')!, 99, true).evolves).toBe(false);
  });

  it('sends every Stage 2 to Final A in v1, never Final B', () => {
    for (const s of SPECIES) {
      if (s.stage !== 'Stage 2') continue;
      const target = byId.get(s.evolvesInto!)!;
      expect(target.stage).toBe('Final A');
    }
  });

  it('fully evolves every line by Lv 30, as the curve table promises', () => {
    for (const s of SPECIES) {
      if (s.evolvesAtLevel === null) continue;
      expect(s.evolvesAtLevel).toBeLessThanOrEqual(30);
    }
  });

  it('uses the documented triggers: Medium Fast 15/30, Medium Slow and Slow 16/30', () => {
    for (const s of SPECIES) {
      if (s.evolvesAtLevel === null) continue;
      const expected = s.stage === 'Base' ? (s.growth === 'Medium Fast' ? 15 : 16) : 30;
      expect(`${s.name}:${s.evolvesAtLevel}`).toBe(`${s.name}:${expected}`);
    }
  });
});

describe('capture (§9)', () => {
  const helmling = byId.get('helmling')!;

  it('is easier at low HP than at full', () => {
    const base = { maxHp: 100, catchRate: helmling.catchRate, talisman: 'basic' as const, status: 'none' as const };
    expect(captureProbability({ ...base, currentHp: 1 })).toBeGreaterThan(
      captureProbability({ ...base, currentHp: 100 }),
    );
  });

  it('rewards better talismans and status, in the documented order', () => {
    const base = { maxHp: 100, currentHp: 50, catchRate: 190, status: 'none' as const };
    const basic = captureProbability({ ...base, talisman: 'basic' });
    const great = captureProbability({ ...base, talisman: 'great' });
    const ultra = captureProbability({ ...base, talisman: 'ultra' });
    expect(great).toBeGreaterThan(basic);
    expect(ultra).toBeGreaterThan(great);

    const asleep = captureProbability({ ...base, talisman: 'basic', status: 'sleep' });
    const poisoned = captureProbability({ ...base, talisman: 'basic', status: 'poison' });
    expect(asleep).toBeGreaterThan(poisoned);
    expect(poisoned).toBeGreaterThan(basic);
  });

  it('makes the three Rare lines hard to keep even at Base', () => {
    // §9: "rarity should mean hard to keep, not merely hard to find."
    for (const id of ['cherubick', 'wickisp', 'roswyrm']) {
      expect(byId.get(id)!.catchRate).toBe(45);
    }
    const rare = captureProbability({
      maxHp: 100,
      currentHp: 10,
      catchRate: 45,
      talisman: 'basic',
      status: 'none',
    });
    const common = captureProbability({
      maxHp: 100,
      currentHp: 10,
      catchRate: 255,
      talisman: 'basic',
      status: 'none',
    });
    expect(rare).toBeLessThan(common);
  });

  it('reports shakes that stop at the first failed roll', () => {
    const rng = new Rng('shakes');
    for (let i = 0; i < 500; i++) {
      const r = attemptCapture(
        { maxHp: 100, currentHp: 40, catchRate: 120, talisman: 'basic', status: 'none' },
        rng,
      );
      expect(r.shakes).toBeGreaterThanOrEqual(0);
      expect(r.shakes).toBeLessThanOrEqual(4);
      expect(r.caught).toBe(r.shakes === 4);
    }
  });

  it('matches its own stated probability over many trials', () => {
    const input = { maxHp: 100, currentHp: 25, catchRate: 190, talisman: 'great' as const, status: 'sleep' as const };
    const expected = captureProbability(input);
    const rng = new Rng('capture-convergence');
    let caught = 0;
    const trials = 40_000;
    for (let i = 0; i < trials; i++) if (attemptCapture(input, rng).caught) caught++;
    expect(caught / trials).toBeCloseTo(expected, 1);
  });

  it('keeps the a term inside the formula\'s domain', () => {
    const a = captureA({ maxHp: 100, currentHp: 1, catchRate: 255, talisman: 'ultra', status: 'sleep' });
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(255);
    expect(captureB(a)).toBeGreaterThan(0);
  });

  it('lets a held chain improve the odds', () => {
    const base = {
      maxHp: 100,
      currentHp: 30,
      catchRate: 90,
      talisman: 'basic' as const,
      status: 'none' as const,
    };
    expect(captureProbability({ ...base, chainBonus: 1.5 })).toBeGreaterThan(captureProbability(base));
  });
});

describe('fleeing (§8)', () => {
  it('is more likely when faster and after repeated attempts', () => {
    expect(fleeChance(200, 100, 0)).toBeGreaterThan(fleeChance(50, 100, 0));
    expect(fleeChance(100, 100, 3)).toBeGreaterThan(fleeChance(100, 100, 0));
  });

  it('always escapes when the divisor degenerates to zero', () => {
    expect(fleeChance(100, 3, 0)).toBe(1); // floor(3/4) = 0
  });

  it('stays a probability', () => {
    for (let s = 1; s < 400; s += 7) {
      for (let t = 1; t < 400; t += 11) {
        const c = fleeChance(s, t, 2);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('money and obedience (§12, §13)', () => {
  it('scales prize money with level and sigils, and halves on blackout', () => {
    expect(prizeMoney(10, 20, 0)).toBeLessThan(prizeMoney(10, 20, 3));
    expect(blackoutLoss(101)).toBe(50);
  });

  it('uses the documented obedience ceilings', () => {
    expect(obedienceCeiling(0)).toBe(15);
    expect(obedienceCeiling(1)).toBe(25);
    expect(obedienceCeiling(2)).toBe(35);
    expect(obedienceCeiling(3)).toBe(42);
    expect(obedienceCeiling(6)).toBe(100);
  });

  it('only ever disobeys with traded spirits', () => {
    expect(willObey(40, 0, false)).toBe(true);
    expect(willObey(40, 0, true)).toBe(false);
    expect(willObey(40, 3, true)).toBe(true);
  });
});
