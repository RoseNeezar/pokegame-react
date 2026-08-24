/**
 * Reference-data ingestion.
 *
 * Reads the canonical bundle in `reference/data` and emits validated, typed JSON into
 * `src/data/generated`. The game never reads the reference bundle directly — every value it
 * uses has passed through the checks below.
 *
 * This step is deliberately loud. `sojutsu-battle-math.md` §14 warns that a data or formula
 * bug found after the encounter tables are tuned means retuning every encounter, so an
 * inconsistency here throws rather than defaulting.
 *
 *   npm run ingest
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords, isBlank, num, numOrNull } from './csv.ts';
import { ASPECTS } from '../../src/core/types.ts';
import type {
  Aspect,
  GrowthCurve,
  MoveCategory,
  MoveDef,
  SpeciesDef,
  Stage,
  EncounterZone,
  LearnsetEntry,
  FailureMode,
} from '../../src/core/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REF = join(ROOT, 'reference', 'data');
const OUT = join(ROOT, 'src', 'data', 'generated');

const problems: string[] = [];
const notes: string[] = [];

function fail(msg: string): void {
  problems.push(msg);
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(REF, file), 'utf8')) as T;
}

function readCsv(file: string): Array<Record<string, string>> {
  return parseCsvRecords(readFileSync(join(REF, file), 'utf8'));
}

/* ------------------------------------------------------------------ aspects */

const ASPECT_SET = new Set<string>(ASPECTS);

function parseAspects(raw: string, who: string): Aspect[] {
  const parts = raw
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  const out: Aspect[] = [];
  for (const p of parts) {
    if (!ASPECT_SET.has(p)) {
      fail(`${who}: unknown Aspect "${p}" (from "${raw}")`);
      continue;
    }
    out.push(p as Aspect);
  }
  if (out.length === 0) fail(`${who}: no Aspect parsed from "${raw}"`);
  return out;
}

/* ------------------------------------------------------------------- moves */

interface RawMoves {
  moveCount: number;
  moves: Array<{
    name: string;
    aspect: string;
    category: string;
    power: number | null;
    powerNote: string | null;
    accuracy: number;
    pp: number;
    effect: string | null;
    tier: string;
    animation: {
      source: string;
      tmId: string | null;
      animationId: string;
      atlas: string;
      frames: number;
      description: string;
    };
    engine: {
      mathTier: number;
      impact: number;
      failureMode: string;
      crgModifier: number;
      radModifier: number;
      priority: number;
      multiTurn: boolean;
    } | null;
  }>;
}

function buildMoves(): MoveDef[] {
  const raw = readJson<RawMoves>('sojutsu-moves-unified.json');
  if (raw.moves.length !== raw.moveCount) {
    fail(`moves: catalogue declares ${raw.moveCount} moves but contains ${raw.moves.length}`);
  }

  const seen = new Set<string>();
  const moves: MoveDef[] = raw.moves.map((m) => {
    const id = slug(m.name);
    if (seen.has(id)) fail(`moves: duplicate move id "${id}" (${m.name})`);
    seen.add(id);

    const aspects = parseAspects(m.aspect, `move ${m.name}`);
    const category = m.category as MoveCategory;
    if (!['Phys', 'Spec', 'Status'].includes(category)) {
      fail(`move ${m.name}: unknown category "${m.category}"`);
    }

    const e = m.engine;
    if (!e) {
      // The catalogue's own _note warns that engine:null rows need founder decisions.
      fail(`move ${m.name}: engine block missing — cannot wire to battle`);
    }
    const tier = (e?.mathTier ?? 1) as 1 | 2 | 3;
    if (![1, 2, 3].includes(tier)) fail(`move ${m.name}: mathTier ${tier} out of range`);
    const impact = (e?.impact ?? 1) as 1 | 2 | 3 | 4 | 5;
    if (![1, 2, 3, 4, 5].includes(impact)) fail(`move ${m.name}: impact ${impact} out of range`);
    const failureMode = (e?.failureMode ?? 'move_fails') as FailureMode;
    if (!['reduced_power', 'move_fails'].includes(failureMode)) {
      fail(`move ${m.name}: unknown failureMode "${failureMode}"`);
    }

    if (category !== 'Status' && m.power === null && !m.powerNote) {
      notes.push(`move ${m.name}: damaging move with null power and no powerNote — treated as fixed-damage`);
    }

    return {
      name: m.name,
      id,
      aspect: aspects[0]!,
      category,
      power: m.power,
      powerNote: m.powerNote,
      accuracy: m.accuracy,
      pp: m.pp,
      effect: m.effect,
      tier: m.tier,
      animation: m.animation,
      engine: {
        mathTier: tier,
        impact,
        failureMode,
        crgModifier: e?.crgModifier ?? 1,
        radModifier: e?.radModifier ?? 1,
        priority: e?.priority ?? 0,
        multiTurn: e?.multiTurn ?? false,
      },
    };
  });

  return moves;
}

/* ----------------------------------------------------------------- species */

function parseLearnset(raw: string, who: string): LearnsetEntry[] {
  if (isBlank(raw)) return [];
  const out: LearnsetEntry[] = [];
  for (const chunk of raw.split('·')) {
    const s = chunk.trim();
    if (!s) continue;
    const m = /^Lv\s*(\d+)\s*:\s*(.+)$/i.exec(s);
    if (!m) {
      fail(`${who}: unparseable learnset entry "${s}"`);
      continue;
    }
    out.push({ level: Number(m[1]), move: m[2]!.trim() });
  }
  return out.sort((a, b) => a.level - b.level);
}

function buildSpecies(moves: MoveDef[]): SpeciesDef[] {
  const stats = readCsv('sojutsu_spirit_data.csv');
  const learn = readCsv('sojutsu_learnsets_summary.csv');
  const catchRates = readJson<{ catchRates: Record<string, number> }>('sojutsu-catch-rates.json').catchRates;
  const blurbs = readDexBlurbs();

  const learnByName = new Map(learn.map((r) => [r['Spirit']!, r]));
  const moveNames = new Set(moves.map((m) => m.name));

  // Dex numbers come from the Monsterdex catalogue ordering: 24 lines × 4 forms, in CSV order.
  const species: SpeciesDef[] = stats.map((r, idx) => {
    const name = r['Monster']!;
    const who = `species ${name}`;
    const dexNo = idx + 1;
    const stage = r['Stage'] as Stage;
    if (!['Base', 'Stage 2', 'Final A', 'Final B'].includes(stage)) {
      fail(`${who}: unknown stage "${stage}"`);
    }

    const growth = r['Growth Rate'] as GrowthCurve;
    if (!['Fast', 'Medium Fast', 'Medium Slow', 'Slow'].includes(growth)) {
      fail(`${who}: unknown growth curve "${growth}"`);
    }

    const base = {
      hp: num(r['HP'], `${who}.HP`),
      attack: num(r['Attack'], `${who}.Attack`),
      defense: num(r['Defense'], `${who}.Defense`),
      speed: num(r['Speed'], `${who}.Speed`),
      special: num(r['Special'], `${who}.Special`),
    };
    const declaredTotal = num(r['Total'], `${who}.Total`);
    const actualTotal = base.hp + base.attack + base.defense + base.speed + base.special;
    if (declaredTotal !== actualTotal) {
      fail(`${who}: BST mismatch — CSV says ${declaredTotal}, stats sum to ${actualTotal}`);
    }

    const catchRate = catchRates[name];
    if (catchRate === undefined) fail(`${who}: no catch rate in sojutsu-catch-rates.json`);

    const ls = learnByName.get(name);
    if (!ls) fail(`${who}: no learnset row`);
    const learnset = parseLearnset(ls?.['Full Learnset (Lv: Move)'] ?? '', who);
    for (const entry of learnset) {
      if (!moveNames.has(entry.move)) fail(`${who}: learnset references unknown move "${entry.move}"`);
    }
    const declaredKnown = numOrNull(ls?.['Moves Known']);
    if (declaredKnown !== null && declaredKnown !== learnset.length) {
      fail(`${who}: declares ${declaredKnown} moves known but learnset lists ${learnset.length}`);
    }

    const recommendedSet = (ls?.['Recommended 4-Move Set @ Lv30'] ?? '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const mv of recommendedSet) {
      if (!moveNames.has(mv)) fail(`${who}: recommended set references unknown move "${mv}"`);
    }

    const version = r['Version / Release'] ?? '';
    const inV1 = version.startsWith('v1');

    return {
      dexNo,
      id: slug(name),
      name,
      stage,
      aspects: parseAspects(r['Type/Theme'] ?? '', who),
      base,
      bst: actualTotal,
      catchRate: catchRate ?? 45,
      growth,
      evolvesAtLevel: numOrNull(r['Evolves At (Lv)']),
      evolvesInto: null, // filled in below, once every species exists
      baseExpYield: num(r['Base EXP Yield'], `${who}.BaseEXP`),
      rarity: isBlank(r['Rarity']) ? '—' : r['Rarity']!,
      segment: r['Game Segment'] ?? '',
      learnset,
      recommendedSet,
      inV1,
      blurb: blurbs.get(name.toUpperCase()) ?? '',
    };
  });

  linkEvolutions(species);
  return species;
}

/**
 * Wires evolution targets.
 *
 * `sojutsu-battle-math.md` §11 is explicit: Final B is deferred to v2, so in v1 every Stage 2
 * evolves straight into Final A with no condition. The CSV stores lines as consecutive runs of
 * Base / Stage 2 / Final A / Final B, so the target is found by walking forward within the line.
 */
function linkEvolutions(species: SpeciesDef[]): void {
  for (let i = 0; i < species.length; i++) {
    const s = species[i]!;
    if (s.evolvesAtLevel === null) continue;

    const wanted: Stage | null = s.stage === 'Base' ? 'Stage 2' : s.stage === 'Stage 2' ? 'Final A' : null;
    if (!wanted) {
      fail(`species ${s.name}: stage ${s.stage} has an evolution level but nothing to evolve into`);
      continue;
    }
    // Look ahead within this line only — a line is at most 4 consecutive rows.
    let target: SpeciesDef | undefined;
    for (let j = i + 1; j < Math.min(i + 4, species.length); j++) {
      if (species[j]!.stage === wanted) {
        target = species[j];
        break;
      }
      if (species[j]!.stage === 'Base') break; // walked into the next line
    }
    if (!target) {
      fail(`species ${s.name}: evolves at Lv ${s.evolvesAtLevel} but no ${wanted} form follows it`);
      continue;
    }
    (s as { evolvesInto: string | null }).evolvesInto = target.id;
  }
}

/** Pulls the one-line description the Monsterdex catalogue gives each species. */
function readDexBlurbs(): Map<string, string> {
  const out = new Map<string, string>();
  const file = join(ROOT, 'reference', 'monsterdex', 'monsterdex-001-096.html');
  if (!existsSync(file)) {
    notes.push('monsterdex catalogue HTML not found — species blurbs will be empty');
    return out;
  }
  const html = readFileSync(file, 'utf8');
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  // "#001 HELMLING Golden armored hatchling BASE FORM"
  const re = /#(\d{3})\s+([A-Z][A-Z' -]+?)\s+([^#]+?)\s+(?:BASE FORM|STAGE 2|FINAL · BRANCH [AB])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[2]!.trim();
    const desc = m[3]!.replace(/·.*$/, '').trim();
    out.set(name, desc);
  }
  return out;
}

/* -------------------------------------------------------------- encounters */

function buildEncounters(speciesById: Map<string, SpeciesDef>): {
  part1: EncounterZone[];
  part2: EncounterZone[];
} {
  const raw = readJson<{ zones: EncounterZone[]; part2Skeleton: EncounterZone[] }>('sojutsu-encounters.json');

  const check = (zones: EncounterZone[], label: string): void => {
    for (const z of zones) {
      let total = 0;
      for (const e of z.encounters) {
        if (!speciesById.has(slug(e.species))) {
          fail(`${label} zone "${z.zone}": unknown species "${e.species}"`);
        }
        total += e.chance;
      }
      if (Math.abs(total - 1) > 0.01) {
        fail(`${label} zone "${z.zone}": encounter chances sum to ${total.toFixed(4)}, expected 1.0`);
      }
      if (z.levelRange[0] > z.levelRange[1]) {
        fail(`${label} zone "${z.zone}": inverted level range ${z.levelRange.join('-')}`);
      }
    }
  };

  check(raw.zones, 'part1');
  // The part-2 skeleton is not shipped in v1 and its weights are known to be unnormalised.
  for (const z of raw.part2Skeleton) {
    for (const e of z.encounters) {
      if (!speciesById.has(slug(e.species))) {
        fail(`part2 zone "${z.zone}": unknown species "${e.species}"`);
      }
    }
  }

  return { part1: raw.zones, part2: raw.part2Skeleton };
}

/* ------------------------------------------------------------ aspect chart */

function buildAspectChart(): Record<string, Record<string, number>> {
  const raw = readJson<{ aspects: string[]; chart: Record<string, Record<string, number>> }>(
    'sojutsu-aspect-chart.json',
  );
  for (const a of ASPECTS) {
    if (!raw.chart[a]) fail(`aspect chart: missing attacker row "${a}"`);
    for (const d of ASPECTS) {
      const v = raw.chart[a]?.[d];
      if (typeof v !== 'number') fail(`aspect chart: missing cell ${a} -> ${d}`);
      else if (![0, 0.5, 1, 2].includes(v)) fail(`aspect chart: illegal multiplier ${v} at ${a} -> ${d}`);
    }
  }

  // The two corrections sojutsu-battle-math.md §3 requires of any chart we ship.
  if (raw.chart['Ghost']?.['Psychic'] !== 2) {
    fail('aspect chart: Ghost -> Psychic must be 2.0 (battle-math §3 correction)');
  }
  if (raw.chart['Ice']?.['Ice'] !== 0.5) {
    fail('aspect chart: Ice -> Ice must be 0.5 (battle-math §3 correction)');
  }

  return raw.chart;
}

/* ----------------------------------------------------------------- regions */

/**
 * Part-One region layout.
 *
 * Two sources disagree about the Part-1 shrine order. `sojutsu_progression.csv` lists
 * segment 2 as Ground and segment 3 as Water; `sojutsu-battle-math.md` §13 gives the aces as
 * Leaflark (Grass) / Glacisaur (Water/Ice) / Burrosaur (Ground), and the encounter tables are
 * regenerated "per founder decision 21 (2026-08-07)" into R1 Meadow / R2 Riverside / R3
 * Highland in that order. The manga agrees: Tok Ranting (bark, root, rot) → Tok Sungai (river,
 * silt, pull) → Tok Batu (stone), and the licence book on p49 stamps leaf, wave, then stone.
 *
 * Three sources to one, and the majority are the newer ones. Grass → Water → Ground it is.
 * `sojutsu_progression.csv` segments 2-3 are treated as superseded.
 */
const PART_ONE_REGIONS = [
  {
    id: 'r1-meadow',
    name: 'R1 Meadow',
    segment: 1,
    shrineAspect: 'Grass' as Aspect,
    shrineKeeper: 'Tok Ranting',
    shrineName: 'Thicket Shrine',
    shrineAce: { species: 'leaflark', level: 14 },
    sigil: 1,
    zones: ['Route 1', 'Waystone Road', 'Verdant Thicket'],
    expectedPlayerLevel: 12,
  },
  {
    id: 'r2-riverside',
    name: 'R2 Riverside',
    segment: 2,
    shrineAspect: 'Water' as Aspect,
    shrineKeeper: 'Tok Sungai',
    shrineName: 'Ferry Shrine',
    shrineAce: { species: 'glacisaur', level: 22 },
    sigil: 2,
    zones: ['Riverside Trail', 'Kawa Crossing', 'The Shallows'],
    expectedPlayerLevel: 20,
  },
  {
    id: 'r3-highland',
    name: 'R3 Highland',
    segment: 3,
    shrineAspect: 'Ground' as Aspect,
    shrineKeeper: 'Tok Batu',
    shrineName: 'Quarry Shrine',
    shrineAce: { species: 'burrosaur', level: 29 },
    sigil: 3,
    zones: ['Stone Steps', 'Echo Cavern', 'Ridge Path'],
    expectedPlayerLevel: 30,
  },
] as const;

/* -------------------------------------------------------------------- main */

function write(file: string, data: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function main(): void {
  const moves = buildMoves();
  const species = buildSpecies(moves);
  const speciesById = new Map(species.map((s) => [s.id, s]));
  const encounters = buildEncounters(speciesById);
  const chart = buildAspectChart();

  // Cross-checks the individual builders cannot see on their own.
  for (const region of PART_ONE_REGIONS) {
    if (!speciesById.has(region.shrineAce.species)) {
      fail(`region ${region.id}: shrine ace species "${region.shrineAce.species}" does not exist`);
    }
    for (const zoneName of region.zones) {
      if (!encounters.part1.some((z) => z.zone === zoneName)) {
        fail(`region ${region.id}: zone "${zoneName}" has no encounter table`);
      }
    }
  }
  const v1Count = species.filter((s) => s.inV1).length;
  if (species.length !== 96) fail(`species: expected 96, ingested ${species.length}`);
  if (moves.length !== 104) fail(`moves: expected 104, ingested ${moves.length}`);

  if (problems.length > 0) {
    console.error(`\n✗ ingest failed with ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  • ${p}`);
    process.exitCode = 1;
    return;
  }

  write('moves.json', moves);
  write('species.json', species);
  write('encounters.json', encounters);
  write('aspect-chart.json', chart);
  write('regions.json', PART_ONE_REGIONS);

  console.log('✓ ingest complete');
  console.log(`  species      ${species.length} (${v1Count} in v1, ${species.length - v1Count} reserved for v2)`);
  console.log(`  moves        ${moves.length}`);
  console.log(`  part-1 zones ${encounters.part1.length}   part-2 skeleton ${encounters.part2.length}`);
  console.log(`  regions      ${PART_ONE_REGIONS.length}`);
  if (notes.length > 0) {
    console.log(`\n  ${notes.length} note(s):`);
    for (const n of notes) console.log(`    – ${n}`);
  }
}

main();
