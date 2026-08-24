/**
 * Status conditions — `sojutsu-battle-math.md` §7.
 *
 * Includes the document's deliberate fix to the Gen-1 permanent freeze (20% thaw per turn),
 * which it tells us to keep.
 */
import type { StatusKind } from './types.ts';
import type { Rng } from './rng.ts';

export interface StatusState {
  kind: StatusKind;
  /** Venom Curse's escalating counter, n. Resets on switch. */
  venomTurns: number;
  /** Remaining sleep turns. */
  sleepTurns: number;
  /** Confusion is a volatile condition, not a status — it stacks with one. */
  confusionTurns: number;
  flinched: boolean;
}

export function freshStatus(): StatusState {
  return { kind: 'none', venomTurns: 0, sleepTurns: 0, confusionTurns: 0, flinched: false };
}

/** A spirit may only carry one non-volatile status at a time. */
export function canApplyStatus(current: StatusKind, next: StatusKind): boolean {
  if (next === 'none') return false;
  return current === 'none';
}

export function applyStatus(state: StatusState, kind: StatusKind, rng: Rng): boolean {
  if (!canApplyStatus(state.kind, kind)) return false;
  state.kind = kind;
  if (kind === 'sleep') state.sleepTurns = rng.int(1, 7);
  if (kind === 'venom') state.venomTurns = 0;
  return true;
}

export function applyConfusion(state: StatusState, rng: Rng): boolean {
  if (state.confusionTurns > 0) return false;
  state.confusionTurns = rng.int(2, 5);
  return true;
}

/** Stages reset on switch-out, and so does the Venom counter (§7). */
export function onSwitchOut(state: StatusState): void {
  state.venomTurns = 0;
  state.confusionTurns = 0;
  state.flinched = false;
}

/* --------------------------------------------------------- end-of-turn chip */

export interface ChipResult {
  readonly damage: number;
  readonly message: string | null;
}

/**
 * End-of-turn damage over time.
 *
 * Minimum 1 damage per tick. `allowFaint` is false for weather-class chip, which per §7 must
 * not take a spirit below 1 HP; status chip may faint.
 */
export function endOfTurnChip(state: StatusState, maxHp: number, currentHp: number): ChipResult {
  switch (state.kind) {
    case 'poison': {
      const dmg = Math.max(1, Math.floor(maxHp / 8));
      return { damage: Math.min(dmg, currentHp), message: 'The poison bites.' };
    }
    case 'burn': {
      const dmg = Math.max(1, Math.floor(maxHp / 16));
      return { damage: Math.min(dmg, currentHp), message: 'The burn sears.' };
    }
    case 'venom': {
      state.venomTurns += 1;
      const dmg = Math.max(1, Math.floor((maxHp * state.venomTurns) / 16));
      return { damage: Math.min(dmg, currentHp), message: 'The venom curse deepens.' };
    }
    default:
      return { damage: 0, message: null };
  }
}

/* --------------------------------------------------------- action gating */

export interface ActionGate {
  /** False when the spirit cannot act this turn. */
  readonly canAct: boolean;
  /** Set when the spirit hits itself in confusion instead of acting. */
  readonly selfHit: boolean;
  readonly message: string | null;
}

/**
 * Resolves everything that can stop a spirit acting, in the order the spec implies:
 * freeze/sleep first (they can end), then flinch, then paralysis, then confusion.
 */
export function resolveActionGate(state: StatusState, rng: Rng, name: string): ActionGate {
  if (state.kind === 'freeze') {
    // §7: 20% thaw chance per turn — the fix for Gen-1's permanent freeze.
    if (rng.chance(0.2)) {
      state.kind = 'none';
      return { canAct: true, selfHit: false, message: `${name} thawed out.` };
    }
    return { canAct: false, selfHit: false, message: `${name} is frozen solid.` };
  }

  if (state.kind === 'sleep') {
    state.sleepTurns -= 1;
    if (state.sleepTurns <= 0) {
      state.kind = 'none';
      state.sleepTurns = 0;
      return { canAct: true, selfHit: false, message: `${name} woke up.` };
    }
    return { canAct: false, selfHit: false, message: `${name} is fast asleep.` };
  }

  if (state.flinched) {
    state.flinched = false;
    return { canAct: false, selfHit: false, message: `${name} flinched.` };
  }

  if (state.kind === 'paralysis' && rng.chance(0.25)) {
    return { canAct: false, selfHit: false, message: `${name} is paralysed and can't move.` };
  }

  if (state.confusionTurns > 0) {
    state.confusionTurns -= 1;
    if (state.confusionTurns <= 0) {
      return { canAct: true, selfHit: false, message: `${name} snapped out of its confusion.` };
    }
    if (rng.chance(1 / 3)) {
      return { canAct: false, selfHit: true, message: `${name} hurt itself in confusion.` };
    }
    return { canAct: true, selfHit: false, message: `${name} is confused.` };
  }

  return { canAct: true, selfHit: false, message: null };
}

/** Paralysis quarters Speed (§7). */
export function speedMultiplier(kind: StatusKind): number {
  return kind === 'paralysis' ? 0.25 : 1;
}

/** Capture bonus per §9. */
export function statusCaptureBonus(kind: StatusKind): number {
  switch (kind) {
    case 'sleep':
    case 'freeze':
      return 2.5;
    case 'paralysis':
    case 'poison':
    case 'venom':
    case 'burn':
      return 1.5;
    default:
      return 1;
  }
}

export function statusLabel(kind: StatusKind): string | null {
  switch (kind) {
    case 'poison':
      return 'PSN';
    case 'venom':
      return 'VNM';
    case 'burn':
      return 'BRN';
    case 'paralysis':
      return 'PAR';
    case 'sleep':
      return 'SLP';
    case 'freeze':
      return 'FRZ';
    default:
      return null;
  }
}
