/**
 * The Chain (Cadence) system — DESIGN.md §4.1 [A-1] and §4.2 [A-2].
 *
 * The Chain is the only thing arithmetic buys you in this game. It never gates a turn, it never
 * gates progress; it multiplies damage and nothing else. That is deliberate, and it is the
 * reason this file is so small: the manga's pillar ("a drop isn't a fail, it's a turn") is only
 * true if a drop can do exactly one thing — zero the multiplier — and this module is the only
 * place that can happen.
 *
 * Four readings from the manga pin the curve (p17 ×1.2 on a short chain, p18 "held past six",
 * p31 "broke at seven", p48 a 12-link chain reading TEN at ×2) and a single continuous line
 * fits all of them:
 *
 *     chainMultiplier(chain) = 1 + CHAIN_STEP × min(chain, CHAIN_CAP)
 *
 * Ten is the mid-game landmark, twenty is the mastery ceiling, ×3 is reachable but far. Both
 * constants are exported so a founder correction is a one-line data edit rather than a rewrite.
 *
 * `crgModifier` and `radModifier` are the two engine fields the move catalogue ships without a
 * definition. DESIGN.md [A-2] reads them as Chain Rate Gain and Response Allowance Duration.
 * That reading is load-bearing but reversible, so both fields are read in exactly one function —
 * `applyEngineModifiers` — and every other consumer in the game goes through it.
 *
 * Pure: no Phaser, no clock, no `Math.random`. The session layer owns elapsed time; this module
 * only ever computes how long the window *should* be.
 */
import type { MoveDef } from '../core/types.ts';

/** Multiplier gained per link of chain. `chain 10 → ×2.0`. */
export const CHAIN_STEP = 0.1;

/** Links past this stop paying. `chain 20 → ×3.0`, the mastery ceiling. */
export const CHAIN_CAP = 20;

/** The ceiling the curve asymptotes to — derived, never typed twice. */
export const CHAIN_MAX_MULTIPLIER = 1 + CHAIN_STEP * CHAIN_CAP;

/** A correct solve is worth one link before `crgModifier` is applied. */
export const CHAIN_GAIN_PER_SOLVE = 1;

/** The unmodified answer window, in milliseconds, before RAD and tier scaling. */
export const BASE_ANSWER_MS = 9000;

/**
 * Harder bands get more thinking time.
 *
 * A Tier 3 question is a two-line piece of working, not a recall; charging the same nine
 * seconds for `156 + 78` as for `4 + 5` would make the tier ceiling a reflex test rather than
 * an arithmetic one.
 */
export const TIER_TIME_SCALE: Readonly<Record<1 | 2 | 3, number>> = {
  1: 1.0,
  2: 1.15,
  3: 1.35,
};

/** What a dropped `reduced_power` move's Power is scaled by. DESIGN.md §4 step 4b. */
export const REDUCED_POWER_SCALE = 0.5;

/**
 * Chain and multipliers are floats, and floats drift: `1.35 × 3` is `4.050000000000001`.
 * Everything that leaves this module is rounded to four places so a chain of the same length
 * always compares equal to itself, across a save/load and across a replay.
 */
function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * The curve. `chain` may be fractional — `crgModifier` makes it so — and the multiplier honours
 * the fraction, because paying 1.35 links for a charge move and then flooring it away would
 * make CRG do nothing on short chains, which is precisely where charge moves are used.
 */
export function chainMultiplier(chain: number): number {
  const links = Math.min(Math.max(chain, 0), CHAIN_CAP);
  return round4(1 + CHAIN_STEP * links);
}

/**
 * What the HUD's chain counter reads.
 *
 * The chain bar is an integer readout — the manga counts links, it does not count decimals —
 * so the float is floored for display only. `raw` stays authoritative for damage.
 */
export function displayChain(rawChain: number): number {
  return Math.floor(Math.max(0, rawChain));
}

/**
 * `radModifier === 0` means no question is posed at all.
 *
 * Exactly two moves in the catalogue carry it — Detonate and Cataclysm Burst — and they are
 * exactly the two moves whose effect is "User faints". You do not do arithmetic to blow
 * yourself up. The move auto-resolves, and it grants no chain because no number was answered.
 */
export function posesQuestion(move: MoveDef): boolean {
  return move.engine.radModifier > 0;
}

/** Inputs to `applyEngineModifiers`. Every field defaults, so callers usually pass nothing. */
export interface EngineBase {
  /** Chain added by a correct solve before CRG. Defaults to `CHAIN_GAIN_PER_SOLVE`. */
  readonly chainGain?: number;
  /** The answer window before RAD and tier scaling. Defaults to `BASE_ANSWER_MS`. */
  readonly timeMs?: number;
  /** The band actually posed, which may be clamped below `move.engine.mathTier`. */
  readonly tier?: 1 | 2 | 3;
}

export interface EngineModifiers {
  /** False when `radModifier` is 0: the move auto-resolves with no question. */
  readonly posesQuestion: boolean;
  /** Chain a correct solve is worth. 0 when no question is posed. */
  readonly chainGain: number;
  /** The answer window in whole milliseconds. 0 when no question is posed. */
  readonly timeMs: number;
  /** Echoed so callers can log or display the reading without re-reading the move. */
  readonly crgModifier: number;
  readonly radModifier: number;
  readonly tier: 1 | 2 | 3;
}

/**
 * The single place `crgModifier` and `radModifier` are interpreted.
 *
 * If the founder's master prompt turns out to define them differently, this function is the
 * whole blast radius.
 */
export function applyEngineModifiers(move: MoveDef, base: EngineBase = {}): EngineModifiers {
  const { crgModifier, radModifier } = move.engine;
  const tier = base.tier ?? move.engine.mathTier;
  const asks = radModifier > 0;

  const chainGain = base.chainGain ?? CHAIN_GAIN_PER_SOLVE;
  const timeMs = base.timeMs ?? BASE_ANSWER_MS;

  return {
    posesQuestion: asks,
    chainGain: asks ? round4(chainGain * crgModifier) : 0,
    timeMs: asks ? Math.round(timeMs * radModifier * TIER_TIME_SCALE[tier]) : 0,
    crgModifier,
    radModifier,
    tier,
  };
}

/**
 * How long the answer bar drains for. 0 means "do not pose a question".
 *
 * `tier` is the band actually posed, not `move.engine.mathTier` — a Tier 3 move clamped to
 * Tier 1 by the segment ceiling asks a Tier 1 question and gets a Tier 1 window.
 */
export function answerTimeMs(move: MoveDef, tier: 1 | 2 | 3 = move.engine.mathTier): number {
  return applyEngineModifiers(move, { tier }).timeMs;
}

/**
 * An immutable chain value.
 *
 * Immutable because a battle is a replay of commands: handing out a new state per solve means a
 * caller can keep the previous one for a rewind, an undo, or a "what the strike was worth"
 * readout, and no UI can mutate the number that damage is computed from.
 */
export class ChainState {
  /** The authoritative, possibly fractional, chain. */
  readonly raw: number;
  /** The longest raw chain reached in this battle. Survives a drop — that is the point. */
  readonly best: number;

  constructor(raw = 0, best = 0) {
    this.raw = round4(Math.max(0, raw));
    this.best = round4(Math.max(this.raw, best));
  }

  /** A fresh chain. */
  static empty(): ChainState {
    return new ChainState();
  }

  /** The integer the HUD shows. */
  get display(): number {
    return displayChain(this.raw);
  }

  /** The integer the post-battle "best chain" line shows. */
  get bestDisplay(): number {
    return displayChain(this.best);
  }

  /** The damage multiplier this chain is currently worth. */
  get multiplier(): number {
    return chainMultiplier(this.raw);
  }

  /**
   * A correct solve.
   *
   * Returns `this` unchanged for a move that poses no question: an auto-resolving move neither
   * earns nor spends the chain you were already holding.
   */
  solve(move: MoveDef): ChainState {
    const mods = applyEngineModifiers(move);
    if (!mods.posesQuestion) return this;
    return this.add(mods.chainGain);
  }

  /** Adds raw links. Used by `solve` and by anything that awards chain outside a move. */
  add(links: number): ChainState {
    if (links <= 0) return this;
    return new ChainState(this.raw + links, this.best);
  }

  /**
   * A drop: wrong answer, or the bar ran out.
   *
   * Zeroes the chain and keeps `best`. It does *not* return any signal that could skip a turn,
   * because there is no such signal — the caller's next move resolves either way. Any change
   * here that makes a drop cost more than the multiplier breaks the game's design pillar.
   */
  drop(): ChainState {
    if (this.raw === 0) return this;
    return new ChainState(0, this.best);
  }
}
