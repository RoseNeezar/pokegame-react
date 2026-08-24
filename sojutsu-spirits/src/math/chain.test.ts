import { describe, it, expect } from 'vitest';
import {
  BASE_ANSWER_MS,
  CHAIN_CAP,
  CHAIN_GAIN_PER_SOLVE,
  CHAIN_MAX_MULTIPLIER,
  CHAIN_STEP,
  ChainState,
  REDUCED_POWER_SCALE,
  TIER_TIME_SCALE,
  answerTimeMs,
  applyEngineModifiers,
  chainMultiplier,
  displayChain,
  posesQuestion,
} from './chain.ts';
import type { MoveDef } from '../core/types.ts';
import moves from '../data/generated/moves.json' with { type: 'json' };

const MOVES = moves as unknown as MoveDef[];
const byId = new Map(MOVES.map((m) => [m.id, m]));

/** The two moves DESIGN.md [A-2] identifies as the only `radModifier === 0` moves. */
const SILENT_MOVE_IDS = ['detonate', 'cataclysm-burst'] as const;

const powerJab = byId.get('power-jab')!;

describe('the chain curve (DESIGN.md §4.1 [A-1])', () => {
  it('hits the three landmarks the manga pins', () => {
    expect(chainMultiplier(2)).toBe(1.2); // p17
    expect(chainMultiplier(10)).toBe(2.0); // p48, a 12-link chain reading TEN at ×2
    expect(chainMultiplier(20)).toBe(3.0); // p04, the two-year veteran's ceiling
  });

  it('starts at ×1 and steps by CHAIN_STEP per link', () => {
    expect(chainMultiplier(0)).toBe(1);
    for (let chain = 0; chain <= CHAIN_CAP; chain++) {
      expect(chainMultiplier(chain)).toBeCloseTo(1 + CHAIN_STEP * chain, 10);
    }
  });

  it('never exceeds ×3.0, however long the chain runs', () => {
    for (let chain = 0; chain <= 2000; chain++) {
      expect(chainMultiplier(chain)).toBeLessThanOrEqual(CHAIN_MAX_MULTIPLIER);
    }
    expect(chainMultiplier(CHAIN_CAP)).toBe(CHAIN_MAX_MULTIPLIER);
    expect(chainMultiplier(CHAIN_CAP + 1)).toBe(CHAIN_MAX_MULTIPLIER);
    expect(chainMultiplier(1e9)).toBe(CHAIN_MAX_MULTIPLIER);
  });

  it('is monotonic and never dips below ×1, even on nonsense input', () => {
    let previous = 0;
    for (let chain = 0; chain <= 60; chain += 0.25) {
      const m = chainMultiplier(chain);
      expect(m).toBeGreaterThanOrEqual(previous);
      previous = m;
    }
    expect(chainMultiplier(-5)).toBe(1);
    expect(chainMultiplier(-0.4)).toBe(1);
  });

  it('honours a fractional chain, so CRG pays on short chains', () => {
    expect(chainMultiplier(1.35)).toBe(1.135);
    expect(chainMultiplier(2.7)).toBe(1.27);
  });
});

describe('what the player sees vs what damage uses', () => {
  it('shows the count of solves, and multiplies by the weighted total', () => {
    // A cheap move is worth 0.8 toward the multiplier, but it is still one solve. A player who
    // answered correctly must never be told their chain is zero.
    const cheap = MOVES.find((m) => m.engine.crgModifier === 0.8 && m.engine.radModifier > 0)!;
    const after = ChainState.empty().solve(cheap);
    expect(after.display).toBe(1);
    expect(after.raw).toBe(0.8);
    expect(after.multiplier).toBe(chainMultiplier(0.8));
  });

  it('counts every solve exactly once, whatever it was worth', () => {
    let state = ChainState.empty();
    for (let i = 0; i < 40; i++) state = state.add(1.35);
    expect(state.display).toBe(40);
    expect(state.raw).toBe(54);
    expect(state.multiplier).toBe(chainMultiplier(54));
  });

  it('still floors a weighted value where one is genuinely wanted', () => {
    expect(displayChain(2.7)).toBe(2);
    expect(displayChain(0)).toBe(0);
    expect(displayChain(-3)).toBe(0);
  });

  it('keeps ChainState.held self-consistent', () => {
    const held = ChainState.held(7, 9);
    expect(held.display).toBe(7);
    expect(held.raw).toBe(7);
    expect(held.bestDisplay).toBe(9);
  });
});

describe('CRG — chain rate gain (DESIGN.md §4.2 [A-2])', () => {
  it('adds exactly one link for a plain move', () => {
    const plain = MOVES.find((m) => m.engine.crgModifier === 1 && m.engine.radModifier > 0)!;
    const after = ChainState.empty().solve(plain);
    expect(after.raw).toBe(CHAIN_GAIN_PER_SOLVE);
  });

  it('adds 1.35 links for the six multi-turn charge moves', () => {
    const charge = MOVES.filter((m) => m.engine.crgModifier === 1.35);
    expect(charge).toHaveLength(6);
    for (const move of charge) {
      expect(move.engine.multiTurn).toBe(true);
      expect(ChainState.empty().solve(move).raw).toBe(1.35);
      expect(applyEngineModifiers(move).chainGain).toBe(1.35);
    }
  });

  it('prices cheap utility at 0.8 of a link', () => {
    const cheap = MOVES.find((m) => m.engine.crgModifier === 0.8)!;
    expect(ChainState.empty().solve(cheap).raw).toBe(0.8);
    // Two cheap solves are worth less than two plain ones — the whole point of the modifier.
    expect(ChainState.empty().solve(cheap).solve(cheap).raw).toBeLessThan(2);
  });

  it('respects a caller-supplied base gain', () => {
    expect(applyEngineModifiers(powerJab, { chainGain: 2 }).chainGain).toBe(2 * 0.8);
  });
});

describe('RAD — response allowance duration', () => {
  it('poses no question for exactly the two "User faints" moves', () => {
    const silent = MOVES.filter((m) => !posesQuestion(m));
    expect(silent.map((m) => m.id).sort()).toEqual([...SILENT_MOVE_IDS].sort());
    expect(silent).toHaveLength(2);
    for (const move of silent) {
      expect(move.engine.radModifier).toBe(0);
      expect(move.effect).toBe('User faints');
      expect(answerTimeMs(move)).toBe(0);
      expect(applyEngineModifiers(move).timeMs).toBe(0);
      expect(applyEngineModifiers(move).chainGain).toBe(0);
    }
  });

  it('poses a question for every other move in the catalogue', () => {
    const asking = MOVES.filter((m) => posesQuestion(m));
    expect(asking).toHaveLength(MOVES.length - 2);
    for (const move of asking) {
      expect(answerTimeMs(move)).toBeGreaterThan(0);
    }
  });

  it('grants no chain at all when no question is posed', () => {
    for (const id of SILENT_MOVE_IDS) {
      const move = byId.get(id)!;
      const held = new ChainState(7);
      const after = held.solve(move);
      expect(after.raw).toBe(7);
      expect(after).toBe(held); // the same value, not a copy — nothing happened
    }
  });

  it('scales the answer window by radModifier', () => {
    const fast = MOVES.find((m) => m.engine.radModifier === 0.8)!;
    const slow = MOVES.find((m) => m.engine.radModifier === 1.2)!;
    expect(answerTimeMs(fast, 1)).toBe(Math.round(BASE_ANSWER_MS * 0.8));
    expect(answerTimeMs(slow, 1)).toBe(Math.round(BASE_ANSWER_MS * 1.2));
  });

  it('scales the answer window by tier, so a harder band gets more thinking time', () => {
    const plain = MOVES.find((m) => m.engine.radModifier === 1)!;
    expect(answerTimeMs(plain, 1)).toBe(BASE_ANSWER_MS);
    expect(answerTimeMs(plain, 2)).toBe(Math.round(BASE_ANSWER_MS * TIER_TIME_SCALE[2]));
    expect(answerTimeMs(plain, 3)).toBe(Math.round(BASE_ANSWER_MS * TIER_TIME_SCALE[3]));
    expect(answerTimeMs(plain, 3)).toBeGreaterThan(answerTimeMs(plain, 2));
    expect(answerTimeMs(plain, 2)).toBeGreaterThan(answerTimeMs(plain, 1));
  });

  it('uses the clamped tier, not the move\'s requested tier', () => {
    const tier3 = MOVES.find((m) => m.engine.mathTier === 3 && m.engine.radModifier === 1)!;
    expect(answerTimeMs(tier3)).toBe(Math.round(BASE_ANSWER_MS * TIER_TIME_SCALE[3]));
    expect(answerTimeMs(tier3, 1)).toBe(BASE_ANSWER_MS);
  });

  it('reports the modifiers it read, so the HUD need not re-read the move', () => {
    const mods = applyEngineModifiers(powerJab);
    expect(mods.crgModifier).toBe(powerJab.engine.crgModifier);
    expect(mods.radModifier).toBe(powerJab.engine.radModifier);
    expect(mods.tier).toBe(powerJab.engine.mathTier);
    expect(mods.posesQuestion).toBe(true);
  });

  it('always returns a whole number of milliseconds', () => {
    for (const move of MOVES) {
      for (const tier of [1, 2, 3] as const) {
        expect(Number.isInteger(answerTimeMs(move, tier))).toBe(true);
      }
    }
  });
});

describe('ChainState', () => {
  it('is immutable — solve returns a new state and leaves the old one alone', () => {
    const before = ChainState.empty();
    const after = before.solve(powerJab);
    expect(before.raw).toBe(0);
    expect(after.raw).toBeGreaterThan(0);
    expect(after).not.toBe(before);
  });

  it('drops to zero and keeps the best', () => {
    let state = ChainState.empty();
    for (let i = 0; i < 7; i++) state = state.add(1);
    expect(state.display).toBe(7);

    const dropped = state.drop();
    expect(dropped.raw).toBe(0);
    expect(dropped.display).toBe(0);
    expect(dropped.multiplier).toBe(1);
    expect(dropped.best).toBe(7); // "Your chain broke at seven. Every time. Same place."
    expect(dropped.bestDisplay).toBe(7);
  });

  it('keeps the highest best across several runs and drops', () => {
    let state = ChainState.empty();
    for (let i = 0; i < 9; i++) state = state.add(1);
    state = state.drop();
    for (let i = 0; i < 4; i++) state = state.add(1);
    state = state.drop();
    expect(state.best).toBe(9); // "I drop them at nine now instead of three."
    expect(state.raw).toBe(0);
  });

  it('cannot go negative and ignores non-positive gains', () => {
    const state = new ChainState(-4);
    expect(state.raw).toBe(0);
    expect(state.add(0).raw).toBe(0);
    expect(state.add(-2).raw).toBe(0);
  });

  it('is a no-op to drop an already-empty chain', () => {
    const empty = ChainState.empty();
    expect(empty.drop()).toBe(empty);
  });

  it('reaches the ×3 ceiling after twenty plain solves and stays there', () => {
    let state = ChainState.empty();
    for (let i = 0; i < 20; i++) state = state.solve(powerJab);
    // Power Jab has crgModifier 0.8, so twenty solves is a chain of 16, not 20.
    expect(state.raw).toBe(16);
    for (let i = 0; i < 20; i++) state = state.solve(powerJab);
    expect(state.multiplier).toBe(CHAIN_MAX_MULTIPLIER);
  });
});

describe('the drop cost', () => {
  it('is the multiplier and nothing else', () => {
    // There is no API on this layer that can cost a turn. The only thing a drop returns is a
    // chain of zero; the battle engine's turn loop is not reachable from here at all.
    const dropped = ChainState.held(12).drop();
    expect(dropped.multiplier).toBe(1);
    expect(dropped.display).toBe(0);
    expect(dropped.bestDisplay).toBe(12); // the run is remembered, only the multiplier is lost
    expect(REDUCED_POWER_SCALE).toBe(0.5);
    expect(Object.keys(dropped).sort()).toEqual(['best', 'bestLinks', 'links', 'raw']);
  });
});
