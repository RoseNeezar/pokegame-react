/**
 * Player state and persistence.
 *
 * One serialisable object holds everything a save file needs. It is deliberately plain data —
 * no class instances, no Phaser objects — so `JSON.stringify` is the whole save format and a
 * save written by one build can be read by the next.
 */
import type { SpiritInstance, TalismanKind } from '../core/types.ts';
import { createSpirit, species } from '../core/dex.ts';
import { computeStats } from '../core/stats.ts';
import { Rng } from '../core/rng.ts';

export const SAVE_KEY = 'sojutsu-spirits/save/v1';
export const SAVE_VERSION = 1;

/** Max party size — the Bound Circle, six per battle-math §0. */
export const BOUND_CIRCLE_MAX = 6;

export interface BagState {
  talismans: Record<TalismanKind, number>;
  salve: number;
  balm: number;
  antidote: number;
  wardCharm: number;
}

export interface StoryFlags {
  /** Set once the player has chosen a starter. */
  starterChosen: boolean;
  /** Bureau licence issued — the manga's licence book. */
  licensed: boolean;
  /** Sigils earned, in order. 1 = Grass/Ranting, 2 = Water/Sungai, 3 = Ground/Batu. */
  sigils: number[];
  /** Scene ids already played, so a cutscene never replays. */
  seenScenes: string[];
  /** Waystone puzzles solved, by id. */
  waystonesSolved: string[];
  /** Set after Tok Sungai's sleeper is found missing — the Phase One turn. */
  knowsSleeperWalked: boolean;
  /** Highest chain the player has ever held, across all battles. */
  bestChainEver: number;
  /** Total questions answered, and how many were solved — the report card. */
  questionsPosed: number;
  questionsSolved: number;
  /** Per-question-kind accuracy, so the game can teach to the weak spot. */
  kindStats: Record<string, { posed: number; solved: number }>;
}

export interface GameState {
  version: number;
  playerName: string;
  money: number;
  /** Zone id and position the player is standing in. */
  zone: string;
  x: number;
  y: number;
  facing: string;
  party: SpiritInstance[];
  /** Every species id the player has ever seen or bound — the Monsterdex. */
  dexSeen: string[];
  dexBound: string[];
  bag: BagState;
  flags: StoryFlags;
  /** Total play time in ms. */
  playedMs: number;
  savedAt: number;
}

export function freshBag(): BagState {
  return {
    talismans: { basic: 5, great: 0, ultra: 0 },
    salve: 3,
    balm: 0,
    antidote: 1,
    wardCharm: 0,
  };
}

export function freshFlags(): StoryFlags {
  return {
    starterChosen: false,
    licensed: false,
    sigils: [],
    seenScenes: [],
    waystonesSolved: [],
    knowsSleeperWalked: false,
    bestChainEver: 0,
    questionsPosed: 0,
    questionsSolved: 0,
    kindStats: {},
  };
}

export function newGame(playerName = 'Ay'): GameState {
  return {
    version: SAVE_VERSION,
    playerName,
    money: 500,
    zone: 'route-1',
    x: 0,
    y: 0,
    facing: 'south',
    party: [],
    dexSeen: [],
    dexBound: [],
    bag: freshBag(),
    flags: freshFlags(),
    playedMs: 0,
    savedAt: Date.now(),
  };
}

/* --------------------------------------------------------------- helpers */

export function activeSpirit(state: GameState): SpiritInstance | null {
  return state.party.find((s) => s.currentHp > 0) ?? state.party[0] ?? null;
}

export function maxHpOf(inst: SpiritInstance): number {
  const s = species(inst.species);
  return computeStats(s.base, inst.grade, inst.resonance, inst.level).maxHp;
}

export function healParty(state: GameState): void {
  for (const s of state.party) {
    s.currentHp = maxHpOf(s);
    s.status = 'none';
    s.venomTurns = 0;
    s.sleepTurns = 0;
    for (const m of s.moves) m.pp = m.maxPp;
  }
}

export function recordSeen(state: GameState, speciesId: string): void {
  if (!state.dexSeen.includes(speciesId)) state.dexSeen.push(speciesId);
}

export function recordBound(state: GameState, speciesId: string): void {
  recordSeen(state, speciesId);
  if (!state.dexBound.includes(speciesId)) state.dexBound.push(speciesId);
}

export function addToParty(state: GameState, inst: SpiritInstance): 'party' | 'full' {
  recordBound(state, inst.species);
  if (state.party.length < BOUND_CIRCLE_MAX) {
    state.party.push(inst);
    return 'party';
  }
  return 'full';
}

export function giveStarter(state: GameState, speciesId: string, rng: Rng): SpiritInstance {
  const starter = createSpirit(speciesId, 5, rng, {
    bound: true,
    metAt: "Ranting's Rest",
  });
  state.party.push(starter);
  recordBound(state, speciesId);
  state.flags.starterChosen = true;
  return starter;
}

/** Records one answered question, for the report card and for adaptive difficulty. */
export function recordAnswer(state: GameState, kind: string, solved: boolean): void {
  state.flags.questionsPosed += 1;
  if (solved) state.flags.questionsSolved += 1;
  const k = (state.flags.kindStats[kind] ??= { posed: 0, solved: 0 });
  k.posed += 1;
  if (solved) k.solved += 1;
}

/** The player's accuracy on a question kind, or null when they have not met it yet. */
export function accuracyFor(state: GameState, kind: string): number | null {
  const k = state.flags.kindStats[kind];
  if (!k || k.posed === 0) return null;
  return k.solved / k.posed;
}

/**
 * How far up the curriculum the campaign is allowed to reach.
 *
 * Tier 1 until the first sigil, Tier 2 until the second, Tier 3 after. This is what stops a
 * Tier 3 move posing a Tier 3 question in Route 1 just because the species happens to know it.
 */
export function segmentCeiling(state: GameState): 1 | 2 | 3 {
  const n = state.flags.sigils.length;
  if (n <= 0) return 1;
  if (n === 1) return 2;
  return 3;
}

/* ------------------------------------------------------------ persistence */

export function save(state: GameState): boolean {
  try {
    state.savedAt = Date.now();
    state.version = SAVE_VERSION;
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // A private window or a full quota must not crash the game — the player simply cannot save.
    return false;
  }
}

export function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (parsed.version !== SAVE_VERSION) return null;
    return migrate(parsed);
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to do — the caller only ever wanted it gone.
  }
}

/**
 * Fills in anything a save is missing.
 *
 * A save from an older build of the same version can legitimately lack a field added since; the
 * game should open it rather than throw the player's progress away.
 */
function migrate(parsed: Partial<GameState>): GameState {
  const base = newGame(parsed.playerName ?? 'Ay');
  const flags = { ...base.flags, ...(parsed.flags ?? {}) };
  flags.kindStats = { ...(parsed.flags?.kindStats ?? {}) };
  return {
    ...base,
    ...parsed,
    bag: { ...base.bag, ...(parsed.bag ?? {}), talismans: { ...base.bag.talismans, ...(parsed.bag?.talismans ?? {}) } },
    flags,
    party: (parsed.party ?? []).filter((p): p is SpiritInstance => Boolean(p?.species)),
    dexSeen: parsed.dexSeen ?? [],
    dexBound: parsed.dexBound ?? [],
  };
}
