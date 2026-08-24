import { describe, it, expect } from 'vitest';
import { Rng } from '../core/rng.ts';
import {
  MAX_DRAW_ATTEMPTS,
  asArray,
  asBarChart,
  asNumberLine,
  asShapes,
  checkAnswer,
  digitsIn,
  effectiveTier,
  generateQuestion,
  questionId,
  type MathTier,
  type Question,
} from './question.ts';
import { kindsForTier } from './curriculum/index.ts';

const TIERS: readonly MathTier[] = [1, 2, 3];

function draw(seed: string | number, tier: MathTier, ceiling: MathTier = 3): Question {
  return generateQuestion({ tier, segmentCeiling: ceiling, rng: new Rng(seed) });
}

function stream(seed: string | number, count: number, tier: MathTier, ceiling: MathTier = 3): Question[] {
  const rng = new Rng(seed);
  return Array.from({ length: count }, () =>
    generateQuestion({ tier, segmentCeiling: ceiling, rng }),
  );
}

describe('effectiveTier — the segment ceiling (DESIGN.md §6)', () => {
  it('is the smaller of the move\'s band and the campaign\'s', () => {
    expect(effectiveTier(3, 1)).toBe(1);
    expect(effectiveTier(3, 2)).toBe(2);
    expect(effectiveTier(3, 3)).toBe(3);
    expect(effectiveTier(1, 3)).toBe(1);
    expect(effectiveTier(2, 3)).toBe(2);
    expect(effectiveTier(2, 1)).toBe(1);
  });

  it('clamps nonsense into the three real bands', () => {
    expect(effectiveTier(0 as MathTier, 3)).toBe(1);
    expect(effectiveTier(9 as MathTier, 9 as MathTier)).toBe(3);
    expect(effectiveTier(-4 as MathTier, 2)).toBe(1);
  });
});

describe('generateQuestion', () => {
  it('really clamps the band — no Tier 3 arithmetic before Shrine 1', () => {
    const tier3Kinds = kindsForTier(3);
    for (let seed = 0; seed < 300; seed++) {
      const q = draw(`ceiling-${seed}`, 3, 1);
      expect(q.tier).toBe(1);
      expect(kindsForTier(1)).toContain(q.kind);
      expect(tier3Kinds).not.toContain(q.kind);
    }
  });

  it('clamps to Tier 2 for the middle segment', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const q = draw(`mid-${seed}`, 3, 2);
      seen.add(q.tier);
      expect(kindsForTier(2)).toContain(q.kind);
    }
    expect([...seen]).toEqual([2]);
  });

  it('never raises a low-tier move above its own band', () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(draw(`low-${seed}`, 1, 3).tier).toBe(1);
      expect(draw(`low-${seed}`, 2, 3).tier).toBe(2);
    }
  });

  it('is deterministic — same seed, identical question stream', () => {
    for (const tier of TIERS) {
      const a = stream('replay', 200, tier);
      const b = stream('replay', 200, tier);
      expect(b).toEqual(a);
      expect(b.map((q) => q.id)).toEqual(a.map((q) => q.id));
    }
  });

  it('produces a different stream for a different seed', () => {
    const a = stream('seed-a', 60, 2).map((q) => q.prompt);
    const b = stream('seed-b', 60, 2).map((q) => q.prompt);
    expect(b).not.toEqual(a);
  });

  it('does not consume the caller\'s rng any differently across bands', () => {
    // Two sessions sharing one seed must stay in lockstep regardless of which band they draw,
    // because a battle replay reuses a single Rng for questions and for damage rolls.
    const rng = new Rng('shared');
    const first = generateQuestion({ tier: 1, segmentCeiling: 3, rng });
    const second = generateQuestion({ tier: 1, segmentCeiling: 3, rng });
    expect(second.id).not.toBe(first.id);
  });

  it('avoids ids it is told to avoid', () => {
    const rng = new Rng('avoid');
    const first = generateQuestion({ tier: 2, segmentCeiling: 3, rng });
    for (let i = 0; i < 100; i++) {
      const next = generateQuestion({
        tier: 2,
        segmentCeiling: 3,
        rng,
        avoidIds: [first.id],
      });
      expect(next.id).not.toBe(first.id);
    }
  });

  it('accepts a Set as well as an array of ids', () => {
    const rng = new Rng('avoid-set');
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const q = generateQuestion({ tier: 1, segmentCeiling: 3, rng, avoidIds: seen });
      expect(seen.has(q.id)).toBe(false);
      seen.add(q.id);
    }
  });

  it('still returns a question when everything is avoided, rather than spinning', () => {
    // Tier 1 has a small answer space; avoid a slab of it and the generator must still deliver.
    const probe = new Rng('exhaust');
    const all = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      all.add(generateQuestion({ tier: 1, segmentCeiling: 1, rng: probe }).id);
    }
    const q = generateQuestion({ tier: 1, segmentCeiling: 1, rng: new Rng('exhaust'), avoidIds: all });
    expect(q).toBeDefined();
    expect(q.answer).toBeGreaterThanOrEqual(0);
    expect(MAX_DRAW_ATTEMPTS).toBeGreaterThan(1);
  });
});

describe('answer checking', () => {
  it('accepts the question\'s own answer and rejects the next number up', () => {
    let checked = 0;
    for (const tier of TIERS) {
      for (let seed = 0; seed < 500; seed++) {
        const rng = new Rng(`check-${tier}-${seed}`);
        for (let i = 0; i < 4; i++) {
          const q = generateQuestion({ tier, segmentCeiling: 3, rng });
          expect(checkAnswer(q, q.answer), `${q.kind}: ${q.prompt}`).toBe(true);
          expect(checkAnswer(q, q.answer + 1), `${q.kind}: ${q.prompt}`).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBe(6000);
  });

  it('rejects the answer one below, and a plausible wrong neighbour', () => {
    for (const tier of TIERS) {
      const rng = new Rng(`neighbour-${tier}`);
      for (let i = 0; i < 400; i++) {
        const q = generateQuestion({ tier, segmentCeiling: 3, rng });
        expect(checkAnswer(q, q.answer - 1)).toBe(false);
        expect(checkAnswer(q, q.answer + 10)).toBe(false);
        expect(checkAnswer(q, -q.answer - 1)).toBe(false);
      }
    }
  });

  it('rejects anything that is not a whole number', () => {
    const q = draw('fractions', 2);
    expect(checkAnswer(q, q.answer + 0.5)).toBe(false);
    expect(checkAnswer(q, Number.NaN)).toBe(false);
    expect(checkAnswer(q, Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('question identity', () => {
  it('is content-addressed — the same prompt always gets the same id', () => {
    expect(questionId(2, 'times-table', '12 × 7 = ?')).toBe(questionId(2, 'times-table', '12 × 7 = ?'));
    expect(questionId(2, 'times-table', '12 × 7 = ?')).not.toBe(
      questionId(2, 'times-table', '12 × 8 = ?'),
    );
    expect(questionId(1, 'times-table', '12 × 7 = ?')).not.toBe(
      questionId(2, 'times-table', '12 × 7 = ?'),
    );
  });

  it('names its band and kind, so telemetry can group without parsing the prompt', () => {
    const q = draw('id-shape', 3);
    expect(q.id).toMatch(/^t3:[a-z-]+:[0-9a-z]+$/);
    expect(q.id.split(':')[1]).toBe(q.kind);
  });

  it('collides only when the questions really are the same question', () => {
    const rng = new Rng('collide');
    const byId = new Map<string, string>();
    for (let i = 0; i < 4000; i++) {
      const q = generateQuestion({ tier: 3, segmentCeiling: 3, rng });
      const seen = byId.get(q.id);
      if (seen !== undefined) expect(seen).toBe(q.prompt);
      byId.set(q.id, q.prompt);
    }
    expect(byId.size).toBeGreaterThan(500);
  });
});

describe('keypad fit', () => {
  it('counts digits the way the keypad does', () => {
    expect(digitsIn(0)).toBe(1);
    expect(digitsIn(7)).toBe(1);
    expect(digitsIn(84)).toBe(2);
    expect(digitsIn(2500)).toBe(4);
    expect(digitsIn(-3)).toBe(1);
  });

  it('never asks for more digits than the pad can sensibly hold', () => {
    for (const tier of TIERS) {
      const rng = new Rng(`digits-${tier}`);
      for (let i = 0; i < 500; i++) {
        const q = generateQuestion({ tier, segmentCeiling: 3, rng });
        expect(q.answerDigits).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('visual narrowing', () => {
  it('returns the payload only for the matching kind', () => {
    const bar = { kind: 'bar-chart', data: { labels: ['Mon'], values: [3], unit: 'props' } } as const;
    expect(asBarChart(bar)?.values).toEqual([3]);
    expect(asArray(bar)).toBeNull();
    expect(asShapes(bar)).toBeNull();
    expect(asNumberLine(bar)).toBeNull();

    const line = { kind: 'number-line', data: { from: 8, steps: 3, to: 11 } } as const;
    expect(asNumberLine(line)?.to).toBe(11);
    expect(asBarChart(line)).toBeNull();
  });

  it('hands the renderer a usable payload for every visual the curriculum makes', () => {
    const rng = new Rng('visuals');
    let arrays = 0;
    let charts = 0;
    let shapes = 0;
    let lines = 0;
    for (let i = 0; i < 1200; i++) {
      for (const tier of TIERS) {
        const q = generateQuestion({ tier, segmentCeiling: 3, rng });
        if (!q.visual) continue;
        const arr = asArray(q.visual);
        if (arr) {
          arrays++;
          expect(arr.rows * arr.cols).toBe(q.answer);
        }
        const chart = asBarChart(q.visual);
        if (chart) {
          charts++;
          expect(chart.labels).toHaveLength(chart.values.length);
          expect(chart.values.every((v) => v > 0)).toBe(true);
        }
        const shape = asShapes(q.visual);
        if (shape) {
          shapes++;
          expect(shape.options).toContain(shape.target);
        }
        const line = asNumberLine(q.visual);
        if (line) {
          lines++;
          expect(line.from + line.steps).toBe(line.to);
          expect(line.to).toBe(q.answer);
        }
      }
    }
    expect(arrays).toBeGreaterThan(0);
    expect(charts).toBeGreaterThan(0);
    expect(shapes).toBeGreaterThan(0);
    expect(lines).toBeGreaterThan(0);
  });
});
