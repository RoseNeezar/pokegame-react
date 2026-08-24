/**
 * The Phase One world.
 *
 * Fifteen zones across three regions, laid out to match the manga's route: a village under a
 * shrine's steps, a waystone road, a thicket, a ferry town on the water, a highland quarry.
 * Encounter zones are keyed to `src/data/generated/encounters.json` by `encounterZone`, so the
 * approved encounter tables and level bands drive the world rather than being restated here.
 *
 * The shrine order — Grass, then Water, then Ground — follows battle-math §13, the regenerated
 * encounter tables and the manga (Tok Ranting, Tok Sungai, Tok Batu). See tools/ingest/index.ts
 * for why `sojutsu_progression.csv`'s different ordering is treated as superseded.
 */
import type { Aspect } from '../../core/types.ts';

export type Biome = 'meadow' | 'thicket' | 'riverside' | 'shallows' | 'highland' | 'cavern' | 'town' | 'shrine';

export interface ZoneExit {
  /** Which edge of this zone the exit sits on, and where along it (0..1). */
  readonly edge: 'north' | 'south' | 'east' | 'west';
  readonly at: number;
  readonly to: string;
  /** Requires this many sigils to pass — the manga's sigil-locked gate. */
  readonly requiresSigils?: number;
  readonly lockedMessage?: string;
}

export interface ZoneNpc {
  readonly id: string;
  /** Position as a fraction of zone size. */
  readonly at: readonly [number, number];
  readonly name: string;
  readonly sprite?: string;
  /** Dialogue script id. */
  readonly script: string;
}

export interface ZoneWaystone {
  readonly id: string;
  readonly at: readonly [number, number];
  /** Which curriculum tier the waystone's puzzle draws from. */
  readonly tier: 1 | 2 | 3;
  readonly reward?: 'talisman' | 'salve' | 'money' | 'passage';
  /** Set when solving it opens the way rather than granting an item. */
  readonly blocksExitTo?: string;
}

export interface ZoneDef {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly biome: Biome;
  /** Zone size in tiles. */
  readonly width: number;
  readonly height: number;
  /** Matching zone in the approved encounter tables, or null for safe zones. */
  readonly encounterZone: string | null;
  /** Encounter chance per second of movement through tall grass. */
  readonly encounterRate: number;
  readonly exits: readonly ZoneExit[];
  readonly npcs: readonly ZoneNpc[];
  readonly waystones: readonly ZoneWaystone[];
  /** Safe zones fully heal the party on entry — the manga's Mendery. */
  readonly heals?: boolean;
  readonly shop?: boolean;
  /** Present on the three shrine zones. */
  readonly shrine?: {
    readonly keeper: string;
    readonly aspect: Aspect;
    readonly sigil: number;
    readonly aceSpecies: string;
    readonly aceLevel: number;
  };
  /** Seed for the deterministic terrain generator. */
  readonly seed: string;
}

export const ZONES: readonly ZoneDef[] = [
  /* ------------------------------------------------------- R1 Meadow */
  {
    id: 'rantings-rest',
    name: "Ranting's Rest",
    region: 'r1-meadow',
    biome: 'town',
    width: 34,
    height: 40,
    encounterZone: null,
    encounterRate: 0,
    heals: true,
    shop: true,
    seed: 'rantings-rest',
    exits: [{ edge: 'north', at: 0.5, to: 'route-1' }],
    npcs: [
      { id: 'mender', at: [0.28, 0.42], name: 'The Mendery', script: 'mendery' },
      { id: 'provisioner', at: [0.7, 0.42], name: 'Provisioner', script: 'provisioner' },
      { id: 'jessica-intro', at: [0.5, 0.72], name: 'Jessica', script: 'prologue-jessica' },
      { id: 'broom-kid', at: [0.36, 0.66], name: 'Sweeper', script: 'broom-kid' },
    ],
    waystones: [],
  },
  {
    id: 'route-1',
    name: 'Route 1 · Lower Trail',
    region: 'r1-meadow',
    biome: 'meadow',
    width: 30,
    height: 56,
    encounterZone: 'Route 1',
    encounterRate: 0.055,
    seed: 'route-1',
    exits: [
      { edge: 'south', at: 0.5, to: 'rantings-rest' },
      { edge: 'north', at: 0.42, to: 'waystone-road' },
    ],
    npcs: [{ id: 'trail-walker', at: [0.6, 0.55], name: 'Trail Walker', script: 'route1-walker' }],
    waystones: [{ id: 'ws-r1-a', at: [0.28, 0.35], tier: 1, reward: 'talisman' }],
  },
  {
    id: 'waystone-road',
    name: 'Route 2 · Waystone Road',
    region: 'r1-meadow',
    biome: 'meadow',
    width: 32,
    height: 60,
    encounterZone: 'Waystone Road',
    encounterRate: 0.06,
    seed: 'waystone-road',
    exits: [
      { edge: 'south', at: 0.42, to: 'route-1' },
      { edge: 'north', at: 0.6, to: 'verdant-thicket' },
    ],
    npcs: [{ id: 'ay-first', at: [0.5, 0.4], name: 'Ay', script: 'ay-first-meeting' }],
    waystones: [
      { id: 'ws-r2-a', at: [0.3, 0.62], tier: 1, reward: 'salve' },
      {
        id: 'ws-r2-gate',
        at: [0.6, 0.24],
        tier: 1,
        reward: 'passage',
        blocksExitTo: 'verdant-thicket',
      },
    ],
  },
  {
    id: 'verdant-thicket',
    name: 'Verdant Thicket',
    region: 'r1-meadow',
    biome: 'thicket',
    width: 38,
    height: 52,
    encounterZone: 'Verdant Thicket',
    encounterRate: 0.075,
    seed: 'verdant-thicket',
    exits: [
      { edge: 'south', at: 0.6, to: 'waystone-road' },
      { edge: 'north', at: 0.5, to: 'shrine-thicket' },
    ],
    npcs: [],
    waystones: [{ id: 'ws-thicket', at: [0.72, 0.5], tier: 2, reward: 'money' }],
  },
  {
    id: 'shrine-thicket',
    name: 'Thicket Shrine',
    region: 'r1-meadow',
    biome: 'shrine',
    width: 28,
    height: 34,
    encounterZone: null,
    encounterRate: 0,
    heals: true,
    seed: 'shrine-thicket',
    shrine: {
      keeper: 'Tok Ranting',
      aspect: 'Grass',
      sigil: 1,
      aceSpecies: 'leaflark',
      aceLevel: 14,
    },
    exits: [
      { edge: 'south', at: 0.5, to: 'verdant-thicket' },
      {
        edge: 'north',
        at: 0.5,
        to: 'riverside-trail',
        requiresSigils: 1,
        lockedMessage: 'The road past the shrine is sigil-locked. Tok Ranting is waiting.',
      },
    ],
    npcs: [{ id: 'tok-ranting', at: [0.5, 0.24], name: 'Tok Ranting', script: 'shrine-1' }],
    waystones: [],
  },

  /* ---------------------------------------------------- R2 Riverside */
  {
    id: 'riverside-trail',
    name: 'Riverside Trail',
    region: 'r2-riverside',
    biome: 'riverside',
    width: 32,
    height: 58,
    encounterZone: 'Riverside Trail',
    encounterRate: 0.065,
    seed: 'riverside-trail',
    exits: [
      { edge: 'south', at: 0.5, to: 'shrine-thicket' },
      { edge: 'north', at: 0.55, to: 'ferry-town' },
    ],
    npcs: [],
    waystones: [{ id: 'ws-river-a', at: [0.35, 0.45], tier: 2, reward: 'talisman' }],
  },
  {
    id: 'ferry-town',
    name: 'Ferry Town',
    region: 'r2-riverside',
    biome: 'town',
    width: 36,
    height: 42,
    encounterZone: null,
    encounterRate: 0,
    heals: true,
    shop: true,
    seed: 'ferry-town',
    exits: [
      { edge: 'south', at: 0.55, to: 'riverside-trail' },
      { edge: 'east', at: 0.5, to: 'kawa-crossing' },
      { edge: 'north', at: 0.4, to: 'shrine-ferry' },
    ],
    npcs: [
      { id: 'mender-2', at: [0.26, 0.46], name: 'The Mendery', script: 'mendery' },
      { id: 'provisioner-2', at: [0.68, 0.46], name: 'Provisioner', script: 'provisioner' },
      { id: 'ay-dock', at: [0.5, 0.76], name: 'Ay', script: 'ay-dock' },
      { id: 'archivist', at: [0.8, 0.3], name: 'Bureau Archivist', script: 'archive' },
    ],
    waystones: [],
  },
  {
    id: 'kawa-crossing',
    name: 'Kawa Crossing',
    region: 'r2-riverside',
    biome: 'riverside',
    width: 40,
    height: 44,
    encounterZone: 'Kawa Crossing',
    encounterRate: 0.07,
    seed: 'kawa-crossing',
    exits: [
      { edge: 'west', at: 0.5, to: 'ferry-town' },
      { edge: 'east', at: 0.45, to: 'the-shallows' },
    ],
    npcs: [],
    waystones: [
      {
        id: 'ws-kawa-bridge',
        at: [0.5, 0.5],
        tier: 2,
        reward: 'passage',
        blocksExitTo: 'the-shallows',
      },
    ],
  },
  {
    id: 'the-shallows',
    name: 'The Shallows',
    region: 'r2-riverside',
    biome: 'shallows',
    width: 36,
    height: 46,
    encounterZone: 'The Shallows',
    encounterRate: 0.08,
    seed: 'the-shallows',
    exits: [{ edge: 'west', at: 0.45, to: 'kawa-crossing' }],
    npcs: [],
    waystones: [{ id: 'ws-shallows', at: [0.6, 0.32], tier: 2, reward: 'salve' }],
  },
  {
    id: 'shrine-ferry',
    name: 'Ferry Shrine',
    region: 'r2-riverside',
    biome: 'shrine',
    width: 28,
    height: 36,
    encounterZone: null,
    encounterRate: 0,
    heals: true,
    seed: 'shrine-ferry',
    shrine: {
      keeper: 'Tok Sungai',
      aspect: 'Water',
      sigil: 2,
      aceSpecies: 'glacisaur',
      aceLevel: 22,
    },
    exits: [
      { edge: 'south', at: 0.4, to: 'ferry-town' },
      {
        edge: 'north',
        at: 0.5,
        to: 'stone-steps',
        requiresSigils: 2,
        lockedMessage: 'The mountain road is sigil-locked. Tok Sungai has not stamped you yet.',
      },
    ],
    npcs: [{ id: 'tok-sungai', at: [0.5, 0.26], name: 'Tok Sungai', script: 'shrine-2' }],
    waystones: [],
  },

  /* ----------------------------------------------------- R3 Highland */
  {
    id: 'stone-steps',
    name: 'Route 3 · Stone Steps',
    region: 'r3-highland',
    biome: 'highland',
    width: 30,
    height: 62,
    encounterZone: 'Stone Steps',
    encounterRate: 0.065,
    seed: 'stone-steps',
    exits: [
      { edge: 'south', at: 0.5, to: 'shrine-ferry' },
      { edge: 'north', at: 0.45, to: 'quarry-town' },
    ],
    npcs: [{ id: 'quarry-foreman', at: [0.6, 0.5], name: 'Cutting Crew', script: 'quarry-crew' }],
    waystones: [{ id: 'ws-steps', at: [0.32, 0.6], tier: 3, reward: 'talisman' }],
  },
  {
    id: 'quarry-town',
    name: 'Quarry Town',
    region: 'r3-highland',
    biome: 'town',
    width: 34,
    height: 40,
    encounterZone: null,
    encounterRate: 0,
    heals: true,
    shop: true,
    seed: 'quarry-town',
    exits: [
      { edge: 'south', at: 0.45, to: 'stone-steps' },
      { edge: 'east', at: 0.5, to: 'echo-cavern' },
      { edge: 'west', at: 0.5, to: 'ridge-path' },
      { edge: 'north', at: 0.5, to: 'shrine-quarry' },
    ],
    npcs: [
      { id: 'mender-3', at: [0.28, 0.44], name: 'The Mendery', script: 'mendery' },
      { id: 'provisioner-3', at: [0.7, 0.44], name: 'Provisioner', script: 'provisioner' },
      { id: 'tally-clerk', at: [0.5, 0.66], name: 'Prop Tally', script: 'prop-tally' },
    ],
    waystones: [],
  },
  {
    id: 'echo-cavern',
    name: 'Echo Cavern',
    region: 'r3-highland',
    biome: 'cavern',
    width: 40,
    height: 48,
    encounterZone: 'Echo Cavern',
    encounterRate: 0.09,
    seed: 'echo-cavern',
    exits: [{ edge: 'west', at: 0.5, to: 'quarry-town' }],
    npcs: [],
    waystones: [{ id: 'ws-cavern', at: [0.62, 0.42], tier: 3, reward: 'money' }],
  },
  {
    id: 'ridge-path',
    name: 'Route 4 · Ridge Path',
    region: 'r3-highland',
    biome: 'highland',
    width: 44,
    height: 40,
    encounterZone: 'Ridge Path',
    encounterRate: 0.07,
    seed: 'ridge-path',
    exits: [{ edge: 'east', at: 0.5, to: 'quarry-town' }],
    npcs: [],
    waystones: [{ id: 'ws-ridge', at: [0.35, 0.5], tier: 3, reward: 'salve' }],
  },
  {
    id: 'shrine-quarry',
    name: 'Quarry Shrine',
    region: 'r3-highland',
    biome: 'shrine',
    width: 30,
    height: 36,
    encounterZone: null,
    encounterRate: 0,
    heals: true,
    seed: 'shrine-quarry',
    shrine: {
      keeper: 'Tok Batu',
      aspect: 'Ground',
      sigil: 3,
      aceSpecies: 'burrosaur',
      aceLevel: 29,
    },
    exits: [{ edge: 'south', at: 0.5, to: 'quarry-town' }],
    npcs: [{ id: 'tok-batu', at: [0.5, 0.26], name: 'Tok Batu', script: 'shrine-3' }],
    waystones: [],
  },
];

const byId = new Map(ZONES.map((z) => [z.id, z]));

export function zoneDef(id: string): ZoneDef {
  const z = byId.get(id);
  if (!z) throw new Error(`Unknown zone "${id}"`);
  return z;
}

export function allZoneIds(): string[] {
  return ZONES.map((z) => z.id);
}

/** The exit on `from` that leads to `to`, if any — used to place the player on arrival. */
export function exitBetween(from: ZoneDef, to: string): ZoneExit | undefined {
  return from.exits.find((e) => e.to === to);
}

/** The opposite edge, so arriving through a north exit puts you at the south edge. */
export function oppositeEdge(edge: ZoneExit['edge']): ZoneExit['edge'] {
  switch (edge) {
    case 'north':
      return 'south';
    case 'south':
      return 'north';
    case 'east':
      return 'west';
    case 'west':
      return 'east';
  }
}
