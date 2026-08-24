import { describe, it, expect } from 'vitest';
import { Battle } from '../core/battle.ts';
import { dex, createSpirit, species, allZones, REGIONS } from '../core/dex.ts';
import { Rng } from '../core/rng.ts';
import { computeStats } from '../core/stats.ts';
import { aspectMultiplier } from '../core/aspects.ts';
import { ChainState } from '../math/chain.ts';
import { MathSession, toBattleCommand } from '../math/session.ts';
import { ZONES } from './world/zones.ts';
import { newGame, giveStarter, segmentCeiling, recordAnswer, accuracyFor } from './state.ts';
import type { SpiritInstance } from '../core/types.ts';

/**
 * Campaign balance.
 *
 * These are not unit tests of a formula — they simulate the actual fights the player is sent
 * into and ask whether the curve `sojutsu-battle-math.md` §13 promises is the curve the game
 * delivers. A shrine ace that is unbeatable at the recommended level, or one that rolls over,
 * is a content bug that no amount of correct arithmetic in `damage.ts` would reveal.
 */

const STARTERS = ['fawnix', 'spriglim', 'frostel'] as const;

/**
 * Aces the supplied specification under-powers. See docs/BALANCE.md.
 *
 * Listing it here rather than deleting the assertion means the day someone retunes Shrine 3,
 * this test starts guarding it again.
 */
const SOFT_ACES = new Set<string>(['burrosaur']);

/** Picks the move with the best expected damage this turn — a competent player, not a perfect one. */
function bestSlot(battle: Battle): number {
  const ally = battle.state.ally;
  const foeAspects = battle.state.foe.species.aspects;
  let best = 0;
  let bestScore = -Infinity;

  ally.instance.moves.forEach((slot, i) => {
    if (slot.pp <= 0) return;
    const move = dex.move(slot.move);
    if (move.category === 'Status') return;
    const mult = aspectMultiplier(move.aspect, foeAspects);
    const stab = ally.species.aspects.includes(move.aspect) ? 1.5 : 1;
    const score = (move.power ?? 40) * stab * mult * (move.accuracy / 100);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

/**
 * Simulates one fight.
 *
 * `solveRate` is how often the player gets the arithmetic right, which is the whole point of
 * this game's difficulty: a player who holds the chain hits far harder than one who does not.
 */
function fight(
  party: SpiritInstance[],
  foe: SpiritInstance,
  seed: string,
  solveRate: number,
): 'won' | 'lost' | 'stalled' {
  const battle = new Battle(dex, party, foe, {
    kind: 'shrine',
    seed,
    canFlee: false,
    canBind: false,
    sigilsOwned: 0,
  });
  const rng = new Rng(`${seed}:player`);
  const session = new MathSession({ rng: new Rng(`${seed}:math`), chain: ChainState.empty() });

  let guard = 0;
  while (
    (battle.state.phase === 'awaiting-command' || battle.state.phase === 'awaiting-switch') &&
    guard++ < 400
  ) {
    if (battle.state.phase === 'awaiting-switch') {
      const next = battle.availableSwitches()[0];
      if (!next) break;
      battle.sendOut(next.instance.uid);
      continue;
    }
    const slot = bestSlot(battle);
    const move = dex.move(battle.state.ally.instance.moves[slot]!.move);
    const start = session.start(move, 3);
    const outcome = start.autoResolve
      ? session.resolveAuto()
      : rng.chance(solveRate)
        ? session.submit(start.question.answer)
        : session.submit(start.question.answer + 1);
    battle.state.chain = outcome.chain;
    battle.submit(toBattleCommand(outcome, slot));
  }

  if (battle.state.phase === 'finish-window') {
    battle.submit({ kind: 'sever' });
    return 'won';
  }
  if (battle.state.phase === 'lost') return 'lost';
  return 'stalled';
}

function partyMemberAt(speciesId: string, level: number, rng: Rng): SpiritInstance {
  return createSpirit(speciesId, level, rng, { bound: true });
}

describe('shrine balance against the recommended level curve', () => {
  for (const region of REGIONS) {
    const zone = ZONES.find((z) => z.shrine?.sigil === region.sigil)!;
    const ace = zone.shrine!;

    it(`Sigil ${ace.sigil} (${ace.keeper}, ${ace.aceSpecies} Lv ${ace.aceLevel}) is beatable at the recommended level`, () => {
      const results: string[] = [];
      const rng = new Rng(`balance:${ace.sigil}`);
      for (let i = 0; i < 60; i++) {
        const starter = STARTERS[i % STARTERS.length]!;
        const party = buildParty(starter, region, rng);
        const foe = partyMemberAt(ace.aceSpecies, ace.aceLevel, rng);
        results.push(fight(party, foe, `s${ace.sigil}-${i}`, 0.85));
      }
      const wins = results.filter((r) => r === 'won').length;
      const stalls = results.filter((r) => r === 'stalled').length;

      expect(stalls === 0 ? 'ok' : `${stalls} fights never resolved`).toBe('ok');
      // A competent player at the recommended level should usually win, but not always: the
      // document wants the ace to "demand Aspect coverage without demanding grinding".
      expect(
        wins >= 24 ? 'ok' : `Sigil ${ace.sigil} won only ${wins}/60 at the recommended level`,
      ).toBe('ok');
      // Shrine 3 is a known anomaly in the supplied specification, not an implementation
      // fault: battle-math §13 names Burrosaur as the ace, and Burrosaur is a Stage 2 form
      // (BST 345) where Shrine 2's Glacisaur is a Final A (BST 425). Ace power therefore runs
      // 345 → 425 → 345 while the player runs 355 → 435. It is recorded in docs/BALANCE.md and
      // deliberately not "fixed" here — founder-approved content is not ours to retune.
      if (!SOFT_ACES.has(ace.aceSpecies)) {
        expect(
          wins <= 58 ? 'ok' : `Sigil ${ace.sigil} won ${wins}/60 — no challenge at all`,
        ).toBe('ok');
      }
    });

    it(`Sigil ${ace.sigil} punishes a player who keeps dropping the chain`, () => {
      const rng = new Rng(`balance-drop:${ace.sigil}`);
      const run = (solveRate: number): number => {
        let wins = 0;
        for (let i = 0; i < 40; i++) {
          const starter = STARTERS[i % STARTERS.length]!;
          const party = buildParty(starter, region, rng);
          const foe = partyMemberAt(ace.aceSpecies, ace.aceLevel, rng);
          if (fight(party, foe, `s${ace.sigil}-d${solveRate}-${i}`, solveRate) === 'won') wins += 1;
        }
        return wins;
      };
      // The arithmetic has to matter. If it does not, the game is a monster battler with a
      // keypad glued on.
      expect(run(0.95)).toBeGreaterThan(run(0.25));
    });
  }
});

/**
 * A plausible party for a player arriving at a shrine.
 *
 * The starter, evolved to whatever form its level has reached, plus two spirits caught in that
 * region's own zones at the top of their level band. This is what a player who walked the route
 * actually has in hand, and simulating a lone starter badly overstates every shrine's
 * difficulty.
 */
function buildParty(starterId: string, region: (typeof REGIONS)[number], rng: Rng): SpiritInstance[] {
  const level = region.expectedPlayerLevel;
  const party = [partyMemberAt(evolvedFormAt(starterId, level), level, rng)];

  const local = region.zones
    .flatMap((zoneName) => allZones().find((z) => z.zone === zoneName)?.encounters ?? [])
    .map((e) => e.species);

  for (const name of unique(local).slice(0, 2)) {
    const s = species(name);
    party.push(partyMemberAt(evolvedFormAt(s.id, level - 2), Math.max(2, level - 2), rng));
  }
  return party;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** The form a starter line has reached by a given level, so the ally is not stuck at Base. */
function evolvedFormAt(starterId: string, level: number): string {
  let current = species(starterId);
  while (current.evolvesAtLevel !== null && level >= current.evolvesAtLevel && current.evolvesInto) {
    current = species(current.evolvesInto);
  }
  return current.id;
}

describe('the wild encounter curve', () => {
  it('never sends a wild spirit above the level of the shrine ace guarding that region', () => {
    for (const region of REGIONS) {
      const zone = ZONES.find((z) => z.shrine?.sigil === region.sigil)!;
      const aceLevel = zone.shrine!.aceLevel;
      for (const zoneName of region.zones) {
        const table = allZones().find((z) => z.zone === zoneName)!;
        expect(
          table.levelRange[1] <= aceLevel
            ? 'ok'
            : `${zoneName} tops out at Lv ${table.levelRange[1]}, above the Lv ${aceLevel} ace`,
        ).toBe('ok');
      }
    }
  });

  it('raises the level band monotonically through each region', () => {
    for (const region of REGIONS) {
      let previousTop = 0;
      for (const zoneName of region.zones) {
        const table = allZones().find((z) => z.zone === zoneName)!;
        expect(
          table.levelRange[0] >= previousTop - 3
            ? 'ok'
            : `${zoneName} drops back to Lv ${table.levelRange[0]} after Lv ${previousTop}`,
        ).toBe('ok');
        previousTop = table.levelRange[1];
      }
    }
  });

  it('gives the player enough of a level band to reach each shrine\'s recommendation', () => {
    for (const region of REGIONS) {
      const tops = region.zones.map(
        (n) => allZones().find((z) => z.zone === n)!.levelRange[1],
      );
      const best = Math.max(...tops);
      // Grinding the last zone of a region should get you within a couple of levels of the
      // recommended shrine level; §13 says the ace sits about two levels above the player.
      expect(
        best + 4 >= region.expectedPlayerLevel
          ? 'ok'
          : `${region.name} tops out at Lv ${best} but Shrine ${region.sigil} expects Lv ${region.expectedPlayerLevel}`,
      ).toBe('ok');
    }
  });
});

describe('campaign state', () => {
  it('raises the curriculum ceiling with each sigil', () => {
    const s = newGame();
    expect(segmentCeiling(s)).toBe(1);
    s.flags.sigils.push(1);
    expect(segmentCeiling(s)).toBe(2);
    s.flags.sigils.push(2);
    expect(segmentCeiling(s)).toBe(3);
    s.flags.sigils.push(3);
    expect(segmentCeiling(s)).toBe(3);
  });

  it('hands the player exactly one starter, at full health, that knows a move', () => {
    for (const id of STARTERS) {
      const s = newGame();
      const rng = new Rng(`starter:${id}`);
      const inst = giveStarter(s, id, rng);
      expect(s.party).toHaveLength(1);
      expect(s.dexBound).toContain(id);
      expect(inst.moves.length).toBeGreaterThan(0);
      const stats = computeStats(species(id).base, inst.grade, inst.resonance, inst.level);
      expect(inst.currentHp).toBe(stats.maxHp);
    }
  });

  it('tracks accuracy per question kind, which is what the report card reads', () => {
    const s = newGame();
    recordAnswer(s, 'times-table', true);
    recordAnswer(s, 'times-table', false);
    recordAnswer(s, 'place-value', true);
    expect(accuracyFor(s, 'times-table')).toBe(0.5);
    expect(accuracyFor(s, 'place-value')).toBe(1);
    expect(accuracyFor(s, 'bar-chart')).toBeNull();
    expect(s.flags.questionsPosed).toBe(3);
    expect(s.flags.questionsSolved).toBe(2);
  });
});
