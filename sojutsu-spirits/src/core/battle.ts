/**
 * The battle state machine.
 *
 * Pure and seeded: given the same seed and the same sequence of `BattleCommand`s, a battle
 * replays exactly. The Phaser layer only ever reads `BattleState` and pushes commands; it never
 * computes damage, and it cannot desynchronise the simulation by dropping a frame.
 *
 * Implements the ordering in `sojutsu-battle-math.md` §8, with the math layer's chain
 * multiplier fed in as an input to §2.
 */
import type {
  MoveDef,
  SpeciesDef,
  SpiritInstance,
  StageKey,
  StatusKind,
  TalismanKind,
} from './types.ts';
import { Rng } from './rng.ts';
import { computeStats, awardResonance } from './stats.ts';
import {
  computeDamage,
  computeFixedDamage,
  fixedDamageKind,
  rollCrit,
  recoilDamage,
  drainHeal,
  type Combatant,
} from './damage.ts';
import { aspectMultiplier, effectivenessMessage } from './aspects.ts';
import { freshStages, hitChance, applyStage, type Stages } from './stages.ts';
import {
  freshStatus,
  applyStatus,
  applyConfusion,
  endOfTurnChip,
  resolveActionGate,
  speedMultiplier,
  onSwitchOut,
  type StatusState,
} from './status.ts';
import { statStageMultiplier } from './stages.ts';
import { attemptCapture, attemptFlee, type CaptureResult } from './capture.ts';
import { xpAward, checkEvolution, levelFromXp } from './progression.ts';
import { parseMoveEffect, type ParsedEffect } from './effects.ts';

export type Side = 'ally' | 'foe';

export interface BattleDex {
  species(id: string): SpeciesDef;
  move(nameOrId: string): MoveDef;
}

/** A spirit as the battle sees it: the persistent instance plus per-battle volatile state. */
export interface Fighter {
  readonly side: Side;
  instance: SpiritInstance;
  species: SpeciesDef;
  stages: Stages;
  status: StatusState;
  /** Physical damage taken this turn — Retaliate's input. */
  damageTakenThisTurn: number;
  /** Set while a multi-turn move is charging. */
  charging: { move: string; turnsLeft: number } | null;
  /** The last move this fighter used — Mirror Act's input. */
  lastMoveUsed: string | null;
  /** True once this fighter has been on the field, for XP participation. */
  participated: boolean;
}

export type BattleKind = 'wild' | 'trainer' | 'shrine';

export interface BattleOptions {
  readonly kind: BattleKind;
  readonly seed: number | string;
  readonly canFlee: boolean;
  /** Wild battles allow Bind; shrine and trainer battles force Sever. */
  readonly canBind: boolean;
  readonly sigilsOwned: number;
  readonly foeName?: string;
}

export type BattlePhase =
  | 'intro'
  | 'awaiting-command'
  | 'resolving'
  | 'finish-window'
  | 'won'
  | 'lost'
  | 'fled'
  | 'bound';

export interface BattleLogEntry {
  readonly text: string;
  readonly kind: 'info' | 'damage' | 'status' | 'chain' | 'faint' | 'capture' | 'system';
}

export interface BattleState {
  phase: BattlePhase;
  turn: number;
  ally: Fighter;
  foe: Fighter;
  log: BattleLogEntry[];
  /** Live chain, owned by the math layer but stored here so a replay carries it. */
  chain: number;
  chainBest: number;
  /** Set while the Finish window is open, after the foe faints. */
  finishAvailable: boolean;
  xpPending: number;
  moneyPending: number;
  captureResult: CaptureResult | null;
  fleeAttempts: number;
}

export type BattleCommand =
  | { kind: 'move'; slot: number; solved: boolean; chainMultiplier: number; powerScale: number }
  | { kind: 'bind'; talisman: TalismanKind; chainBonus: number }
  | { kind: 'sever' }
  | { kind: 'flee' }
  | { kind: 'switch'; uid: string };

export class Battle {
  readonly rng: Rng;
  readonly state: BattleState;
  private readonly dex: BattleDex;
  private readonly opts: BattleOptions;

  constructor(dex: BattleDex, ally: SpiritInstance, foe: SpiritInstance, opts: BattleOptions) {
    this.dex = dex;
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    this.state = {
      phase: 'intro',
      turn: 0,
      ally: this.makeFighter('ally', ally),
      foe: this.makeFighter('foe', foe),
      log: [],
      chain: 0,
      chainBest: 0,
      finishAvailable: false,
      xpPending: 0,
      moneyPending: 0,
      captureResult: null,
      fleeAttempts: 0,
    };
    this.say(`A wild ${this.state.foe.species.name} bars the way.`, 'system');
    this.state.phase = 'awaiting-command';
  }

  private makeFighter(side: Side, instance: SpiritInstance): Fighter {
    return {
      side,
      instance,
      species: this.dex.species(instance.species),
      stages: freshStages(),
      status: { ...freshStatus(), kind: instance.status, venomTurns: instance.venomTurns, sleepTurns: instance.sleepTurns },
      damageTakenThisTurn: 0,
      charging: null,
      lastMoveUsed: null,
      participated: side === 'ally',
    };
  }

  private say(text: string, kind: BattleLogEntry['kind'] = 'info'): void {
    this.state.log.push({ text, kind });
  }

  /* ------------------------------------------------------------- accessors */

  stats(f: Fighter) {
    return computeStats(f.species.base, f.instance.grade, f.instance.resonance, f.instance.level);
  }

  combatant(f: Fighter): Combatant {
    const s = this.stats(f);
    return {
      level: f.instance.level,
      aspects: f.species.aspects,
      attack: s.attack,
      defense: s.defense,
      speed: s.speed,
      special: s.special,
      maxHp: s.maxHp,
      currentHp: f.instance.currentHp,
      stageAttack: f.stages.attack,
      stageDefense: f.stages.defense,
      stageSpecial: f.stages.special,
      burned: f.status.kind === 'burn',
    };
  }

  /** Effective Speed after paralysis and stage modifiers — the §8 tie-break input. */
  effectiveSpeed(f: Fighter): number {
    const base = this.stats(f).speed;
    return Math.max(1, Math.floor(base * statStageMultiplier(f.stages.speed) * speedMultiplier(f.status.kind)));
  }

  maxHp(f: Fighter): number {
    return this.stats(f).maxHp;
  }

  /* ------------------------------------------------------------ turn entry */

  /**
   * Runs one full turn: player action, foe action, end-of-turn chip.
   *
   * `command.solved` is the arithmetic result from the math layer. A drop never skips the
   * turn — it changes how the move lands and resets the chain, and the foe still acts. That is
   * the game's design pillar ("a drop isn't a fail, it's a turn"), enforced here rather than in
   * the UI so it cannot be undone by a presentation change.
   */
  submit(command: BattleCommand): void {
    if (this.state.phase === 'finish-window') {
      this.resolveFinish(command);
      return;
    }
    if (this.state.phase !== 'awaiting-command') return;

    this.state.phase = 'resolving';
    this.state.turn += 1;
    this.state.ally.damageTakenThisTurn = 0;
    this.state.foe.damageTakenThisTurn = 0;

    switch (command.kind) {
      case 'flee':
        if (this.tryFlee()) return;
        this.foeTurn();
        break;
      case 'move':
        this.resolveTurnWithMove(command);
        break;
      case 'bind':
      case 'sever':
      case 'switch':
        // Binding is only legal in the Finish window; switching is not modelled in v1's
        // single-spirit encounters and falls through to the foe's turn.
        this.foeTurn();
        break;
    }

    this.endOfTurn();
  }

  private resolveTurnWithMove(cmd: Extract<BattleCommand, { kind: 'move' }>): void {
    const ally = this.state.ally;
    const slot = ally.instance.moves[cmd.slot];
    if (!slot) {
      this.say('No move in that slot.', 'system');
      this.state.phase = 'awaiting-command';
      return;
    }

    const move = this.dex.move(slot.move);

    // Chain bookkeeping happens before anything can faint, so the log reads in the right order.
    if (cmd.solved) {
      this.state.chainBest = Math.max(this.state.chainBest, this.state.chain);
    } else if (this.state.chain > 0) {
      this.say(`CHAIN BROKEN at ${this.state.chain}.`, 'chain');
      this.state.chain = 0;
    }

    const allyFirst = this.movesFirst(move, cmd.solved);

    if (allyFirst) {
      this.useMove(ally, this.state.foe, move, cmd);
      if (!this.checkFaints()) this.foeTurn();
    } else {
      this.foeTurn();
      if (!this.checkFaints()) this.useMove(ally, this.state.foe, move, cmd);
    }
  }

  /** §8: priority, then effective Speed, then random. */
  private movesFirst(allyMove: MoveDef, _solved: boolean): boolean {
    const foeMove = this.chooseFoeMove();
    const ap = allyMove.engine.priority;
    const fp = foeMove ? foeMove.engine.priority : 0;
    if (ap !== fp) return ap > fp;

    const as = this.effectiveSpeed(this.state.ally);
    const fs = this.effectiveSpeed(this.state.foe);
    if (as !== fs) return as > fs;
    return this.rng.chance(0.5);
  }

  private pendingFoeMove: MoveDef | null = null;

  /** The foe picks once per turn and remembers it, so speed comparison and use agree. */
  private chooseFoeMove(): MoveDef | null {
    if (this.pendingFoeMove) return this.pendingFoeMove;
    const foe = this.state.foe;
    const usable = foe.instance.moves.filter((m) => m.pp > 0);
    if (usable.length === 0) return null;

    // A simple but not stupid AI: prefer the move with the best expected damage, with a
    // little noise so a shrine ace is not perfectly predictable.
    const scored = usable.map((slot) => {
      const move = this.dex.move(slot.move);
      const eff = aspectMultiplier(move.aspect, this.state.ally.species.aspects);
      const power = move.power ?? 40;
      const stabBonus = foe.species.aspects.includes(move.aspect) ? 1.5 : 1;
      const score = move.category === 'Status' ? 25 : power * eff * stabBonus;
      return { move, score: score * (0.85 + this.rng.float() * 0.3) };
    });
    scored.sort((a, b) => b.score - a.score);
    this.pendingFoeMove = scored[0]!.move;
    return this.pendingFoeMove;
  }

  private foeTurn(): void {
    const move = this.chooseFoeMove();
    this.pendingFoeMove = null;
    if (!move) {
      this.say(`${this.state.foe.species.name} has no strength left to strike.`);
      return;
    }
    // The foe never does arithmetic — only a Sojutsuka's bound spirit needs the number.
    this.useMove(this.state.foe, this.state.ally, move, {
      kind: 'move',
      slot: 0,
      solved: true,
      chainMultiplier: 1,
      powerScale: 1,
    });
  }

  /* ------------------------------------------------------------- move use */

  private useMove(
    user: Fighter,
    target: Fighter,
    move: MoveDef,
    cmd: Extract<BattleCommand, { kind: 'move' }>,
  ): void {
    const gate = resolveActionGate(user.status, this.rng, user.species.name);
    if (gate.message) this.say(gate.message, 'status');
    if (gate.selfHit) {
      const self = this.combatant(user);
      const dmg = Math.max(1, Math.floor((((Math.floor((2 * user.instance.level) / 5 + 2) * 40 * self.attack) / self.defense) / 50) + 2));
      this.damage(user, dmg);
      return;
    }
    if (!gate.canAct) return;

    // A dropped `move_fails` fizzles before anything else happens.
    if (!cmd.solved && move.engine.failureMode === 'move_fails') {
      this.say(`${user.species.name}'s ${move.name} came apart — the number slipped.`, 'chain');
      this.spendPp(user, move);
      return;
    }

    this.spendPp(user, move);
    user.lastMoveUsed = move.id;

    // Multi-turn charge moves: first use charges, second resolves.
    if (move.engine.multiTurn && !user.charging) {
      user.charging = { move: move.id, turnsLeft: 1 };
      this.say(`${user.species.name} gathers itself.`);
      const parsed = parseMoveEffect(move);
      if (parsed.chargeDefenseUp) {
        applyStage(user.stages, 'defense', 1);
        this.say(`${user.species.name} braces. Defense rose.`, 'status');
      }
      return;
    }
    user.charging = null;

    const effect = parseMoveEffect(move);

    if (move.category === 'Status') {
      this.resolveStatusMove(user, target, move, effect);
      return;
    }

    // Accuracy check (§5). Never-miss moves bypass it.
    if (!effect.neverMisses) {
      const chance = hitChance(move.accuracy, user.stages.accuracy, target.stages.evasion);
      if (!this.rng.chance(chance)) {
        this.say(`${user.species.name}'s ${move.name} missed.`);
        return;
      }
    }

    const fixed = fixedDamageKind(move);
    let dealt = 0;

    if (fixed) {
      const value = computeFixedDamage(
        fixed,
        {
          attacker: this.combatant(user),
          defender: this.combatant(target),
          damageTakenThisTurn: user.damageTakenThisTurn,
        },
        this.rng,
      );
      if (value === null) {
        this.say(`${move.name} failed.`);
        return;
      }
      // Fixed-damage moves still respect Aspect immunity.
      if (aspectMultiplier(move.aspect, target.species.aspects) === 0) {
        this.say('It has no effect.');
        return;
      }
      dealt = this.damage(target, value);
    } else {
      const crit = rollCrit(this.rng, effect.highCrit ? 1 : 0);
      const result = computeDamage(move, move.power ?? 40, this.combatant(user), this.combatant(target), this.rng, {
        crit,
        chainMultiplier: user.side === 'ally' ? cmd.chainMultiplier : 1,
        powerScale: user.side === 'ally' && !cmd.solved ? cmd.powerScale : 1,
        halveDefense: effect.selfDestruct,
      });

      if (result.noEffect) {
        this.say('It has no effect.');
        return;
      }

      dealt = this.damage(target, result.damage);
      if (result.crit) this.say('A critical strike!', 'damage');
      const msg = effectivenessMessage(result.aspectMultiplier);
      if (msg) this.say(msg, 'damage');
      if (user.side === 'ally' && cmd.chainMultiplier > 1) {
        this.say(`Chain ×${cmd.chainMultiplier.toFixed(1)}.`, 'chain');
      }
    }

    if (!cmd.solved && move.engine.failureMode === 'reduced_power' && user.side === 'ally') {
      this.say('The strike landed short.', 'chain');
    }

    // Post-hit riders.
    if (effect.recoil && dealt > 0) {
      const r = recoilDamage(dealt);
      if (r > 0) {
        this.damage(user, r);
        this.say(`${user.species.name} is hurt by the recoil.`, 'damage');
      }
    }
    if (effect.drain && dealt > 0) {
      this.heal(user, drainHeal(dealt));
      this.say(`${user.species.name} draws strength from the wound.`, 'status');
    }
    if (effect.selfDestruct) {
      user.instance.currentHp = 0;
      this.say(`${user.species.name} tore itself apart.`, 'faint');
    }
    if (effect.inflicts && dealt > 0 && this.rng.chance(effect.inflictChance)) {
      if (applyStatus(target.status, effect.inflicts, this.rng)) {
        target.instance.status = effect.inflicts;
        this.say(`${target.species.name} is ${statusVerb(effect.inflicts)}.`, 'status');
      }
    }
    if (effect.confuses && dealt > 0 && this.rng.chance(effect.inflictChance)) {
      if (applyConfusion(target.status, this.rng)) this.say(`${target.species.name} is confused.`, 'status');
    }
    if (effect.flinch && dealt > 0 && this.rng.chance(effect.inflictChance)) {
      target.status.flinched = true;
    }
    for (const [key, delta] of effect.targetStages) {
      const res = applyStage(target.stages, key, delta);
      if (res.applied !== 0) this.say(stageMessage(target.species.name, key, delta), 'status');
    }
  }

  private resolveStatusMove(user: Fighter, target: Fighter, move: MoveDef, effect: ParsedEffect): void {
    let didSomething = false;

    for (const [key, delta] of effect.userStages) {
      const res = applyStage(user.stages, key, delta);
      if (res.applied !== 0) {
        this.say(stageMessage(user.species.name, key, delta), 'status');
        didSomething = true;
      } else if (res.atLimit) {
        this.say(`${user.species.name}'s ${key} won't go any higher.`, 'status');
      }
    }

    for (const [key, delta] of effect.targetStages) {
      const chance = hitChance(move.accuracy, user.stages.accuracy, target.stages.evasion);
      if (!this.rng.chance(chance)) {
        this.say(`${move.name} missed.`);
        return;
      }
      const res = applyStage(target.stages, key, delta);
      if (res.applied !== 0) {
        this.say(stageMessage(target.species.name, key, delta), 'status');
        didSomething = true;
      }
    }

    if (effect.inflicts) {
      const chance = hitChance(move.accuracy, user.stages.accuracy, target.stages.evasion);
      if (this.rng.chance(chance) && applyStatus(target.status, effect.inflicts, this.rng)) {
        target.instance.status = effect.inflicts;
        this.say(`${target.species.name} is ${statusVerb(effect.inflicts)}.`, 'status');
        didSomething = true;
      }
    }

    if (effect.confuses) {
      if (applyConfusion(target.status, this.rng)) {
        this.say(`${target.species.name} is confused.`, 'status');
        didSomething = true;
      }
    }

    if (effect.healsUser) {
      const healed = this.heal(user, Math.floor(this.maxHp(user) / 2));
      if (healed > 0) {
        this.say(`${user.species.name} steadies and recovers.`, 'status');
        didSomething = true;
      }
    }

    if (!didSomething) this.say(`${move.name} had no effect.`);
  }

  private spendPp(user: Fighter, move: MoveDef): void {
    const slot = user.instance.moves.find((m) => m.move === move.name || m.move === move.id);
    if (slot && slot.pp > 0) slot.pp -= 1;
  }

  /* ------------------------------------------------------- damage / health */

  private damage(f: Fighter, amount: number): number {
    const before = f.instance.currentHp;
    f.instance.currentHp = Math.max(0, before - Math.max(0, Math.floor(amount)));
    const dealt = before - f.instance.currentHp;
    f.damageTakenThisTurn += dealt;
    return dealt;
  }

  private heal(f: Fighter, amount: number): number {
    const max = this.maxHp(f);
    const before = f.instance.currentHp;
    f.instance.currentHp = Math.min(max, before + Math.max(0, Math.floor(amount)));
    return f.instance.currentHp - before;
  }

  /* ---------------------------------------------------------- end of turn */

  private endOfTurn(): void {
    if (this.checkFaints()) return;

    for (const f of [this.state.ally, this.state.foe]) {
      const chip = endOfTurnChip(f.status, this.maxHp(f), f.instance.currentHp);
      if (chip.damage > 0) {
        this.damage(f, chip.damage);
        if (chip.message) this.say(`${f.species.name}: ${chip.message}`, 'status');
      }
    }

    if (this.checkFaints()) return;
    this.state.phase = 'awaiting-command';
  }

  /**
   * Returns true when the battle moved out of the normal turn loop.
   *
   * A fainted foe does not end the battle — it opens the Finish window, which is where Bind and
   * Sever are chosen. See DESIGN.md [A-3].
   */
  private checkFaints(): boolean {
    const { ally, foe } = this.state;

    if (foe.instance.currentHp <= 0) {
      this.say(`${foe.species.name} FAINTED.`, 'faint');
      this.state.finishAvailable = true;
      this.state.phase = 'finish-window';
      return true;
    }

    if (ally.instance.currentHp <= 0) {
      this.say(`${ally.species.name} can fight no more.`, 'faint');
      this.state.phase = 'lost';
      return true;
    }

    return false;
  }

  /* -------------------------------------------------------- finish window */

  private resolveFinish(cmd: BattleCommand): void {
    if (cmd.kind === 'bind') {
      if (!this.opts.canBind) {
        this.say('This one cannot be bound.', 'system');
        return;
      }
      const foe = this.state.foe;
      const result = attemptCapture(
        {
          maxHp: this.maxHp(foe),
          currentHp: Math.max(1, foe.instance.currentHp),
          catchRate: foe.species.catchRate,
          talisman: cmd.talisman,
          status: foe.status.kind,
          chainBonus: cmd.chainBonus,
        },
        this.rng,
      );
      this.state.captureResult = result;
      if (result.caught) {
        this.say(`${foe.species.name} is bound.`, 'capture');
        foe.instance.bound = true;
        this.state.phase = 'bound';
      } else {
        this.say(`The talisman tore — ${result.shakes} of four.`, 'capture');
        // A failed bind ends the encounter; the spirit breaks away.
        this.awardSpoils();
        this.state.phase = 'won';
      }
      return;
    }

    if (cmd.kind === 'sever') {
      this.say('The spear falls.', 'faint');
      this.awardSpoils();
      this.state.phase = 'won';
    }
  }

  private awardSpoils(): void {
    const foe = this.state.foe;
    const ally = this.state.ally;

    this.state.xpPending = xpAward(foe.species.baseExpYield, foe.instance.level, 1, false);
    ally.instance.xp += this.state.xpPending;
    awardResonance(ally.instance.resonance, foe.species);

    const before = ally.instance.level;
    const after = levelFromXp(ally.species.growth, ally.instance.xp);
    if (after > before) {
      ally.instance.level = after;
      this.say(`${ally.species.name} reached Lv ${after}.`, 'system');
      const evo = checkEvolution(ally.species, after, true);
      if (evo.evolves && evo.into) {
        this.say(`${ally.species.name} is changing shape...`, 'system');
        ally.instance.species = evo.into;
      }
    }

    if (this.opts.kind !== 'wild') {
      this.state.moneyPending = foe.instance.level * 24 * (1 + this.opts.sigilsOwned * 0.5);
    }
  }

  private tryFlee(): boolean {
    if (!this.opts.canFlee) {
      this.say("There's no walking away from this one.", 'system');
      return false;
    }
    this.state.fleeAttempts += 1;
    const escaped = attemptFlee(
      this.effectiveSpeed(this.state.ally),
      this.effectiveSpeed(this.state.foe),
      this.state.fleeAttempts,
      this.rng,
    );
    if (escaped) {
      this.say('You broke away.', 'system');
      this.state.phase = 'fled';
      return true;
    }
    this.say("You couldn't get clear.", 'system');
    return false;
  }

  /** Applies the volatile battle state back onto the persistent instances. */
  commit(): void {
    for (const f of [this.state.ally, this.state.foe]) {
      f.instance.status = f.status.kind;
      f.instance.venomTurns = f.status.venomTurns;
      f.instance.sleepTurns = f.status.sleepTurns;
      onSwitchOut(f.status);
    }
  }
}

function statusVerb(kind: StatusKind): string {
  switch (kind) {
    case 'poison':
      return 'poisoned';
    case 'venom':
      return 'gripped by a venom curse';
    case 'burn':
      return 'burned';
    case 'paralysis':
      return 'paralysed';
    case 'sleep':
      return 'asleep';
    case 'freeze':
      return 'frozen';
    default:
      return 'unharmed';
  }
}

function stageMessage(name: string, key: StageKey, delta: number): string {
  const dir = delta > 0 ? 'rose' : 'fell';
  const amount = Math.abs(delta) >= 2 ? 'sharply ' : '';
  return `${name}'s ${key} ${amount}${dir}.`;
}
