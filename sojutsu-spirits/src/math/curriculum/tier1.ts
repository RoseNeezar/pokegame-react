/**
 * Tier 1 — the first band. DESIGN.md §6.
 *
 * Sourced from the manga: p03 (the Fibonacci step Ay is drilled on), p13 (the waystones, counted
 * on along a line), p32 ("five spirits, two seals"). Content is number bonds, single-digit `+ −`,
 * doubles, counting on, and sequence completion — nothing that needs written working, because
 * this is the band a player answers while a timer bar drains and a spirit is mid-lunge.
 *
 * Every template here keeps its answer under three digits and its prompt short enough to read at
 * a glance; the band is a rhythm test, and a long prompt is a different game.
 */
import type { Rng } from '../../core/rng.ts';
import type { QuestionDraft, QuestionTemplate } from '../question.ts';
import { OP, sequencePrompt } from './shared.ts';

/** `6 + ? = 10`. The bond is to ten or twenty — the two the manga's mentors drill. */
function numberBond(rng: Rng): QuestionDraft {
  const total = rng.pick([10, 20]);
  const known = rng.int(1, total - 1);
  const answer = total - known;
  return {
    kind: 'number-bond',
    prompt: `${known} ${OP.plus} ? = ${total}`,
    answer,
    explain: `${known} and ${answer} make ${total}. ${total} ${OP.minus} ${known} = ${answer}.`,
  };
}

/** Single-digit addition, with bridging-through-ten shown whenever the sum crosses. */
function addSingle(rng: Rng): QuestionDraft {
  const a = rng.int(1, 9);
  const b = rng.int(1, 9);
  const answer = a + b;
  const toTen = 10 - a;
  const explain =
    answer > 10
      ? `${a} ${OP.plus} ${b} = ${a} ${OP.plus} ${toTen} ${OP.plus} ${b - toTen} = 10 ${OP.plus} ${b - toTen} = ${answer}.`
      : `Count on ${b} from ${a}: ${answer}.`;
  return { kind: 'add-single', prompt: `${a} ${OP.plus} ${b} = ?`, answer, explain };
}

/** Subtraction with a single-digit answer. Bridges back through ten when the start is past it. */
function subSingle(rng: Rng): QuestionDraft {
  const b = rng.int(1, 9);
  const answer = rng.int(0, 9);
  const a = answer + b;
  const explain =
    a > 10
      ? `${a} ${OP.minus} ${b} = ${a} ${OP.minus} ${a - 10} ${OP.minus} ${b - (a - 10)} = 10 ${OP.minus} ${b - (a - 10)} = ${answer}.`
      : `Count back ${b} from ${a}: ${answer}.`;
  return { kind: 'sub-single', prompt: `${a} ${OP.minus} ${b} = ?`, answer, explain };
}

/** `Double 7 = ?`. Doubles are recall, not calculation — the working says so. */
function doubles(rng: Rng): QuestionDraft {
  const n = rng.int(1, 10);
  return {
    kind: 'doubles',
    prompt: `Double ${n} = ?`,
    answer: n * 2,
    explain: `${n} ${OP.plus} ${n} = ${n * 2}.`,
  };
}

/**
 * Counting on along a line — the p13 waystones.
 *
 * Carries a `number-line` visual so the renderer can draw the steps rather than only print
 * them; the whole point of this template is that the player sees the hops.
 */
function countingOn(rng: Rng): QuestionDraft {
  const from = rng.int(5, 19);
  const steps = rng.int(2, 5);
  const answer = from + steps;
  const hops = Array.from({ length: steps }, (_, i) => from + i + 1).join(', ');
  return {
    kind: 'counting-on',
    prompt: `Count on ${steps} from ${from} = ?`,
    answer,
    explain: `${from} → ${hops}. ${steps} on from ${from} is ${answer}.`,
    visual: { kind: 'number-line', data: { from, steps, to: answer } },
  };
}

/** `2, 4, 6, ?` — a constant step, up or down. Down never crosses zero. */
function sequenceStep(rng: Rng): QuestionDraft {
  const step = rng.int(1, 5);
  const ascending = rng.chance(0.7);
  const start = ascending ? rng.int(0, 9) : rng.int(step * 3, step * 3 + 12);
  const delta = ascending ? step : -step;
  const last = start + delta * 2;
  const terms: readonly number[] = [start, start + delta, last];
  const answer = start + delta * 3;
  const direction = ascending ? 'adds' : 'takes away';
  return {
    kind: 'sequence-step',
    prompt: sequencePrompt(terms),
    answer,
    explain: `Each step ${direction} ${step}. ${last} ${ascending ? OP.plus : OP.minus} ${step} = ${answer}.`,
  };
}

/** `3, 5, 8, ?` — the p03 rule: add the two before it. */
function sequenceFib(rng: Rng): QuestionDraft {
  const a = rng.int(1, 5);
  const b = rng.int(2, 6);
  const c = a + b;
  const answer = b + c;
  return {
    kind: 'sequence-fib',
    prompt: sequencePrompt([a, b, c]),
    answer,
    explain: `Add the two before it: ${b} ${OP.plus} ${c} = ${answer}.`,
  };
}

export const TIER1_TEMPLATES: readonly QuestionTemplate[] = [
  { kind: 'number-bond', weight: 3, make: numberBond },
  { kind: 'add-single', weight: 4, make: addSingle },
  { kind: 'sub-single', weight: 4, make: subSingle },
  { kind: 'doubles', weight: 2, make: doubles },
  { kind: 'counting-on', weight: 2, make: countingOn },
  { kind: 'sequence-step', weight: 3, make: sequenceStep },
  { kind: 'sequence-fib', weight: 2, make: sequenceFib },
];
