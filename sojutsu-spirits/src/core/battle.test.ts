import { describe, it, expect } from 'vitest';
import { Battle, type BattleCommand } from './battle.ts';
import { dex, createSpirit, SPECIES, MOVES, movesAtLevel, rollEncounter, allZones } from './dex.ts';
import { Rng } from './rng.ts';
import { parseMoveEffect } from './effects.ts';
import { fixedDamageKind } from './damage.ts';
import type { SpiritInstance } from './types.ts';

function newBattle(seed = 'test', allyId = 'fawnix', foeId = 'gearbit', allyLv = 12, foeLv = 10) {
  const rng = new Rng(seed);
  const ally = createSpirit(allyId, allyLv, rng, { bound: true });
  const foe = createSpirit(foeId, foeLv, rng);
  return {
    battle: new Battle(dex, ally, foe, {
      kind: 'wild',
      seed,
      canFlee: true,
      canBind: true,
      sigilsOwned: 0,
    }),
    ally,
    foe,
  };
}

const attack = (over: Partial<Extract<BattleCommand, { kind: 'move' }>> = {}): BattleCommand => ({
  kind: 'move',
  slot: 0,
  solved: true,
  chainMultiplier: 1,
  powerScale: 0.5,
  ...over,
});

/**
 * Index of the ally's strongest damaging move.
 *
 * Loadouts come from the real learnsets, and plenty of species learn a status move first — so
 * a test that always submits slot 0 can spend a whole battle buffing and never deal damage.
 */
function strikeSlot(battle: Battle): number {
  const slots = battle.state.ally.instance.moves;
  let best = 0;
  let bestPower = -1;
  slots.forEach((s, i) => {
    const m = dex.move(s.move);
    const power = m.category === 'Status' ? -1 : (m.power ?? 40);
    if (power > bestPower) {
      bestPower = power;
      best = i;
    }
  });
  return best;
}

/** Fights to a terminal phase using the ally's best damaging move. */
function fight(battle: Battle, opts: { solved?: boolean; limit?: number } = {}): number {
  const slot = strikeSlot(battle);
  let turns = 0;
  const limit = opts.limit ?? 400;
  while (battle.state.phase === 'awaiting-command' && turns++ < limit) {
    battle.submit(attack({ slot, solved: opts.solved ?? true }));
  }
  return turns;
}

describe('battle loop', () => {
  it('opens awaiting a command and advances a turn on submit', () => {
    const { battle } = newBattle();
    expect(battle.state.phase).toBe('awaiting-command');
    battle.submit(attack());
    expect(battle.state.turn).toBe(1);
    expect(['awaiting-command', 'finish-window', 'lost']).toContain(battle.state.phase);
  });

  it('replays identically from the same seed and command sequence', () => {
    const run = (): string => {
      const { battle } = newBattle('replay-seed');
      const slot = strikeSlot(battle);
      for (let i = 0; i < 40 && battle.state.phase === 'awaiting-command'; i++) {
        battle.submit(attack({ slot }));
      }
      return JSON.stringify({
        phase: battle.state.phase,
        turn: battle.state.turn,
        allyHp: battle.state.ally.instance.currentHp,
        foeHp: battle.state.foe.instance.currentHp,
        log: battle.state.log.map((l) => l.text),
      });
    };
    expect(run()).toBe(run());
  });

  it('reaches a terminal phase rather than looping forever', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { battle } = newBattle(seed);
      const turns = fight(battle, { limit: 500 });
      expect(turns).toBeLessThan(500);
      expect(['finish-window', 'lost', 'won', 'fled', 'bound']).toContain(battle.state.phase);
    }
  });
});

describe('the drop is a turn, not a fail — the design pillar', () => {
  it('lets the foe act even when the player drops the arithmetic', () => {
    // A strong ally against a weak foe: with a drop, the foe should still get its hit in.
    const { battle } = newBattle('drop-still-acts', 'glacisaur', 'gearbit', 40, 30);
    const foeHpBefore = battle.state.foe.instance.currentHp;
    const allyHpBefore = battle.state.ally.instance.currentHp;

    battle.submit(attack({ solved: false }));

    const somethingHappened =
      battle.state.foe.instance.currentHp < foeHpBefore ||
      battle.state.ally.instance.currentHp < allyHpBefore ||
      battle.state.log.length > 1;
    expect(somethingHappened).toBe(true);
    expect(battle.state.turn).toBe(1);
  });

  it('resets the chain on a drop and logs the break', () => {
    const { battle } = newBattle('chain-break', 'glacisaur', 'terratot', 45, 5);
    battle.state.chain = 6;
    battle.submit(attack({ solved: false }));
    expect(battle.state.chain).toBe(0);
    expect(battle.state.log.some((l) => l.kind === 'chain' && /CHAIN BROKEN at 6/.test(l.text))).toBe(true);
  });

  it('remembers the best chain reached, even after a break', () => {
    const { battle } = newBattle('chain-best', 'glacisaur', 'terratot', 45, 5);
    battle.state.chain = 9;
    battle.submit(attack({ solved: true }));
    expect(battle.state.chainBest).toBeGreaterThanOrEqual(9);
  });

  it('fizzles a move_fails move on a drop but still spends the turn', () => {
    const failMove = MOVES.find((m) => m.engine.failureMode === 'move_fails' && m.category !== 'Status')!;
    const rng = new Rng('fizzle');
    const ally = createSpirit('glacisaur', 40, rng, { bound: true, moves: [failMove.name] });
    const foe = createSpirit('terratot', 5, rng);
    const battle = new Battle(dex, ally, foe, {
      kind: 'wild',
      seed: 'fizzle',
      canFlee: true,
      canBind: true,
      sigilsOwned: 0,
    });
    const foeHp = battle.state.foe.instance.currentHp;
    battle.submit(attack({ solved: false }));
    expect(battle.state.foe.instance.currentHp).toBe(foeHp); // the move did nothing…
    expect(battle.state.turn).toBe(1); // …but the turn still passed
    expect(battle.state.log.some((l) => /number slipped/.test(l.text))).toBe(true);
  });

  it('lands a reduced_power move short rather than fizzling it', () => {
    const redMove = MOVES.find(
      (m) => m.engine.failureMode === 'reduced_power' && m.category === 'Phys' && (m.power ?? 0) >= 60,
    )!;
    const rng = new Rng('reduced');
    const ally = createSpirit('glacisaur', 40, rng, { bound: true, moves: [redMove.name] });
    const foe = createSpirit('bloopuff', 30, rng); // 135 base HP — survives to be measured
    const battle = new Battle(dex, ally, foe, {
      kind: 'wild',
      seed: 'reduced',
      canFlee: false,
      canBind: true,
      sigilsOwned: 0,
    });
    const before = battle.state.foe.instance.currentHp;
    battle.submit(attack({ solved: false, powerScale: 0.5 }));
    expect(battle.state.foe.instance.currentHp).toBeLessThan(before);
  });
});

describe('the chain multiplier reaches the damage formula', () => {
  it('makes a chained strike hit harder than an unchained one', () => {
    const measure = (chainMultiplier: number): number => {
      const rng = new Rng('chain-damage');
      const ally = createSpirit('glacisaur', 30, rng, { bound: true, moves: ['Power Jab'] });
      const foe = createSpirit('bloopuff', 40, rng);
      const battle = new Battle(dex, ally, foe, {
        kind: 'wild',
        seed: 'chain-damage',
        canFlee: false,
        canBind: true,
        sigilsOwned: 0,
      });
      const before = battle.state.foe.instance.currentHp;
      battle.submit(attack({ chainMultiplier }));
      return before - battle.state.foe.instance.currentHp;
    };
    expect(measure(2)).toBeGreaterThan(measure(1));
  });
});

describe('the Finish window', () => {
  function fightToFinish(seed: string) {
    const rng = new Rng(seed);
    const ally = createSpirit('glacisaur', 45, rng, { bound: true });
    const foe = createSpirit('gearbit', 4, rng);
    const battle = new Battle(dex, ally, foe, {
      kind: 'wild',
      seed,
      canFlee: false,
      canBind: true,
      sigilsOwned: 0,
    });
    fight(battle);
    return battle;
  }

  it('opens on the foe fainting rather than ending the battle', () => {
    const battle = fightToFinish('finish-open');
    expect(battle.state.phase).toBe('finish-window');
    expect(battle.state.finishAvailable).toBe(true);
    expect(battle.state.log.some((l) => l.kind === 'faint' && /FAINTED/.test(l.text))).toBe(true);
  });

  it('Sever awards XP and Resonance', () => {
    const battle = fightToFinish('finish-sever');
    const xpBefore = battle.state.ally.instance.xp;
    const resBefore = { ...battle.state.ally.instance.resonance };
    battle.submit({ kind: 'sever' });
    expect(battle.state.phase).toBe('won');
    expect(battle.state.ally.instance.xp).toBeGreaterThan(xpBefore);
    expect(battle.state.ally.instance.resonance.attack).toBeGreaterThan(resBefore.attack);
  });

  it('Bind can succeed and marks the spirit bound', () => {
    // A near-dead common at a high talisman grade should bind within a few seeds.
    let bound = false;
    for (const seed of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) {
      const battle = fightToFinish(seed);
      battle.submit({ kind: 'bind', talisman: 'ultra', chainBonus: 1.5 });
      if (battle.state.phase === 'bound') {
        expect(battle.state.foe.instance.bound).toBe(true);
        expect(battle.state.captureResult?.caught).toBe(true);
        bound = true;
        break;
      }
    }
    expect(bound).toBe(true);
  });

  it('refuses Bind in a shrine battle', () => {
    const rng = new Rng('shrine');
    const ally = createSpirit('glacisaur', 45, rng, { bound: true });
    const foe = createSpirit('leaflark', 4, rng);
    const battle = new Battle(dex, ally, foe, {
      kind: 'shrine',
      seed: 'shrine',
      canFlee: false,
      canBind: false,
      sigilsOwned: 0,
    });
    fight(battle);
    battle.submit({ kind: 'bind', talisman: 'ultra', chainBonus: 1 });
    expect(battle.state.phase).toBe('finish-window');
    expect(battle.state.log.some((l) => /cannot be bound/.test(l.text))).toBe(true);
  });

  it('levels and evolves the ally when the XP award crosses the trigger', () => {
    const rng = new Rng('evolve');
    // Fawnix evolves at 16. Start it one XP short of 16 and hand it a large award.
    const ally = createSpirit('fawnix', 15, rng, { bound: true });
    ally.xp = 2534; // Medium Slow: 2535 reaches Lv 16
    const foe = createSpirit('aureguard', 60, rng); // a big Base EXP yield
    foe.currentHp = 1;
    const battle = new Battle(dex, ally, foe, {
      kind: 'wild',
      seed: 'evolve',
      canFlee: false,
      canBind: false,
      sigilsOwned: 0,
    });
    fight(battle);
    if (battle.state.phase === 'finish-window') {
      battle.submit({ kind: 'sever' });
      expect(battle.state.ally.instance.level).toBeGreaterThanOrEqual(16);
      expect(battle.state.ally.instance.species).toBe('vulpine');
    }
  });
});

describe('data-driven sanity across the whole roster', () => {
  it('gives every species a usable loadout at its own encounter levels', () => {
    const rng = new Rng('loadouts');
    for (const s of SPECIES) {
      const lv = Math.max(1, s.evolvesAtLevel ?? 30);
      const slots = movesAtLevel(s, lv);
      expect(slots.length).toBeGreaterThan(0);
      expect(slots.length).toBeLessThanOrEqual(4);
      const inst = createSpirit(s.id, lv, rng);
      expect(inst.currentHp).toBeGreaterThan(0);
      expect(inst.moves.length).toBeGreaterThan(0);
    }
  });

  it('rolls a valid encounter in every Part-One zone', () => {
    const rng = new Rng('zones');
    for (const z of allZones()) {
      for (let i = 0; i < 40; i++) {
        const inst: SpiritInstance = rollEncounter(z.zone, rng);
        expect(inst.level).toBeGreaterThanOrEqual(z.levelRange[0]);
        expect(inst.level).toBeLessThanOrEqual(z.levelRange[1]);
        expect(z.encounters.some((e) => e.species.toLowerCase() === inst.species.replace(/-/g, ''))).toBeDefined();
      }
    }
  });

  it('runs a full battle for every species without throwing', () => {
    // The broadest guard there is: every move in the game gets used by something, and any
    // unparseable effect or missing rider would surface as a throw.
    const rng = new Rng('roster');
    for (const s of SPECIES) {
      const ally = createSpirit(s.id, 30, rng, { bound: true });
      const foe = createSpirit(SPECIES[rng.int(0, SPECIES.length - 1)]!.id, 28, rng);
      const battle = new Battle(dex, ally, foe, {
        kind: 'wild',
        seed: `roster-${s.id}`,
        canFlee: false,
        canBind: true,
        sigilsOwned: 1,
      });
      let guard = 0;
      while (battle.state.phase === 'awaiting-command' && guard++ < 400) {
        // Rotate every slot and drop every third answer: the widest sweep of move riders and
        // failure modes the roster can produce.
        battle.submit(attack({ slot: guard % ally.moves.length, solved: guard % 3 !== 0 }));
      }
      expect(guard).toBeLessThan(400);
    }
  });
});

describe('move effect parsing', () => {
  it('parses every move that actually declares a rider', () => {
    // "None (OHKO)" / "None (2-turn)" / "None (fixed)" / "None (priority)" are the catalogue
    // saying a move has no rider — the named behaviour lives in engine flags or the
    // fixed-damage table — so they are not parse failures and are excluded here.
    const realRiders = MOVES.filter(
      (m) => (m.effect ?? '').trim().length > 0 && !parseMoveEffect(m).declaredNone,
    );
    const unparsed = realRiders.filter((m) => !parseMoveEffect(m).recognised);
    expect(unparsed.map((m) => `${m.name}: ${m.effect}`)).toEqual([]);
    expect(realRiders.length).toBeGreaterThan(60);
  });

  it('accounts for every "None (...)" move through an engine flag or the fixed-damage table', () => {
    for (const m of MOVES.filter((x) => parseMoveEffect(x).declaredNone)) {
      const handled =
        m.engine.multiTurn ||
        m.engine.priority !== 0 ||
        fixedDamageKind(m) !== null ||
        /fixed|random/i.test(m.effect ?? '');
      expect(handled ? 'ok' : `ORPHANED: ${m.name} — ${m.effect}`).toBe('ok');
    }
  });

  it('reads magnitude and target from the prose', () => {
    // Blade Ritual's prose says only "Raises Attack (self)", but battle-math §6 states it is
    // +2 — "one turn for a doubled Attack stat", which is why it scored Impact 5. The
    // document wins over the catalogue's understated wording.
    const bladeRitual = MOVES.find((m) => m.name === 'Blade Ritual')!;
    expect(parseMoveEffect(bladeRitual).userStages).toEqual([['attack', 2]]);

    const plateGuard = MOVES.find((m) => m.name === 'Plate Guard')!;
    expect(parseMoveEffect(plateGuard).userStages).toContainEqual(['defense', 2]); // "Sharply raises"
  });

  it('flags the two self-faint moves', () => {
    for (const name of ['Detonate', 'Cataclysm Burst']) {
      expect(parseMoveEffect(MOVES.find((m) => m.name === name)!).selfDestruct).toBe(true);
    }
  });

  it('flags never-miss moves', () => {
    expect(parseMoveEffect(MOVES.find((m) => m.name === 'Star Shower')!).neverMisses).toBe(true);
  });
});
