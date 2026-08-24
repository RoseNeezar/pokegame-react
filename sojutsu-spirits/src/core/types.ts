/**
 * Canonical game types. Shared by the pure engine, the generated data and the Phaser layer.
 *
 * Terminology follows `sojutsu-battle-math.md` §0 — the game says Aspect, not type; Spirit,
 * not monster; Sojutsuka, not trainer. Keeping the domain language in the code keeps the code
 * honest against the design documents.
 */

export const ASPECTS = [
  'Normal',
  'Fire',
  'Water',
  'Grass',
  'Electric',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
] as const;

export type Aspect = (typeof ASPECTS)[number];

export type Stage = 'Base' | 'Stage 2' | 'Final A' | 'Final B';

export type GrowthCurve = 'Fast' | 'Medium Fast' | 'Medium Slow' | 'Slow';

export type MoveCategory = 'Phys' | 'Spec' | 'Status';

/** How a move behaves when its arithmetic is dropped. From the unified move catalogue. */
export type FailureMode = 'reduced_power' | 'move_fails';

export type StatKey = 'hp' | 'attack' | 'defense' | 'speed' | 'special';

/** The four stats that take stage modifiers, plus the two accuracy-table stages. */
export type StageKey = 'attack' | 'defense' | 'speed' | 'special' | 'accuracy' | 'evasion';

export type StatusKind =
  | 'none'
  | 'poison'
  | 'venom' // Venom Curse — the Toxic analog, escalating
  | 'burn'
  | 'paralysis'
  | 'sleep'
  | 'freeze';

export interface BaseStats {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly special: number;
}

/** Innate quality, rolled once on encounter. 0-15 per stat; HP derived from the LSBs. */
export interface Grade {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
  readonly special: number;
}

/** Accumulated through battle. 0-65535 per stat; contributes floor(sqrt(r)/4). */
export interface Resonance {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  special: number;
}

/** The engine block the unified move catalogue attaches to every move. */
export interface MoveEngine {
  /** 1-3. Selects the arithmetic difficulty band for this move. */
  readonly mathTier: 1 | 2 | 3;
  /** 1-5. Dramatic weight: drives animation intensity, shake and Finish-meter gain. */
  readonly impact: 1 | 2 | 3 | 4 | 5;
  readonly failureMode: FailureMode;
  /** Chain Rate Gain — multiplies chain gained on a correct solve. See DESIGN.md [A-2]. */
  readonly crgModifier: number;
  /** Response Allowance Duration — multiplies the answer timer. 0 = no question posed. */
  readonly radModifier: number;
  readonly priority: number;
  readonly multiTurn: boolean;
}

export interface MoveAnimation {
  readonly source: string;
  readonly tmId: string | null;
  readonly animationId: string;
  readonly atlas: string;
  readonly frames: number;
  readonly description: string;
}

export interface MoveDef {
  readonly name: string;
  readonly id: string;
  readonly aspect: Aspect;
  readonly category: MoveCategory;
  /** null for moves whose damage is fixed or which deal none. */
  readonly power: number | null;
  readonly powerNote: string | null;
  readonly accuracy: number;
  readonly pp: number;
  readonly effect: string | null;
  readonly tier: string;
  readonly animation: MoveAnimation;
  readonly engine: MoveEngine;
}

export interface LearnsetEntry {
  readonly level: number;
  readonly move: string;
}

export interface SpeciesDef {
  readonly dexNo: number;
  readonly id: string;
  readonly name: string;
  readonly stage: Stage;
  readonly aspects: readonly Aspect[];
  readonly base: BaseStats;
  readonly bst: number;
  readonly catchRate: number;
  readonly growth: GrowthCurve;
  /** null on final forms. */
  readonly evolvesAtLevel: number | null;
  /** Species id of the v1 evolution target, or null. */
  readonly evolvesInto: string | null;
  readonly baseExpYield: number;
  readonly rarity: string;
  readonly segment: string;
  readonly learnset: readonly LearnsetEntry[];
  readonly recommendedSet: readonly string[];
  /** Release gate — Final B forms are reserved for v2. */
  readonly inV1: boolean;
  readonly blurb: string;
}

export interface EncounterEntry {
  readonly species: string;
  readonly rarity: string;
  readonly weight: number;
  readonly chance: number;
}

export interface EncounterZone {
  readonly zone: string;
  readonly region: string;
  readonly levelRange: readonly [number, number];
  readonly note: string | null;
  readonly encounters: readonly EncounterEntry[];
}

/** A live spirit in the player's Bound Circle or on the field. */
export interface SpiritInstance {
  uid: string;
  species: string;
  nickname: string | null;
  level: number;
  xp: number;
  grade: Grade;
  resonance: Resonance;
  currentHp: number;
  status: StatusKind;
  /** Venom Curse counter — increments per tick, resets on switch. */
  venomTurns: number;
  /** Remaining sleep turns. */
  sleepTurns: number;
  moves: MoveSlot[];
  /** True once bound by the player rather than met wild. */
  bound: boolean;
  metAtLevel: number;
  metAt: string;
}

export interface MoveSlot {
  move: string;
  pp: number;
  maxPp: number;
}

export type TalismanKind = 'basic' | 'great' | 'ultra';
