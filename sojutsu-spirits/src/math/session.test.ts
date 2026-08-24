import { describe, it, expect } from 'vitest';
import { Rng } from '../core/rng.ts';
import { Battle } from '../core/battle.ts';
import { dex, createSpirit } from '../core/dex.ts';
import type { MoveDef } from '../core/types.ts';
import moves from '../data/generated/moves.json' with { type: 'json' };
import { MathSession, toBattleCommand, type MathOutcome } from './session.ts';
import { BASE_ANSWER_MS, CHAIN_MAX_MULTIPLIER, ChainState, TIER_TIME_SCALE, chainMultiplier } from './chain.ts';
import { checkAnswer, type MathTier } from './question.ts';

const MOVES = moves as unknown as MoveDef[];
const byId = new Map(MOVES.map((m) => [m.id, m]));

/** Tier 1, rad 1, crg 1, `reduced_power` — the clean baseline for chain arithmetic. */
const emberFlick = byId.get('ember-flick')!;
/** Tier 3, rad 1, crg 1, `move_fails` — the fizzle path. */
const bladeRitual = byId.get('blade-ritual')!;
/** The two moves that pose no question at all. */
const detonate = byId.get('detonate')!;
const cataclysmBurst = byId.get('cataclysm-burst')!;
/** A multi-turn charge move: crg 1.35, rad 1.2. */
const patientFury = byId.get('patient-fury')!;

function session(seed: string | number = 'session', chain?: ChainState): MathSession {
  return new MathSession(chain ? { rng: new Rng(seed), chain } : { rng: new Rng(seed) });
}

/** Runs one turn and answers it correctly. */
function solveTurn(s: MathSession, move: MoveDef, ceiling: MathTier = 3): MathOutcome {
  const started = s.start(move, ceiling);
  if (started.autoResolve) throw new Error('expected a question');
  return s.submit(started.question.answer);
}

describe('start', () => {
  it('poses a question sized to the move and the segment', () => {
    const s = session();
    const started = s.start(emberFlick, 3);
    expect(started.autoResolve).toBe(false);
    if (started.autoResolve) return;
    expect(started.tier).toBe(1);
    expect(started.question.tier).toBe(1);
    expect(started.timeLimitMs).toBe(BASE_ANSWER_MS);
    expect(started.question.prompt.length).toBeGreaterThan(0);
    expect(s.isPending).toBe(true);
    expect(s.question).toBe(started.question);
  });

  it('clamps the band to the campaign ceiling and shortens the window with it', () => {
    const s = session();
    const clamped = s.start(bladeRitual, 1);
    if (clamped.autoResolve) throw new Error('expected a question');
    expect(bladeRitual.engine.mathTier).toBe(3);
    expect(clamped.tier).toBe(1);
    expect(clamped.question.tier).toBe(1);
    expect(clamped.timeLimitMs).toBe(BASE_ANSWER_MS);

    const open = session().start(bladeRitual, 3);
    if (open.autoResolve) throw new Error('expected a question');
    expect(open.tier).toBe(3);
    expect(open.timeLimitMs).toBe(Math.round(BASE_ANSWER_MS * TIER_TIME_SCALE[3]));
  });

  it('lengthens the window for a charge move — RAD 1.2', () => {
    const s = session();
    const started = s.start(patientFury, 3);
    if (started.autoResolve) throw new Error('expected a question');
    expect(patientFury.engine.radModifier).toBe(1.2);
    expect(started.timeLimitMs).toBe(Math.round(BASE_ANSWER_MS * 1.2 * TIER_TIME_SCALE[1]));
  });

  it('never repeats the question it just asked', () => {
    const s = session('no-repeat');
    let previous = '';
    for (let i = 0; i < 60; i++) {
      const started = s.start(emberFlick, 3);
      if (started.autoResolve) throw new Error('expected a question');
      expect(started.question.id).not.toBe(previous);
      previous = started.question.id;
      s.submit(started.question.answer);
    }
  });
});

describe('the auto-resolve path (radModifier 0)', () => {
  it.each([detonate, cataclysmBurst])('poses nothing for %#', (move) => {
    const s = session();
    const started = s.start(move, 3);
    expect(started.autoResolve).toBe(true);
    expect(s.question).toBeNull();
    expect(s.isPending).toBe(true);
  });

  it('does not even draw from the rng — the question stream is untouched', () => {
    const rng = new Rng('untouched');
    const s = new MathSession({ rng });
    const before = rng.getState();
    s.start(detonate, 3);
    expect(rng.getState()).toEqual(before);
  });

  it('resolves as solved, at full power, and grants no chain', () => {
    const s = session('auto', new ChainState(6));
    s.start(detonate, 3);
    const outcome = s.resolveAuto();
    expect(outcome.solved).toBe(true);
    expect(outcome.reason).toBe('auto');
    expect(outcome.powerScale).toBe(1);
    expect(outcome.chain).toBe(6);
    expect(s.chain.raw).toBe(6);
    expect(outcome.correctAnswer).toBeNull();
    expect(outcome.explain).toBeNull();
    expect(outcome.submitted).toBeNull();
  });

  it('still spends the chain the player was holding', () => {
    const s = session('auto-mult', new ChainState(10));
    s.start(cataclysmBurst, 3);
    expect(s.resolveAuto().chainMultiplier).toBe(2);
  });

  it('cannot be dropped — submit and timeout both auto-resolve instead', () => {
    const viaSubmit = session('auto-submit', new ChainState(4));
    viaSubmit.start(detonate, 3);
    const a = viaSubmit.submit(999);
    expect(a.reason).toBe('auto');
    expect(a.solved).toBe(true);
    expect(viaSubmit.chain.raw).toBe(4);

    const viaTimeout = session('auto-timeout', new ChainState(4));
    viaTimeout.start(detonate, 3);
    const b = viaTimeout.timeout();
    expect(b.reason).toBe('auto');
    expect(b.solved).toBe(true);
    expect(viaTimeout.chain.raw).toBe(4);
  });

  it('closes the turn, so a second resolve is a programming error', () => {
    const s = session();
    s.start(detonate, 3);
    s.resolveAuto();
    expect(s.isPending).toBe(false);
    expect(() => s.resolveAuto()).toThrow(/no turn in progress/);
  });
});

describe('the solved path', () => {
  it('reports solved, builds the chain and multiplies with it', () => {
    const s = session('solve');
    const first = solveTurn(s, emberFlick);
    expect(first.solved).toBe(true);
    expect(first.reason).toBe('correct');
    expect(first.powerScale).toBe(1);
    expect(first.chain).toBe(1);
    expect(first.chainMultiplier).toBe(1.1);
    expect(first.explain).toBeNull();
    expect(first.chainBroken).toBe(0);

    const second = solveTurn(s, emberFlick);
    expect(second.chain).toBe(2);
    expect(second.chainMultiplier).toBe(1.2); // the p17 reading
  });

  it('reaches ×2.0 at ten links and ×3.0 at twenty', () => {
    const s = session('landmarks');
    let outcome = solveTurn(s, emberFlick);
    for (let i = 1; i < 10; i++) outcome = solveTurn(s, emberFlick);
    expect(outcome.chain).toBe(10);
    expect(outcome.chainMultiplier).toBe(2);

    for (let i = 10; i < 20; i++) outcome = solveTurn(s, emberFlick);
    expect(outcome.chain).toBe(20);
    expect(outcome.chainMultiplier).toBe(CHAIN_MAX_MULTIPLIER);

    for (let i = 0; i < 5; i++) outcome = solveTurn(s, emberFlick);
    expect(outcome.chain).toBe(25);
    expect(outcome.chainMultiplier).toBe(CHAIN_MAX_MULTIPLIER);
  });

  it('pays CRG on a charge move', () => {
    const s = session('crg');
    const outcome = solveTurn(s, patientFury);
    expect(outcome.chainRaw).toBe(1.35);
    expect(outcome.chain).toBe(1); // displayed floored
    expect(outcome.chainMultiplier).toBe(chainMultiplier(1.35));
  });

  it('accepts an in-time answer when elapsed time is reported', () => {
    const s = session('in-time');
    const started = s.start(emberFlick, 3);
    if (started.autoResolve) throw new Error('expected a question');
    const outcome = s.submit(started.question.answer, started.timeLimitMs - 1);
    expect(outcome.solved).toBe(true);
  });
});

describe('the drop path', () => {
  it('reports a drop, zeroes the chain and halves a reduced_power move', () => {
    const s = session('drop');
    solveTurn(s, emberFlick);
    solveTurn(s, emberFlick);
    solveTurn(s, emberFlick);
    expect(s.chain.display).toBe(3);

    const started = s.start(emberFlick, 3);
    if (started.autoResolve) throw new Error('expected a question');
    const outcome = s.submit(started.question.answer + 1);

    expect(outcome.solved).toBe(false);
    expect(outcome.reason).toBe('wrong');
    expect(outcome.chain).toBe(0);
    expect(outcome.chainMultiplier).toBe(1);
    expect(outcome.powerScale).toBe(0.5);
    expect(outcome.chainBroken).toBe(3);
    expect(outcome.chainBest).toBe(3);
    expect(outcome.submitted).toBe(started.question.answer + 1);
  });

  it('shows the working, because a drop is the teaching moment', () => {
    const s = session('working');
    const started = s.start(bladeRitual, 3);
    if (started.autoResolve) throw new Error('expected a question');
    const outcome = s.submit(started.question.answer + 1);
    expect(outcome.explain).toBe(started.question.explain);
    expect(outcome.explain!.length).toBeGreaterThan(0);
    expect(outcome.correctAnswer).toBe(started.question.answer);
  });

  it('leaves powerScale inert for a move_fails move — the engine fizzles it', () => {
    const s = session('fizzle');
    const started = s.start(bladeRitual, 3);
    if (started.autoResolve) throw new Error('expected a question');
    const outcome = s.submit(started.question.answer + 1);
    expect(bladeRitual.engine.failureMode).toBe('move_fails');
    expect(outcome.solved).toBe(false);
    expect(outcome.powerScale).toBe(1);
  });

  it('keeps the best chain across the drop, and rebuilds from zero', () => {
    const s = session('rebuild');
    for (let i = 0; i < 9; i++) solveTurn(s, emberFlick);
    const started = s.start(emberFlick, 3);
    if (started.autoResolve) throw new Error('expected a question');
    s.submit(started.question.answer + 1);
    expect(s.chain.raw).toBe(0);
    expect(s.chain.best).toBe(9);

    const after = solveTurn(s, emberFlick);
    expect(after.chain).toBe(1);
    expect(after.chainBest).toBe(9);
  });

  it('never returns a result the battle cannot resolve', () => {
    // The design pillar: a drop costs the multiplier, never the turn. Every path out of the
    // session hands back a runnable command.
    const s = session('pillar');
    for (const move of [emberFlick, bladeRitual, patientFury]) {
      const started = s.start(move, 3);
      if (started.autoResolve) throw new Error('expected a question');
      const outcome = s.submit(started.question.answer + 1);
      const command = toBattleCommand(outcome, 0);
      expect(command.kind).toBe('move');
      expect(command.solved).toBe(false);
      expect(Number.isFinite(command.chainMultiplier)).toBe(true);
      expect(Number.isFinite(command.powerScale)).toBe(true);
    }
  });
});

describe('the timeout path', () => {
  it('drops the chain and records nothing submitted', () => {
    const s = session('timeout');
    solveTurn(s, emberFlick);
    solveTurn(s, emberFlick);

    const started = s.start(emberFlick, 3);
    if (started.autoResolve) throw new Error('expected a question');
    const outcome = s.timeout();

    expect(outcome.solved).toBe(false);
    expect(outcome.reason).toBe('timeout');
    expect(outcome.submitted).toBeNull();
    expect(outcome.chain).toBe(0);
    expect(outcome.chainBroken).toBe(2);
    expect(outcome.explain).toBe(started.question.explain);
    expect(outcome.powerScale).toBe(0.5);
  });

  it('treats a late but correct answer as a timeout', () => {
    const s = session('late');
    const started = s.start(emberFlick, 3);
    if (started.autoResolve) throw new Error('expected a question');
    const outcome = s.submit(started.question.answer, started.timeLimitMs + 1);
    expect(outcome.solved).toBe(false);
    expect(outcome.reason).toBe('timeout');
    expect(checkAnswer(started.question, started.question.answer)).toBe(true);
  });
});

describe('session bookkeeping', () => {
  it('refuses to resolve a turn that was never started', () => {
    const s = session();
    expect(() => s.submit(4)).toThrow(/no turn in progress/);
    expect(() => s.timeout()).toThrow(/no turn in progress/);
    expect(s.isPending).toBe(false);
    expect(s.question).toBeNull();
  });

  it('refuses to resolve the same turn twice', () => {
    const s = session();
    const started = s.start(emberFlick, 3);
    if (started.autoResolve) throw new Error('expected a question');
    s.submit(started.question.answer);
    expect(() => s.submit(started.question.answer)).toThrow(/no turn in progress/);
  });

  it('cancels a turn without touching the chain — backing out is free', () => {
    const s = session('cancel');
    solveTurn(s, emberFlick);
    s.start(emberFlick, 3);
    s.cancel();
    expect(s.isPending).toBe(false);
    expect(s.chain.raw).toBe(1);
  });

  it('resets for a new battle', () => {
    const s = session('reset');
    for (let i = 0; i < 4; i++) solveTurn(s, emberFlick);
    s.reset();
    expect(s.chain.raw).toBe(0);
    expect(s.chain.best).toBe(0);
    expect(s.isPending).toBe(false);
  });

  it('resumes a chain handed in at construction', () => {
    const s = session('resume', new ChainState(5, 8));
    expect(s.chain.display).toBe(5);
    expect(s.chain.best).toBe(8);
    expect(solveTurn(s, emberFlick).chain).toBe(6);
  });

  it('replays identically from the same seed and the same inputs', () => {
    const run = (): MathOutcome[] => {
      const s = session('replay');
      const outcomes: MathOutcome[] = [];
      for (let i = 0; i < 30; i++) {
        const started = s.start(i % 3 === 0 ? bladeRitual : emberFlick, 3);
        if (started.autoResolve) throw new Error('expected a question');
        // Miss every fifth on purpose, so the drop path is part of the replay.
        outcomes.push(s.submit(started.question.answer + (i % 5 === 4 ? 1 : 0)));
      }
      return outcomes;
    };
    expect(run()).toEqual(run());
  });
});

describe('the battle engine seam', () => {
  it('produces exactly the BattleCommand the engine expects', () => {
    const s = session('command');
    const outcome = solveTurn(s, emberFlick);
    const command = toBattleCommand(outcome, 2);
    expect(command).toEqual({
      kind: 'move',
      slot: 2,
      solved: outcome.solved,
      chainMultiplier: outcome.chainMultiplier,
      powerScale: outcome.powerScale,
    });
    expect(Object.keys(command).sort()).toEqual([
      'chainMultiplier',
      'kind',
      'powerScale',
      'slot',
      'solved',
    ]);
  });

  it('drives a real battle turn, solved and dropped alike', () => {
    for (const solveIt of [true, false]) {
      const rng = new Rng('battle-seam');
      const ally = createSpirit('fawnix', 12, rng, { bound: true });
      const foe = createSpirit('gearbit', 10, rng);
      const battle = new Battle(dex, ally, foe, {
        kind: 'wild',
        seed: 'battle-seam',
        canFlee: true,
        canBind: true,
        sigilsOwned: 0,
      });

      const slot = 0;
      const move = dex.move(ally.moves[slot]!.move);
      const s = session('battle-math');
      const started = s.start(move, 1);
      if (started.autoResolve) throw new Error('expected a question');
      const outcome = s.submit(started.question.answer + (solveIt ? 0 : 1));

      battle.submit(toBattleCommand(outcome, slot));

      // A drop costs the multiplier, never the turn: the turn still ran either way.
      expect(battle.state.turn).toBe(1);
      expect(battle.state.log.length).toBeGreaterThan(1);
      expect(['awaiting-command', 'finish-window', 'lost']).toContain(battle.state.phase);
    }
  });
});
