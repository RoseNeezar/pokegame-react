/**
 * The Dex: typed access to the generated game data, plus spirit instantiation.
 *
 * This is the only place the rest of the game looks up a species or a move, so a data shape
 * change lands in one file.
 */
import speciesData from '../data/generated/species.json' with { type: 'json' };
import movesData from '../data/generated/moves.json' with { type: 'json' };
import encounterData from '../data/generated/encounters.json' with { type: 'json' };
import regionData from '../data/generated/regions.json' with { type: 'json' };
import type {
  Aspect,
  EncounterZone,
  MoveDef,
  MoveSlot,
  SpeciesDef,
  SpiritInstance,
} from './types.ts';
import { Rng } from './rng.ts';
import { rollGrade, zeroResonance, computeHp } from './stats.ts';
import { xpToReachLevel } from './progression.ts';

export const SPECIES = speciesData as unknown as SpeciesDef[];
export const MOVES = movesData as unknown as MoveDef[];

const ENCOUNTERS = encounterData as unknown as { part1: EncounterZone[]; part2: EncounterZone[] };

export interface RegionDef {
  readonly id: string;
  readonly name: string;
  readonly segment: number;
  readonly shrineAspect: Aspect;
  readonly shrineKeeper: string;
  readonly shrineName: string;
  readonly shrineAce: { readonly species: string; readonly level: number };
  readonly sigil: number;
  readonly zones: readonly string[];
  readonly expectedPlayerLevel: number;
}

export const REGIONS = regionData as unknown as RegionDef[];

const speciesById = new Map(SPECIES.map((s) => [s.id, s]));
const speciesByName = new Map(SPECIES.map((s) => [s.name.toLowerCase(), s]));
const speciesByDexNo = new Map(SPECIES.map((s) => [s.dexNo, s]));
const movesById = new Map(MOVES.map((m) => [m.id, m]));
const movesByName = new Map(MOVES.map((m) => [m.name.toLowerCase(), m]));
const zonesByName = new Map(ENCOUNTERS.part1.map((z) => [z.zone, z]));

export function species(idOrName: string): SpeciesDef {
  const s = speciesById.get(idOrName) ?? speciesByName.get(idOrName.toLowerCase());
  if (!s) throw new Error(`Unknown species "${idOrName}"`);
  return s;
}

export function speciesByNumber(dexNo: number): SpeciesDef | undefined {
  return speciesByDexNo.get(dexNo);
}

export function move(idOrName: string): MoveDef {
  const m = movesById.get(idOrName) ?? movesByName.get(idOrName.toLowerCase());
  if (!m) throw new Error(`Unknown move "${idOrName}"`);
  return m;
}

export function zone(name: string): EncounterZone {
  const z = zonesByName.get(name);
  if (!z) throw new Error(`Unknown zone "${name}"`);
  return z;
}

export function allZones(): EncounterZone[] {
  return ENCOUNTERS.part1;
}

export function region(id: string): RegionDef {
  const r = REGIONS.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown region "${id}"`);
  return r;
}

export function regionForZone(zoneName: string): RegionDef | undefined {
  return REGIONS.find((r) => r.zones.includes(zoneName));
}

/** The Dex object the battle engine takes, so the engine never imports the data itself. */
export const dex = { species, move };

/* ------------------------------------------------------- instantiation */

/** The four most recent moves a species knows at a level — the standard wild loadout. */
export function movesAtLevel(s: SpeciesDef, level: number): MoveSlot[] {
  const known = s.learnset.filter((e) => e.level <= level).map((e) => e.move);
  const lastFour = known.slice(-4);
  return lastFour.map((name) => {
    const m = move(name);
    return { move: m.name, pp: m.pp, maxPp: m.pp };
  });
}

let uidCounter = 0;

export interface CreateOptions {
  readonly nickname?: string | null;
  readonly bound?: boolean;
  readonly metAt?: string;
  /** Overrides the level-derived loadout. */
  readonly moves?: string[];
}

export function createSpirit(
  speciesIdOrName: string,
  level: number,
  rng: Rng,
  opts: CreateOptions = {},
): SpiritInstance {
  const s = species(speciesIdOrName);
  const grade = rollGrade(rng);
  const resonance = zeroResonance();
  const maxHp = computeHp(s.base.hp, grade.hp, resonance.hp, level);

  const moves = opts.moves
    ? opts.moves.map((name) => {
        const m = move(name);
        return { move: m.name, pp: m.pp, maxPp: m.pp };
      })
    : movesAtLevel(s, level);

  // Every spirit knows at least one thing.
  if (moves.length === 0) {
    const fallback = move(s.learnset[0]?.move ?? 'Power Jab');
    moves.push({ move: fallback.name, pp: fallback.pp, maxPp: fallback.pp });
  }

  return {
    uid: `sp_${(++uidCounter).toString(36)}_${rng.int(0, 0xffff).toString(36)}`,
    species: s.id,
    nickname: opts.nickname ?? null,
    level,
    xp: xpToReachLevel(s.growth, level),
    grade,
    resonance,
    currentHp: maxHp,
    status: 'none',
    venomTurns: 0,
    sleepTurns: 0,
    moves,
    bound: opts.bound ?? false,
    metAtLevel: level,
    metAt: opts.metAt ?? 'Unknown',
  };
}

/** Rolls a wild encounter for a zone. */
export function rollEncounter(zoneName: string, rng: Rng): SpiritInstance {
  const z = zone(zoneName);
  const picked = rng.weighted(z.encounters, (e) => e.chance);
  const level = rng.int(z.levelRange[0], z.levelRange[1]);
  return createSpirit(picked.species, level, rng, { metAt: zoneName });
}

export function displayName(inst: SpiritInstance): string {
  return inst.nickname ?? species(inst.species).name;
}
