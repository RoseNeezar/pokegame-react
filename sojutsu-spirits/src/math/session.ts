/**
 * MathSession — one battle turn's worth of arithmetic.
 *
 * This is the seam between the Chain and the battle engine. The Phaser layer calls `start` when
 * the player picks a move, draws whatever comes back, and calls `submit` or `timeout` once. The
 * session hands back a result whose first three fields are exactly the three the battle engine's
 * `BattleCommand` asks for, so the UI never computes a multiplier and never decides what a drop
 * costs.
 *
 * Three things are deliberate here:
 *
 * 1. **Every path produces a resolvable outcome.** Correct, wrong, timed out or auto-resolved,
 *    `submit`/`timeout` always return a command the battle can run. There is no path that
 *    returns "nothing happens", because a drop must never cost the turn — DESIGN.md §4 step 6.
 * 2. **No clock.** The session computes the window and the caller reports elapsed time. That
 *    keeps the layer pure and testable, and it means a paused game cannot silently drop a chain.
 * 3. **`radModifier === 0` short-circuits before a question is ever generated.** Detonate and
 *    Cataclysm Burst are the only two moves that do this, and they auto-resolve at whatever
 *    chain the player was already holding.
 */
import type { BattleCommand } from '../core/battle.ts';
import type { MoveDef } from '../core/types.ts';
import type { Rng } from '../core/rng.ts';
import { ChainState, REDUCED_POWER_SCALE, answerTimeMs, posesQuestion } from './chain.ts';
import { checkAnswer, effectiveTier, generateQuestion, type MathTier, type Question } from './question.ts';

/**
 * What `start` returns.
 *
 * A discriminated union rather than a nullable question: the auto-resolve branch has no timer
 * and no prompt, and a caller that forgets to check `autoResolve` cannot reach into a question
 * that does not exist.
 */
export type MathTurnStart =
  | {
      readonly autoResolve: false;
      readonly question: Question;
      readonly timeLimitMs: number;
      readonly tier: MathTier;
    }
  | {
      readonly autoResolve: true;
      readonly tier: MathTier;
    };

export type MathOutcomeReason = 'correct' | 'wrong' | 'timeout' | 'auto';

export interface MathOutcome {
  /** Feeds `BattleCommand.solved`. */
  readonly solved: boolean;
  /** Feeds `BattleCommand.chainMultiplier`. */
  readonly chainMultiplier: number;
  /**
   * Feeds `BattleCommand.powerScale`.
   *
   * `REDUCED_POWER_SCALE` on a dropped `reduced_power` move; `1` otherwise. For a dropped
   * `move_fails` move the battle engine fizzles the move before it reads this, so the value is
   * inert — it is left at 1 rather than 0 so nothing downstream mistakes it for a real scale.
   */
  readonly powerScale: number;
  readonly reason: MathOutcomeReason;
  /** The chain the HUD should now show. */
  readonly chain: number;
  /** The authoritative fractional chain. */
  readonly chainRaw: number;
  /** Longest chain this battle, kept across drops. */
  readonly chainBest: number;
  /** The chain that was lost, for the "CHAIN BROKEN at 7" line. 0 when nothing broke. */
  readonly chainBroken: number;
  /** The right answer, so the strip can show it on a drop. Null when no question was posed. */
  readonly correctAnswer: number | null;
  /** The working. Shown on a drop — the manga's mentors always show the working. */
  readonly explain: string | null;
  /**
   * What the player typed, for the "you said 46" line.
   *
   * Null when there was nothing to record: an expired bar (`timeout()`) or an auto-resolve. An
   * answer that arrived after the bar drained still reports `reason: 'timeout'` but keeps what
   * was typed, so the strip can show both what the player said and that it was too late.
   */
  readonly submitted: number | null;
}

export interface MathSessionOptions {
  readonly rng: Rng;
  /** Resume an in-progress battle's chain. Defaults to empty. */
  readonly chain?: ChainState;
  /**
   * How many recent question ids to keep out of the draw. Small on purpose: a player should
   * meet `7 × 8` again this battle, just not twice in a row.
   */
  readonly avoidRecent?: number;
}

export const DEFAULT_AVOID_RECENT = 8;

interface PendingTurn {
  readonly move: MoveDef;
  readonly tier: MathTier;
  readonly question: Question | null;
  readonly timeLimitMs: number;
}

export class MathSession {
  private readonly rng: Rng;
  private readonly avoidRecent: number;
  private recentIds: string[] = [];
  private chainState: ChainState;
  private turn: PendingTurn | null = null;

  constructor(opts: MathSessionOptions) {
    this.rng = opts.rng;
    this.chainState = opts.chain ?? ChainState.empty();
    this.avoidRecent = Math.max(0, opts.avoidRecent ?? DEFAULT_AVOID_RECENT);
  }

  get chain(): ChainState {
    return this.chainState;
  }

  /** The question currently on the strip, or null between turns and on an auto-resolve. */
  get question(): Question | null {
    return this.turn?.question ?? null;
  }

  /** True while a turn is waiting on `submit` or `timeout`. */
  get isPending(): boolean {
    return this.turn !== null;
  }

  /**
   * Poses the turn's question.
   *
   * `segmentCeiling` is the campaign's band cap, not the move's — the move asks for
   * `engine.mathTier` and gets `min(that, ceiling)`.
   */
  start(move: MoveDef, segmentCeiling: MathTier): MathTurnStart {
    const tier = effectiveTier(move.engine.mathTier, segmentCeiling);

    if (!posesQuestion(move)) {
      this.turn = { move, tier, question: null, timeLimitMs: 0 };
      return { autoResolve: true, tier };
    }

    const question = generateQuestion({
      tier: move.engine.mathTier,
      segmentCeiling,
      rng: this.rng,
      avoidIds: this.recentIds,
    });
    this.remember(question.id);

    const timeLimitMs = answerTimeMs(move, tier);
    this.turn = { move, tier, question, timeLimitMs };
    return { autoResolve: false, question, timeLimitMs, tier };
  }

  /**
   * The player pressed OK.
   *
   * `elapsedMs` is optional; pass it and an answer that arrived after the bar drained is
   * treated as a timeout, so a laggy frame cannot award a chain link that was not earned.
   */
  submit(answer: number, elapsedMs?: number): MathOutcome {
    const turn = this.requireTurn('submit');
    if (!turn.question) return this.resolveAuto();

    if (elapsedMs !== undefined && elapsedMs > turn.timeLimitMs) {
      return this.finish(turn, false, 'timeout', answer);
    }
    const correct = checkAnswer(turn.question, answer);
    return this.finish(turn, correct, correct ? 'correct' : 'wrong', answer);
  }

  /** The bar drained. A drop, and nothing more than a drop. */
  timeout(): MathOutcome {
    const turn = this.requireTurn('timeout');
    if (!turn.question) return this.resolveAuto();
    return this.finish(turn, false, 'timeout', null);
  }

  /**
   * Resolves a move that posed no question.
   *
   * The held chain still multiplies the strike. Judgement call: `radModifier === 0` says "ask
   * nothing", not "forget everything" — Detonate spends the run you were already holding, which
   * is the only reading that makes a self-destruct worth building a chain for. It grants no new
   * chain, because no number was answered.
   */
  resolveAuto(): MathOutcome {
    this.requireTurn('resolveAuto');
    this.turn = null;
    return {
      solved: true,
      chainMultiplier: this.chainState.multiplier,
      powerScale: 1,
      reason: 'auto',
      chain: this.chainState.display,
      chainRaw: this.chainState.raw,
      chainBest: this.chainState.bestDisplay,
      chainBroken: 0,
      correctAnswer: null,
      explain: null,
      submitted: null,
    };
  }

  /**
   * Abandons the posed question — the player pressed `BACK` before answering.
   *
   * The chain is deliberately left alone. Backing out of a move is not a wrong answer, and only
   * a wrong answer may cost the multiplier; charging for a mis-tap would make the deck's own
   * `BACK` button a trap. No turn is consumed either, so the caller may `start` again at once.
   */
  cancel(): void {
    this.turn = null;
  }

  /** Starts a fresh battle's chain. */
  reset(chain: ChainState = ChainState.empty()): void {
    this.chainState = chain;
    this.recentIds = [];
    this.turn = null;
  }

  private finish(
    turn: PendingTurn,
    solved: boolean,
    reason: MathOutcomeReason,
    submitted: number | null,
  ): MathOutcome {
    const broken = solved ? 0 : this.chainState.display;
    this.chainState = solved ? this.chainState.solve(turn.move) : this.chainState.drop();
    this.turn = null;

    const reducedPower = !solved && turn.move.engine.failureMode === 'reduced_power';

    return {
      solved,
      // The link you just earned counts on this strike — you answered before the spear fell.
      chainMultiplier: this.chainState.multiplier,
      powerScale: reducedPower ? REDUCED_POWER_SCALE : 1,
      reason,
      chain: this.chainState.display,
      chainRaw: this.chainState.raw,
      chainBest: this.chainState.bestDisplay,
      chainBroken: broken,
      correctAnswer: turn.question ? turn.question.answer : null,
      explain: solved ? null : (turn.question?.explain ?? null),
      submitted,
    };
  }

  private requireTurn(caller: string): PendingTurn {
    if (!this.turn) throw new Error(`MathSession.${caller}() with no turn in progress`);
    return this.turn;
  }

  private remember(id: string): void {
    if (this.avoidRecent === 0) return;
    this.recentIds.push(id);
    if (this.recentIds.length > this.avoidRecent) this.recentIds.shift();
  }
}

/**
 * Builds the battle engine's command from an outcome.
 *
 * The three fields are copied straight across — `solved`, `chainMultiplier`, `powerScale` — so
 * the shape in `src/core/battle.ts` stays the single definition and this function is where a
 * mismatch would fail to compile.
 */
export function toBattleCommand(
  outcome: MathOutcome,
  slot: number,
): Extract<BattleCommand, { kind: 'move' }> {
  return {
    kind: 'move',
    slot,
    solved: outcome.solved,
    chainMultiplier: outcome.chainMultiplier,
    powerScale: outcome.powerScale,
  };
}
