/**
 * Questions — the thing the equation strip shows and the keypad answers.
 *
 * The shape of a question is dictated by the input device, and the input device is fixed by
 * `reference/visual/math-combat-reference.png`: a 3×4 pad of `1-9`, backspace, `0`, `OK`. There
 * is no minus key, no decimal point and no fraction bar. Therefore **every answer in this game
 * is a non-negative integer**, without exception. A question about decimals is phrased as a
 * count of tenths; a question about a solid is phrased as a numbered choice. That constraint is
 * enforced here, at generation time, rather than trusted to twenty-six separate templates.
 *
 * Every question also carries its own `explain` — the working, not just the answer. The manga's
 * mentors always show the working, and a drop is the moment the game gets to teach; a wrong
 * answer that only says "wrong" would waste the one screen the player is guaranteed to read.
 *
 * Pure and seeded. Every draw goes through `src/core/rng.ts`, so a battle replays from
 * `(seed, inputs)` down to which question was asked.
 */
import type { Rng } from '../core/rng.ts';
import { TEMPLATES_BY_TIER } from './curriculum/index.ts';

/** The three curriculum bands. Matches `MoveEngine.mathTier` in `src/core/types.ts`. */
export type MathTier = 1 | 2 | 3;

/** What the renderer draws above the equation strip, when a question has a picture. */
export interface QuestionVisual {
  readonly kind: 'bar-chart' | 'array' | 'shapes' | 'number-line';
  /** Shape depends on `kind`; narrow it with the guards below. */
  readonly data: unknown;
}

export interface Question {
  readonly id: string;
  readonly tier: MathTier;
  /** e.g. 'times-table', 'place-value', 'bar-chart'. Stable — telemetry keys off it. */
  readonly kind: string;
  /** What the equation strip shows, e.g. `12 × 7 = ?`. */
  readonly prompt: string;
  /** The numeric answer the keypad must produce. Always a non-negative integer. */
  readonly answer: number;
  /** The working, shown on a drop. Never empty. */
  readonly explain: string;
  /** How many digits the keypad should expect — sizes the entry slot. */
  readonly answerDigits: number;
  /** Only for multiple-choice kinds (solid identification, "which bar is tallest"). */
  readonly choices?: number[];
  readonly visual?: QuestionVisual;
}

/**
 * What a curriculum template produces. The generator adds the `id` and derives `answerDigits`,
 * so a template can never mint an inconsistent one.
 */
export interface QuestionDraft {
  readonly kind: string;
  readonly prompt: string;
  readonly answer: number;
  readonly explain: string;
  readonly choices?: number[];
  readonly visual?: QuestionVisual;
}

export type QuestionMaker = (rng: Rng) => QuestionDraft;

export interface QuestionTemplate {
  readonly kind: string;
  /** Relative draw weight within its band. */
  readonly weight: number;
  readonly make: QuestionMaker;
}

export interface GenerateOptions {
  /** The move's requested band — `move.engine.mathTier`. */
  readonly tier: MathTier;
  /** The campaign's ceiling. Shrine 1 raises it to 2, Shrine 2 to 3. */
  readonly segmentCeiling: MathTier;
  readonly rng: Rng;
  /** Recently-asked ids to avoid repeating. Best-effort — see `MAX_DRAW_ATTEMPTS`. */
  readonly avoidIds?: readonly string[] | ReadonlySet<string>;
}

/**
 * A prompt has to fit one line of the equation strip at a legible size. Templates are written
 * to stay inside this, and the curriculum test enforces it, so the UI never has to reflow.
 */
export const MAX_PROMPT_CHARS = 64;

/**
 * How many times the generator will redraw to dodge `avoidIds` before giving up.
 *
 * Bounded on purpose: a small band plus a long avoid list must not spin, and a repeated
 * question is a far smaller problem than a battle that never poses one.
 */
export const MAX_DRAW_ATTEMPTS = 12;

/**
 * The band actually posed.
 *
 * `min(move.engine.mathTier, segmentCeiling)` — DESIGN.md §6. Fifty-two of the 104 moves are
 * Tier 3, and plenty of them are learnable in the first region, so without this clamp a level-8
 * spirit would be asking for `156 + 78` before the player has met a shrine.
 */
export function effectiveTier(tier: MathTier, segmentCeiling: MathTier): MathTier {
  const t = Math.min(clampTier(tier), clampTier(segmentCeiling));
  return clampTier(t);
}

function clampTier(value: number): MathTier {
  if (value <= 1) return 1;
  if (value >= 3) return 3;
  return 2;
}

/** Digits a non-negative integer occupies on the keypad. `0` is one digit. */
export function digitsIn(value: number): number {
  return String(Math.max(0, Math.floor(value))).length;
}

/**
 * Content-addressed id: the same question text always gets the same id.
 *
 * That is what makes `avoidIds` mean "don't ask me that again" rather than "don't reuse that
 * object", and it keeps ids stable across a save/load without storing the question itself.
 *
 * The id addresses the *prompt*, not the answer, and for one kind those differ: `solid-identify`
 * asks which drawn shape is the cone, so two draws can print the same prompt over a different
 * shuffle and answer 2 and 4. An id is therefore "this question text", not "this exact question",
 * and the only thing that reads it — the avoid list — wants the text anyway: asking for the cone
 * twice in a row reads as a repeat to the player whichever shape it lands on. Nothing may key a
 * *result* off an id. The exception is pinned by name in `question.test.ts`, so a future template
 * cannot quietly join it.
 */
export function questionId(tier: MathTier, kind: string, prompt: string): string {
  return `t${tier}:${kind}:${fnv1a(prompt).toString(36)}`;
}

function fnv1a(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** The keypad's verdict. Non-integer and negative submissions are simply wrong, never a throw. */
export function checkAnswer(question: Question, answer: number): boolean {
  return Number.isInteger(answer) && answer === question.answer;
}

export function generateQuestion(opts: GenerateOptions): Question {
  const tier = effectiveTier(opts.tier, opts.segmentCeiling);
  const templates = TEMPLATES_BY_TIER[tier];
  const avoid = toIdSet(opts.avoidIds);

  let draft = drawDraft(templates, opts.rng);
  let id = questionId(tier, draft.kind, draft.prompt);

  for (let attempt = 1; attempt < MAX_DRAW_ATTEMPTS && avoid.has(id); attempt++) {
    draft = drawDraft(templates, opts.rng);
    id = questionId(tier, draft.kind, draft.prompt);
  }

  return finalise(tier, id, draft);
}

function drawDraft(templates: readonly QuestionTemplate[], rng: Rng): QuestionDraft {
  const template = rng.weighted(templates, (t) => t.weight);
  return template.make(rng);
}

function toIdSet(ids: GenerateOptions['avoidIds']): ReadonlySet<string> {
  if (!ids) return EMPTY_IDS;
  return ids instanceof Set ? ids : new Set(ids as readonly string[]);
}

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

/**
 * Seals a draft into a Question, and refuses to ship one the keypad cannot answer.
 *
 * These throws are assertions about the curriculum, not runtime conditions: the generator is
 * deterministic, so if the test sweep is green across thousands of seeds none of them can fire
 * in a battle. Leaving them in means a future template that breaks the keypad contract fails
 * loudly in development instead of quietly posing an unanswerable question mid-fight.
 */
function finalise(tier: MathTier, id: string, draft: QuestionDraft): Question {
  const { kind, prompt, answer, explain, choices, visual } = draft;

  if (!Number.isInteger(answer) || answer < 0) {
    throw new Error(`Question "${kind}" produced a non-keypad answer: ${answer}`);
  }
  if (explain.length === 0) {
    throw new Error(`Question "${kind}" produced no working`);
  }
  if (choices && !choices.includes(answer)) {
    throw new Error(`Question "${kind}" answer ${answer} is not among its choices`);
  }

  const answerDigits = choices
    ? digitsIn(Math.max(...choices))
    : digitsIn(answer);

  const question: Question = {
    id,
    tier,
    kind,
    prompt,
    answer,
    explain,
    answerDigits,
    ...(choices ? { choices } : {}),
    ...(visual ? { visual } : {}),
  };
  return question;
}

/* ------------------------------------------------------------------ visuals */

/** Payload for `visual.kind === 'bar-chart'`. */
export interface BarChartData {
  readonly labels: readonly string[];
  readonly values: readonly number[];
  readonly unit: string;
}

/** Payload for `visual.kind === 'array'` — the p21 rows-of-dots picture of multiplication. */
export interface ArrayData {
  readonly rows: number;
  readonly cols: number;
}

/** Payload for `visual.kind === 'shapes'` — numbered solids, one of which is the target. */
export interface ShapesData {
  readonly options: readonly string[];
  readonly target: string;
}

/** Payload for `visual.kind === 'number-line'` — the p13 waystones. */
export interface NumberLineData {
  readonly from: number;
  readonly steps: number;
  readonly to: number;
}

export function asBarChart(visual: QuestionVisual): BarChartData | null {
  return visual.kind === 'bar-chart' ? (visual.data as BarChartData) : null;
}

export function asArray(visual: QuestionVisual): ArrayData | null {
  return visual.kind === 'array' ? (visual.data as ArrayData) : null;
}

export function asShapes(visual: QuestionVisual): ShapesData | null {
  return visual.kind === 'shapes' ? (visual.data as ShapesData) : null;
}

export function asNumberLine(visual: QuestionVisual): NumberLineData | null {
  return visual.kind === 'number-line' ? (visual.data as NumberLineData) : null;
}
