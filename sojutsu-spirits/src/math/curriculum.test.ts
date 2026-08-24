import { describe, it, expect } from 'vitest';
import { Rng } from '../core/rng.ts';
import { ALL_TEMPLATES, TEMPLATES_BY_TIER, kindsForTier } from './curriculum/index.ts';
import {
  MAX_PROMPT_CHARS,
  asShapes,
  digitsIn,
  generateQuestion,
  type MathTier,
  type Question,
} from './question.ts';

/**
 * The curriculum's contract, checked the hard way.
 *
 * Every verifier below re-derives the answer from the *prompt text* — the same characters the
 * player reads on the equation strip — using an independent implementation that never touches
 * the generator. A template that prints one sum and answers a different one fails here, and so
 * does a template that quietly drops a number out of its prompt.
 *
 * Two kinds cannot be re-derived from text alone: `solid-identify` is answered from its visual
 * (that is what makes it multiple choice) and `solid-count` is answered from a table of solids
 * duplicated below on purpose, so the test does not import the data it is checking.
 */
type Verifier = (q: Question) => number;

const TIERS: readonly MathTier[] = [1, 2, 3];

/* --------------------------------------------------------------- parse helpers */

function match(prompt: string, re: RegExp): RegExpMatchArray {
  const m = prompt.match(re);
  if (!m) throw new Error(`prompt did not parse: ${JSON.stringify(prompt)} against ${re}`);
  return m;
}

/** `m[i]` as a number, with the index asserted rather than assumed. */
function num(m: RegExpMatchArray, index: number): number {
  const raw = m[index];
  if (raw === undefined) throw new Error(`capture ${index} missing in ${JSON.stringify(m[0])}`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`capture ${index} is not a number: ${raw}`);
  return value;
}

function text(m: RegExpMatchArray, index: number): string {
  const raw = m[index];
  if (raw === undefined) throw new Error(`capture ${index} missing in ${JSON.stringify(m[0])}`);
  return raw;
}

/** `2, 4, 6, ?` → `[2, 4, 6]`. */
function sequenceTerms(prompt: string): number[] {
  const m = match(prompt, /^([\d, ]+), \?$/);
  return text(m, 1)
    .split(', ')
    .map((t) => Number(t));
}

/** `Mon 4, Tue 7, Wed 5` → `[['Mon', 4], ['Tue', 7], ['Wed', 5]]`. */
function barListing(listing: string, numbered: boolean): [string, number][] {
  return listing.split(', ').map((entry) => {
    const parts = entry.split(' ');
    const label = numbered ? parts[1] : parts[0];
    const value = numbered ? parts[2] : parts[1];
    if (label === undefined || value === undefined) throw new Error(`bad bar entry: ${entry}`);
    return [label, Number(value)];
  });
}

const DENOM_FOR_WORD: Readonly<Record<string, number>> = {
  halves: 2,
  thirds: 3,
  quarters: 4,
  fifths: 5,
  sixths: 6,
  eighths: 8,
  ninths: 9,
  tenths: 10,
  twelfths: 12,
  fifteenths: 15,
  sixteenths: 16,
  twentieths: 20,
};

const CONVERSION_FACTORS: Readonly<Record<string, number>> = {
  'kg->g': 1000,
  'km->m': 1000,
  'L->ml': 1000,
  'm->cm': 100,
};

/** An independent copy of the solid table. If the two disagree, one of them is wrong. */
const SOLID_TABLE: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  cube: { faces: 6, edges: 12, vertices: 8 },
  cuboid: { faces: 6, edges: 12, vertices: 8 },
  'square pyramid': { faces: 5, edges: 8, vertices: 5 },
  'triangular prism': { faces: 5, edges: 9, vertices: 6 },
  'triangular pyramid': { faces: 4, edges: 6, vertices: 4 },
};

/* ------------------------------------------------------------------ verifiers */

const VERIFIERS: Readonly<Record<string, Verifier>> = {
  /* --- tier 1 --- */
  'number-bond': (q) => {
    const m = match(q.prompt, /^(\d+) \+ \? = (\d+)$/);
    return num(m, 2) - num(m, 1);
  },
  'add-single': (q) => {
    const m = match(q.prompt, /^(\d) \+ (\d) = \?$/);
    return num(m, 1) + num(m, 2);
  },
  'sub-single': (q) => {
    const m = match(q.prompt, /^(\d+) − (\d) = \?$/);
    return num(m, 1) - num(m, 2);
  },
  doubles: (q) => 2 * num(match(q.prompt, /^Double (\d+) = \?$/), 1),
  'counting-on': (q) => {
    const m = match(q.prompt, /^Count on (\d+) from (\d+) = \?$/);
    return num(m, 2) + num(m, 1);
  },
  'sequence-step': (q) => {
    const terms = sequenceTerms(q.prompt);
    expect(terms).toHaveLength(3);
    const [a, b, c] = terms as [number, number, number];
    expect(b - a).toBe(c - b);
    return c + (c - b);
  },
  'sequence-fib': (q) => {
    const terms = sequenceTerms(q.prompt);
    expect(terms).toHaveLength(3);
    const [a, b, c] = terms as [number, number, number];
    expect(a + b).toBe(c);
    return b + c;
  },

  /* --- tier 2 --- */
  'times-table': (q) => {
    const m = match(q.prompt, /^(\d+) × (\d+) = \?$/);
    return num(m, 1) * num(m, 2);
  },
  'division-remainder': (q) => {
    const m = match(q.prompt, /^(\d+) ÷ (\d+) → (each|left over) = \?$/);
    const total = num(m, 1);
    const divisor = num(m, 2);
    return text(m, 3) === 'each' ? Math.floor(total / divisor) : total % divisor;
  },
  'place-value': (q) => {
    const m = match(q.prompt, /^The (\d) in (\d+) is worth \?$/);
    const digit = text(m, 1);
    const number = text(m, 2);
    // Ambiguity check: "the 5 in 455" would have two answers.
    expect(number.split(digit)).toHaveLength(2);
    const index = number.indexOf(digit);
    return Number(digit) * 10 ** (number.length - 1 - index);
  },
  halving: (q) => num(match(q.prompt, /^Half of (\d+) = \?$/), 1) / 2,
  doubling: (q) => 2 * num(match(q.prompt, /^Double (\d+) = \?$/), 1),
  'two-step': (q) => {
    const m = match(q.prompt, /^(\d+) × (\d+) \+ (\d+) = \?$/);
    return num(m, 1) * num(m, 2) + num(m, 3);
  },
  'equivalent-fraction': (q) => {
    const m = match(q.prompt, /^(\d+)\/(\d+) = \? ([a-z]+)$/);
    const denominator = DENOM_FOR_WORD[text(m, 3)];
    expect(denominator).toBeDefined();
    const k = denominator! / num(m, 2);
    expect(Number.isInteger(k)).toBe(true);
    return num(m, 1) * k;
  },

  /* --- tier 3 --- */
  'multi-digit-add': (q) => {
    const m = match(q.prompt, /^(\d+) \+ (\d+) = \?$/);
    return num(m, 1) + num(m, 2);
  },
  'multi-digit-sub': (q) => {
    const m = match(q.prompt, /^(\d+) − (\d+) = \?$/);
    return num(m, 1) - num(m, 2);
  },
  'multi-step': (q) => {
    const m = match(q.prompt, /^(\d+) × (\d+) ([+−]) (\d+) = \?$/);
    const product = num(m, 1) * num(m, 2);
    return text(m, 3) === '+' ? product + num(m, 4) : product - num(m, 4);
  },
  tenths: (q) => {
    const m = match(q.prompt, /^Tenths in (\d)\.(\d) = \?$/);
    return num(m, 1) * 10 + num(m, 2);
  },
  'decimal-add': (q) => {
    const m = match(q.prompt, /^(\d)\.(\d) \+ (\d)\.(\d) = \? tenths$/);
    return num(m, 1) * 10 + num(m, 2) + (num(m, 3) * 10 + num(m, 4));
  },
  'measurement-convert': (q) => {
    const m = match(q.prompt, /^(\d)\.(\d) (\S+) = \? (\S+)$/);
    const factor = CONVERSION_FACTORS[`${text(m, 3)}->${text(m, 4)}`];
    expect(factor).toBeDefined();
    return ((num(m, 1) * 10 + num(m, 2)) * factor!) / 10;
  },
  'measurement-time': (q) => {
    const m = match(q.prompt, /^(\d+) (min|h) (\d+) (s|min) = \? (s|min)$/);
    expect(text(m, 4)).toBe(text(m, 5));
    return num(m, 1) * 60 + num(m, 3);
  },
  'clock-interval': (q) => {
    const m = match(q.prompt, /^(\d\d):(\d\d) → (\d\d):(\d\d) = \? min$/);
    return num(m, 3) * 60 + num(m, 4) - (num(m, 1) * 60 + num(m, 2));
  },
  'bar-chart': (q) => {
    if (q.prompt.endsWith('→ most = ?')) {
      const bars = barListing(text(match(q.prompt, /^(.+) → most = \?$/), 1), true);
      let best = 0;
      bars.forEach((bar, i) => {
        if (bar[1] > bars[best]![1]) best = i;
      });
      // A tallest-bar question with a tie has no single answer.
      expect(bars.filter((b) => b[1] === bars[best]![1])).toHaveLength(1);
      return best + 1;
    }
    if (q.prompt.endsWith('→ total = ?')) {
      const bars = barListing(text(match(q.prompt, /^(.+) → total = \?$/), 1), false);
      return bars.reduce((total, bar) => total + bar[1], 0);
    }
    const m = match(q.prompt, /^(.+) → (\w+) − (\w+) = \?$/);
    const bars = new Map(barListing(text(m, 1), false));
    const hi = bars.get(text(m, 2));
    const lo = bars.get(text(m, 3));
    expect(hi).toBeDefined();
    expect(lo).toBeDefined();
    return hi! - lo!;
  },
  'solid-identify': (q) => {
    const m = match(q.prompt, /^Which is the (.+)\? \(1-(\d)\)$/);
    const target = text(m, 1);
    expect(q.visual).toBeDefined();
    const shapes = asShapes(q.visual!);
    expect(shapes).not.toBeNull();
    expect(shapes!.options).toHaveLength(num(m, 2));
    expect(shapes!.target).toBe(target);
    // Exactly one option is the target, so the numbered choice is unambiguous.
    expect(shapes!.options.filter((o) => o === target)).toHaveLength(1);
    return shapes!.options.indexOf(target) + 1;
  },
  'solid-count': (q) => {
    const m = match(q.prompt, /^(Faces|Edges|Vertices) on a (.+) = \?$/);
    const solid = SOLID_TABLE[text(m, 2)];
    expect(solid).toBeDefined();
    const count = solid![text(m, 1).toLowerCase()];
    expect(count).toBeDefined();
    return count!;
  },
  'sequence-extend': (q) => {
    const terms = sequenceTerms(q.prompt);
    expect(terms).toHaveLength(4);
    const [a, b, c, d] = terms as [number, number, number, number];
    if (b - a === c - b && c - b === d - c) return d + (d - c); // constant step
    if (b === a * 2 && c === b * 2 && d === c * 2) return d * 2; // doubling
    if (b === a * 3 && c === b * 3 && d === c * 3) return d * 3; // trebling
    // Growing step: +k, +(k+1), +(k+2) → next is +(k+3).
    expect(c - b).toBe(b - a + 1);
    expect(d - c).toBe(c - b + 1);
    return d + (d - c) + 1;
  },
};

/* ---------------------------------------------------------------- the sweep */

const SWEEP_SEEDS = 400;
const DRAWS_PER_SEED = 12;

function sweep(tier: MathTier, visit: (q: Question) => void): void {
  for (let seed = 0; seed < SWEEP_SEEDS; seed++) {
    const rng = new Rng(`curriculum-${tier}-${seed}`);
    for (let i = 0; i < DRAWS_PER_SEED; i++) {
      visit(generateQuestion({ tier, segmentCeiling: 3, rng }));
    }
  }
}

describe('curriculum structure', () => {
  it('has a template for every band, and the bands DESIGN.md §6 lists', () => {
    expect(kindsForTier(1)).toEqual([
      'number-bond',
      'add-single',
      'sub-single',
      'doubles',
      'counting-on',
      'sequence-step',
      'sequence-fib',
    ]);
    expect(kindsForTier(2)).toEqual([
      'times-table',
      'division-remainder',
      'place-value',
      'halving',
      'doubling',
      'two-step',
      'equivalent-fraction',
    ]);
    expect(kindsForTier(3)).toEqual([
      'multi-digit-add',
      'multi-digit-sub',
      'multi-step',
      'tenths',
      'decimal-add',
      'measurement-convert',
      'measurement-time',
      'clock-interval',
      'bar-chart',
      'solid-identify',
      'solid-count',
      'sequence-extend',
    ]);
  });

  it('gives every kind a unique name and a positive weight', () => {
    const kinds = ALL_TEMPLATES.map((t) => t.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const template of ALL_TEMPLATES) expect(template.weight).toBeGreaterThan(0);
  });

  it('has a verifier for every kind the curriculum can produce', () => {
    for (const template of ALL_TEMPLATES) {
      expect(VERIFIERS[template.kind], `no verifier for ${template.kind}`).toBeDefined();
    }
    expect(Object.keys(VERIFIERS).sort()).toEqual(ALL_TEMPLATES.map((t) => t.kind).sort());
  });
});

describe.each(TIERS)('tier %i questions', (tier) => {
  it('only ever produces answers the keypad can type', () => {
    sweep(tier, (q) => {
      expect(Number.isInteger(q.answer), `${q.kind}: ${q.prompt} → ${q.answer}`).toBe(true);
      expect(q.answer, `${q.kind}: ${q.prompt}`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(q.answer)).toBe(true);
    });
  });

  it('always shows the working', () => {
    sweep(tier, (q) => {
      expect(q.explain.length, `${q.kind} explained nothing`).toBeGreaterThan(0);
      expect(q.explain.trim()).toBe(q.explain);
      // The working has to contain the answer — that is the whole point of showing it.
      expect(q.explain, `${q.kind}: ${q.explain}`).toContain(String(q.answer));
    });
  });

  it('asks about the numbers it prints — every kind re-derived from its own prompt', () => {
    sweep(tier, (q) => {
      const verify = VERIFIERS[q.kind];
      expect(verify, `no verifier for ${q.kind}`).toBeDefined();
      expect(verify!(q), `${q.kind}: ${q.prompt}`).toBe(q.answer);
    });
  });

  it('prints a prompt that fits the equation strip', () => {
    sweep(tier, (q) => {
      expect(q.prompt.length, `too long: ${q.prompt}`).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(q.prompt.trim()).toBe(q.prompt);
      expect(q.prompt).toContain('?');
    });
  });

  /**
   * Every prompt prints the numbers it asks about, with one deliberate exception: `solid-count`
   * asks how many edges a named solid has, and the whole question is that you know the solid
   * rather than that you read a number off the strip. The exception is pinned to that one kind
   * so a future template cannot quietly join it.
   */
  it('prints the numbers it asks about', () => {
    const digitless = new Set<string>();
    sweep(tier, (q) => {
      if (!/\d/.test(q.prompt)) digitless.add(q.kind);
    });
    expect([...digitless]).toEqual(tier === 3 ? ['solid-count'] : []);
  });

  it('sizes the keypad entry to the answer', () => {
    sweep(tier, (q) => {
      expect(q.answerDigits).toBeGreaterThan(0);
      if (q.choices) {
        expect(q.choices).toContain(q.answer);
        expect(q.answerDigits).toBe(digitsIn(Math.max(...q.choices)));
      } else {
        expect(q.answerDigits).toBe(String(q.answer).length);
      }
    });
  });

  it('tags itself with its own band', () => {
    sweep(tier, (q) => {
      expect(q.tier).toBe(tier);
      expect(kindsForTier(tier)).toContain(q.kind);
      expect(q.id.startsWith(`t${tier}:${q.kind}:`)).toBe(true);
    });
  });

  it('reaches every kind in the band', () => {
    const seen = new Set<string>();
    sweep(tier, (q) => seen.add(q.kind));
    expect([...seen].sort()).toEqual([...kindsForTier(tier)].sort());
  });
});

describe('multiple-choice questions', () => {
  it('are exactly the two kinds that cannot be answered with a computed number', () => {
    const withChoices = new Set<string>();
    for (const tier of TIERS) sweep(tier, (q) => q.choices && withChoices.add(q.kind));
    expect([...withChoices].sort()).toEqual(['bar-chart', 'solid-identify']);
  });

  it('number their options from 1 with no gaps', () => {
    sweep(3, (q) => {
      if (!q.choices) return;
      expect(q.choices).toEqual(q.choices.map((_, i) => i + 1));
      expect(q.answer).toBeGreaterThanOrEqual(1);
      expect(q.answer).toBeLessThanOrEqual(q.choices.length);
    });
  });
});

describe('visuals', () => {
  it('only attach payloads that match their declared kind', () => {
    const seen = new Set<string>();
    for (const tier of TIERS) {
      sweep(tier, (q) => {
        if (!q.visual) return;
        seen.add(q.visual.kind);
        expect(['bar-chart', 'array', 'shapes', 'number-line']).toContain(q.visual.kind);
        expect(q.visual.data).toBeTypeOf('object');
      });
    }
    expect([...seen].sort()).toEqual(['array', 'bar-chart', 'number-line', 'shapes']);
  });
});

/**
 * The per-kind verifiers above check each template against its own rule, which is exactly the
 * blind spot these two tests cover: a prompt can satisfy one template's rule *and another's*,
 * and each verifier would happily call its own answer correct. The player, who sees only the
 * prompt, would then be marked wrong for reasoning correctly.
 */
describe('no prompt has two right answers', () => {
  /**
   * `solid-identify` is the one kind whose answer is not a function of its prompt: the answer is
   * which drawn shape is the cone, so the same prompt over a different shuffle answers 2 or 4.
   * That is inherent to the question and documented on the template; it is pinned here by name so
   * a future template cannot quietly join it.
   */
  const ANSWER_LIVES_IN_THE_PICTURE = new Set(['solid-identify']);

  it('never prints the same prompt with two different answers', () => {
    const byPrompt = new Map<string, { answer: number; kind: string }>();
    const offenders: string[] = [];
    let compared = 0;

    for (const tier of TIERS) {
      sweep(tier, (q) => {
        if (ANSWER_LIVES_IN_THE_PICTURE.has(q.kind)) return;
        const seen = byPrompt.get(q.prompt);
        if (!seen) {
          byPrompt.set(q.prompt, { answer: q.answer, kind: q.kind });
          return;
        }
        compared++;
        if (seen.answer !== q.answer) {
          offenders.push(`"${q.prompt}" → ${seen.answer} (${seen.kind}) and ${q.answer} (${q.kind})`);
        }
      });
    }

    expect(compared).toBeGreaterThan(1000); // the check has to actually be comparing things
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('leaves every sequence with exactly one rule the curriculum teaches', () => {
    let checked = 0;
    const ambiguous: string[] = [];

    for (const tier of TIERS) {
      sweep(tier, (q) => {
        if (!q.kind.startsWith('sequence')) return;
        const t = sequenceTerms(q.prompt);
        const last = t[t.length - 1]!;
        const rules = new Map<string, number>();

        const d = t[1]! - t[0]!;
        if (t.every((v, i) => i === 0 || v - t[i - 1]! === d)) rules.set('constant step', last + d);
        if (t.every((v, i) => i < 2 || v === t[i - 1]! + t[i - 2]!)) {
          rules.set('add the two before', last + t[t.length - 2]!);
        }
        const ratio = t[0]! === 0 ? 0 : t[1]! / t[0]!;
        if (ratio > 1 && Number.isInteger(ratio) && t.every((v, i) => i === 0 || v === t[i - 1]! * ratio)) {
          rules.set('geometric', last * ratio);
        }
        if (t.length >= 4) {
          const diffs = t.slice(1).map((v, i) => v - t[i]!);
          if (diffs.every((v, i) => i === 0 || v === diffs[i - 1]! + 1)) {
            rules.set('growing step', last + diffs[diffs.length - 1]! + 1);
          }
        }

        checked++;
        expect(rules.size, `${q.kind} follows no rule: ${q.prompt}`).toBeGreaterThan(0);
        if (new Set(rules.values()).size > 1) {
          ambiguous.push(
            `${q.prompt} — ${[...rules].map(([r, v]) => `${r} → ${v}`).join(', ')} (answers ${q.answer})`,
          );
        }
        expect([...rules.values()]).toContain(q.answer);
      });
    }

    expect(checked).toBeGreaterThan(500);
    expect([...new Set(ambiguous)]).toEqual([]);
  });
});

describe('templates in isolation', () => {
  it('are deterministic — the same seed makes the same question, every time', () => {
    for (const template of ALL_TEMPLATES) {
      for (let seed = 0; seed < 20; seed++) {
        const a = template.make(new Rng(`iso-${template.kind}-${seed}`));
        const b = template.make(new Rng(`iso-${template.kind}-${seed}`));
        expect(b).toEqual(a);
      }
    }
  });

  it('produce more than one distinct question per kind', () => {
    for (const template of ALL_TEMPLATES) {
      const prompts = new Set<string>();
      const rng = new Rng(`variety-${template.kind}`);
      for (let i = 0; i < 60; i++) prompts.add(template.make(rng).prompt);
      expect(prompts.size, `${template.kind} barely varies`).toBeGreaterThan(5);
    }
  });

  it('declare the kind they actually produce', () => {
    for (const bandTier of TIERS) {
      for (const template of TEMPLATES_BY_TIER[bandTier]) {
        const rng = new Rng(`kind-${template.kind}`);
        for (let i = 0; i < 20; i++) expect(template.make(rng).kind).toBe(template.kind);
      }
    }
  });
});
