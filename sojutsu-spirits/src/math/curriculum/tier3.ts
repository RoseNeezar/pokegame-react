/**
 * Tier 3 — the ceiling band. DESIGN.md §6.
 *
 * Sourced from the manga: p29 (`156 + 78`), p43 (`12 × 3 − 6`), p51 (the bar chart), p21 (the
 * solids), p28 (measurement). This is the band gated behind Shrine 1 by `segmentCeiling`, and
 * it is the only band that asks a question with a picture attached.
 *
 * Two constraints shape every template here:
 *
 * 1. **The keypad has no minus key and no decimal point.** Subtractions are ordered so the
 *    answer cannot go negative, and every decimal question is phrased as a *count* — tenths,
 *    grams, millilitres, minutes — so the thing typed is a whole number. This is not a
 *    simplification of the curriculum; converting "3.4 kg" into "34 hundred-gram weights" is
 *    the decimal understanding being tested.
 * 2. **A question must survive without its picture — with one honest exception.** The bar-chart
 *    prompts print their own data, numbered where the reading needs numbering, so the equation
 *    strip is answerable on its own and the picture is an enrichment. `solid-identify` is the
 *    exception and cannot be anything else: its answer is *which drawn shape*, so the picture is
 *    the question and the strip only names the target. Numbering the option names in the prompt
 *    would make the picture decorative and turn shape recognition into text matching, which is
 *    not the skill p21 is about. Two consequences follow, and both are pinned by tests: the
 *    renderer must draw the `shapes` visual for this kind, and two `solid-identify` questions can
 *    share a prompt (and therefore an id — see `questionId`) while having different answers.
 */
import type { Rng } from '../../core/rng.ts';
import type { QuestionDraft, QuestionTemplate } from '../question.ts';
import {
  CHART_SUBJECTS,
  DAY_LABELS,
  OP,
  POLYHEDRON_COUNTS,
  SOLIDS,
  UNIT_CONVERSIONS,
  pad2,
  sequencePrompt,
  sum,
  tenthsToDecimal,
  type SolidCountKey,
} from './shared.ts';

/** `156 + 78 = ?` — p29, verbatim in range. Working partitions the second number. */
function multiDigitAdd(rng: Rng): QuestionDraft {
  const a = rng.int(101, 499);
  const b = rng.int(21, 199);
  const bTens = Math.floor(b / 10) * 10;
  const bOnes = b % 10;
  const mid = a + bTens;
  return {
    kind: 'multi-digit-add',
    prompt: `${a} ${OP.plus} ${b} = ?`,
    answer: a + b,
    explain: `${a} ${OP.plus} ${b} = ${a} ${OP.plus} ${bTens} ${OP.plus} ${bOnes} = ${mid} ${OP.plus} ${bOnes} = ${a + b}.`,
  };
}

/** `231 − 87 = ?`. The larger number always leads, so the answer is never negative. */
function multiDigitSub(rng: Rng): QuestionDraft {
  const a = rng.int(120, 599);
  const b = rng.int(21, a - 1);
  const bTens = Math.floor(b / 10) * 10;
  const bOnes = b % 10;
  const mid = a - bTens;
  return {
    kind: 'multi-digit-sub',
    prompt: `${a} ${OP.minus} ${b} = ?`,
    answer: a - b,
    explain: `${a} ${OP.minus} ${b} = ${a} ${OP.minus} ${bTens} ${OP.minus} ${bOnes} = ${mid} ${OP.minus} ${bOnes} = ${a - b}.`,
  };
}

/** `12 × 3 − 6 = ?` — p43. The subtracted term never exceeds the product. */
function multiStep(rng: Rng): QuestionDraft {
  const a = rng.int(3, 12);
  const b = rng.int(2, 9);
  const product = a * b;
  const subtract = rng.chance(0.6);
  const c = subtract ? rng.int(1, product) : rng.int(1, 40);
  const answer = subtract ? product - c : product + c;
  const op = subtract ? OP.minus : OP.plus;
  return {
    kind: 'multi-step',
    prompt: `${a} ${OP.times} ${b} ${op} ${c} = ?`,
    answer,
    explain: `${a} ${OP.times} ${b} = ${product} first, then ${product} ${op} ${c} = ${answer}. Multiply before you ${subtract ? 'subtract' : 'add'}.`,
  };
}

/** `Tenths in 4.6 = ?` — the decimal read as a count of tenths. */
function tenths(rng: Rng): QuestionDraft {
  const whole = rng.int(1, 9);
  const part = rng.int(1, 9);
  const answer = whole * 10 + part;
  const wholes = whole === 1 ? 'whole' : 'wholes';
  return {
    kind: 'tenths',
    prompt: `Tenths in ${whole}.${part} = ?`,
    answer,
    explain: `${whole}.${part} is ${whole} ${wholes} and ${part} tenths. ${whole} ${wholes} = ${whole * 10} tenths, so ${whole * 10} ${OP.plus} ${part} = ${answer} tenths.`,
  };
}

/** `0.4 + 0.3 = ? tenths`. Adding decimals, answered in the unit the keypad can type. */
function decimalAdd(rng: Rng): QuestionDraft {
  const a = rng.int(1, 9);
  const b = rng.int(1, 9);
  const answer = a + b;
  return {
    kind: 'decimal-add',
    prompt: `${tenthsToDecimal(a)} ${OP.plus} ${tenthsToDecimal(b)} = ? tenths`,
    answer,
    explain: `${tenthsToDecimal(a)} is ${a} tenths and ${tenthsToDecimal(b)} is ${b} tenths. ${a} ${OP.plus} ${b} = ${answer} tenths, which is ${tenthsToDecimal(answer)}.`,
  };
}

/** `2.5 kg = ? g` — p28. Mass, length and capacity, always to the smaller unit. */
function measurementConvert(rng: Rng): QuestionDraft {
  const unit = rng.pick(UNIT_CONVERSIONS);
  const whole = rng.int(1, 9);
  const part = rng.int(0, 9);
  const value = `${whole}.${part}`;
  const answer = (whole * 10 + part) * (unit.factor / 10);
  return {
    kind: 'measurement-convert',
    prompt: `${value} ${unit.from} = ? ${unit.to}`,
    answer,
    explain: `1 ${unit.from} = ${unit.factor} ${unit.to}. ${value} ${OP.times} ${unit.factor} = ${answer} ${unit.to}.`,
  };
}

/** `3 min 40 s = ? s`, and the hours-to-minutes twin. Time does not run in tens. */
function measurementTime(rng: Rng): QuestionDraft {
  const inSeconds = rng.chance(0.5);
  const big = rng.int(1, 9);
  const small = rng.int(1, 11) * 5;
  const bigUnit = inSeconds ? 'min' : 'h';
  const smallUnit = inSeconds ? 's' : 'min';
  const converted = big * 60;
  return {
    kind: 'measurement-time',
    prompt: `${big} ${bigUnit} ${small} ${smallUnit} = ? ${smallUnit}`,
    answer: converted + small,
    explain: `1 ${bigUnit} = 60 ${smallUnit}, so ${big} ${bigUnit} = ${converted} ${smallUnit}. ${converted} ${OP.plus} ${small} = ${converted + small} ${smallUnit}.`,
  };
}

/** `09:15 → 10:05 = ? min`. Bridges the hour, which is where this one is actually hard. */
function clockInterval(rng: Rng): QuestionDraft {
  const startHour = rng.int(6, 20);
  const startMinute = rng.int(0, 11) * 5;
  const duration = rng.int(4, 18) * 5;
  const startTotal = startHour * 60 + startMinute;
  const endTotal = startTotal + duration;
  const start = `${pad2(startHour)}:${pad2(startMinute)}`;
  const end = `${pad2(Math.floor(endTotal / 60) % 24)}:${pad2(endTotal % 60)}`;

  // Three workings, because there are three cases, and claiming the wrong one teaches the wrong
  // method: landing exactly on the hour is neither "stay inside the hour" nor "and then some".
  const toNextHour = 60 - startMinute;
  const nextHour = `${pad2((startHour + 1) % 24)}:00`;
  const explain =
    duration > toNextHour
      ? `${start} to ${nextHour} is ${toNextHour} min, then ${duration - toNextHour} min more. ${toNextHour} ${OP.plus} ${duration - toNextHour} = ${duration} min.`
      : duration === toNextHour
        ? `${start} runs exactly to ${nextHour}: ${toNextHour} min.`
        : `Both times sit in the same hour: ${startMinute + duration} ${OP.minus} ${startMinute} = ${duration} min.`;

  return {
    kind: 'clock-interval',
    prompt: `${start} → ${end} = ? min`,
    answer: duration,
    explain,
  };
}

/**
 * The p51 bar chart, in three readings: total, difference and tallest.
 *
 * "Tallest" is the only genuinely non-numeric reading in the curriculum, so it is the
 * multiple-choice one: the bars are numbered in the prompt and drawn numbered by the renderer,
 * and the player types the bar's number.
 */
function barChart(rng: Rng): QuestionDraft {
  const count = rng.int(3, 5);
  const labels = DAY_LABELS.slice(0, count);
  const values = labels.map(() => rng.int(1, 12));
  const subject = rng.pick(CHART_SUBJECTS);
  const visual = { kind: 'bar-chart', data: { labels, values, unit: subject } } as const;
  const reading = rng.int(0, 2);

  const listing = labels.map((l, i) => `${l} ${values[i]!}`).join(', ');

  if (reading === 0) {
    const total = sum(values);
    return {
      kind: 'bar-chart',
      prompt: `${listing} → total = ?`,
      answer: total,
      explain: `Add every bar: ${values.join(` ${OP.plus} `)} = ${total} ${subject}.`,
      visual,
    };
  }

  if (reading === 1) {
    // Order the pair so the taller bar leads — the keypad cannot type a negative difference.
    const order = values.map((v, i) => ({ v, i })).sort((x, y) => y.v - x.v || x.i - y.i);
    const hi = order[0]!;
    const lo = order[order.length - 1]!;
    const diff = hi.v - lo.v;
    return {
      kind: 'bar-chart',
      prompt: `${listing} → ${labels[hi.i]!} ${OP.minus} ${labels[lo.i]!} = ?`,
      answer: diff,
      explain: `${labels[hi.i]!} has ${hi.v}, ${labels[lo.i]!} has ${lo.v}. ${hi.v} ${OP.minus} ${lo.v} = ${diff}.`,
      visual,
    };
  }

  // Tallest bar. Ties are broken by nudging the winner up, so the question has one answer.
  const working = [...values];
  let best = 0;
  for (let i = 1; i < working.length; i++) if (working[i]! > working[best]!) best = i;
  if (working.filter((v) => v === working[best]!).length > 1) working[best] = working[best]! + 1;

  const numbered = labels.map((l, i) => `${i + 1} ${l} ${working[i]!}`).join(', ');
  return {
    kind: 'bar-chart',
    prompt: `${numbered} → most = ?`,
    answer: best + 1,
    explain: `${labels[best]!} has ${working[best]!}, more than any other bar. That is bar ${best + 1}.`,
    choices: labels.map((_, i) => i + 1),
    visual: { kind: 'bar-chart', data: { labels, values: working, unit: subject } },
  };
}

/**
 * `Which is the cylinder? (1-4)` — p21.
 *
 * Multiple choice by necessity: the answer is a shape, and the keypad types numbers. The
 * `shapes` visual carries the four solids in prompt order so the renderer draws them numbered.
 */
function solidIdentify(rng: Rng): QuestionDraft {
  const options = rng.shuffle([...SOLIDS]).slice(0, 4);
  const index = rng.int(0, options.length - 1);
  const target = options[index]!;
  return {
    kind: 'solid-identify',
    prompt: `Which is the ${target}? (1-${options.length})`,
    answer: index + 1,
    explain: `The ${target} is shape ${index + 1}. The others are ${options.filter((_, i) => i !== index).join(', ')}.`,
    choices: options.map((_, i) => i + 1),
    visual: { kind: 'shapes', data: { options, target } },
  };
}

/** `Faces on a cube = ?`. Polyhedra only — see the note in `shared.ts`. */
const POLYHEDRA = Object.keys(POLYHEDRON_COUNTS);
const COUNT_KEYS: readonly SolidCountKey[] = ['faces', 'edges', 'vertices'];

function solidCount(rng: Rng): QuestionDraft {
  const solid = rng.pick(POLYHEDRA);
  const key = rng.pick(COUNT_KEYS);
  const counts = POLYHEDRON_COUNTS[solid]!;
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return {
    kind: 'solid-count',
    prompt: `${label} on a ${solid} = ?`,
    answer: counts[key],
    explain: `A ${solid} has ${counts.note}. ${label}: ${counts[key]}.`,
  };
}

/**
 * A longer sequence, with three rules the player has to tell apart: constant step, doubling or
 * trebling, and a step that itself grows. Four terms shown, the fifth typed.
 */
function sequenceExtend(rng: Rng): QuestionDraft {
  const rule = rng.int(0, 2);

  if (rule === 0) {
    const start = rng.int(2, 20);
    const step = rng.int(3, 9);
    const terms = [start, start + step, start + step * 2, start + step * 3];
    const answer = start + step * 4;
    return {
      kind: 'sequence-extend',
      prompt: sequencePrompt(terms),
      answer,
      explain: `Each step adds ${step}. ${start + step * 3} ${OP.plus} ${step} = ${answer}.`,
    };
  }

  if (rule === 1) {
    const ratio = rng.pick([2, 3]);
    const start = ratio === 2 ? rng.int(1, 5) : rng.int(1, 3);
    const terms = [start, start * ratio, start * ratio ** 2, start * ratio ** 3];
    const answer = start * ratio ** 4;
    const verb = ratio === 2 ? 'doubles' : 'trebles';
    return {
      kind: 'sequence-extend',
      prompt: sequencePrompt(terms),
      answer,
      explain: `Each term ${verb}. ${start * ratio ** 3} ${OP.times} ${ratio} = ${answer}.`,
    };
  }

  // A growing step: +d, +(d+1), +(d+2), … — the triangular-number shape.
  const start = rng.int(1, 9);
  const step = rng.int(2, 5);
  const terms = [start];
  for (let i = 0; i < 3; i++) terms.push(terms[i]! + step + i);
  const answer = terms[3]! + step + 3;
  const steps = [step, step + 1, step + 2].map((s) => `+${s}`).join(', ');
  return {
    kind: 'sequence-extend',
    prompt: sequencePrompt(terms),
    answer,
    explain: `The steps grow: ${steps}, then +${step + 3}. ${terms[3]!} ${OP.plus} ${step + 3} = ${answer}.`,
  };
}

export const TIER3_TEMPLATES: readonly QuestionTemplate[] = [
  { kind: 'multi-digit-add', weight: 4, make: multiDigitAdd },
  { kind: 'multi-digit-sub', weight: 4, make: multiDigitSub },
  { kind: 'multi-step', weight: 4, make: multiStep },
  { kind: 'tenths', weight: 2, make: tenths },
  { kind: 'decimal-add', weight: 2, make: decimalAdd },
  { kind: 'measurement-convert', weight: 2, make: measurementConvert },
  { kind: 'measurement-time', weight: 2, make: measurementTime },
  { kind: 'clock-interval', weight: 2, make: clockInterval },
  { kind: 'bar-chart', weight: 3, make: barChart },
  { kind: 'solid-identify', weight: 2, make: solidIdentify },
  { kind: 'solid-count', weight: 2, make: solidCount },
  { kind: 'sequence-extend', weight: 3, make: sequenceExtend },
];
