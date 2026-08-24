/**
 * `npm run assets` — the deterministic atlas build.
 *
 * Reads whatever art exists, in a fixed order of preference, and always produces the same six
 * atlases with the same frame names:
 *
 *   1. `assets/source/generated/` — the committed PixelLab layer (see `pixellab-generate.ts`).
 *   2. `reference/` — the supplied dex plates and character packs, used untouched.
 *   3. procedural — `procedural.ts` draws the deck furniture properly and stands in for the rest.
 *
 * The important property is that step 3 has no gaps: **the build never fails because art is
 * missing.** A contributor with no API key, no network and a fresh clone runs `npm run assets`
 * and gets a complete, correctly-named set of atlases; the frames a generator would have filled
 * come out as clearly-marked placeholders and are listed in `manifest.json` so nobody mistakes
 * them for finished work. That is what lets the game layer be written against frame names before
 * the art exists.
 *
 * Determinism: no timestamps in the output, no `Math.random` (the procedural layer runs on the
 * engine's seeded `Rng`), a stable frame order and a stable packing order. Re-running the build
 * over unchanged inputs rewrites byte-identical files, so the committed `assets/generated/` is
 * diffable and a spurious change in it means an input really did change.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SpeciesDef } from '../../src/core/types.ts';
import {
  packAtlas,
  validateAtlas,
  type AsepriteFrameTag,
  type FrameInput,
  type PackedAtlas,
} from './aseprite-atlas.ts';
import {
  dexKey,
  generationJobs,
  TILE_FRAMES,
  UI_FRAMES,
  type GenerationJob,
} from './asset-plan.ts';
import {
  blit,
  decodePng,
  fitInto,
  flop,
  removeFlatBackground,
  makeSeamless,
  stripHue,
  resizeNearest,
  type RawImage,
} from './pixel-ops.ts';
import { drawTile, drawUiFrame, placeholderFrame } from './procedural.ts';
import { readZip } from './unzip.ts';

/** Battle portrait edge. The math-combat reference shows the portrait slot at roughly this size. */
const DEX_SIZE = 128;
/** Overworld / party icon edge, one world tile. */
const SPIRIT_SIZE = 32;

/** The eight headings the PixelLab character packs are authored in, in clockwise order. */
const DIRECTIONS = [
  'south',
  'south-east',
  'east',
  'north-east',
  'north',
  'north-west',
  'west',
  'south-west',
] as const;
type Direction = (typeof DIRECTIONS)[number];

/**
 * Which walk cycle plays for each heading.
 *
 * The packs ship walk animations for three directions only. Rather than bloat the sheet with
 * five duplicate copies of the east cycle, the atlas carries four cardinal cycles (west being
 * the mirrored east one) and the manifest tells the game which to play for a diagonal. Idle is
 * a full eight rotations because those *are* authored separately.
 */
const WALK_FOR_DIRECTION: Readonly<Record<Direction, 'north' | 'south' | 'east' | 'west'>> = {
  south: 'south',
  'south-east': 'east',
  east: 'east',
  'north-east': 'east',
  north: 'north',
  'north-west': 'west',
  west: 'west',
  'south-west': 'west',
};

export type FrameOrigin = 'generated' | 'reference' | 'procedural' | 'placeholder';

export interface AtlasReport {
  readonly key: string;
  readonly image: string;
  readonly json: string;
  readonly sheet: { w: number; h: number };
  readonly frameCount: number;
  readonly pngBytes: number;
  readonly jsonBytes: number;
}

export interface BuildReport {
  readonly atlases: readonly AtlasReport[];
  readonly placeholders: readonly string[];
  readonly origins: Readonly<Record<string, FrameOrigin>>;
  readonly manifestBytes: number;
}

export interface BuildOptions {
  readonly repoRoot: string;
  /** Defaults to `<repoRoot>/assets/generated`. */
  readonly outDir?: string;
  /** Defaults to `<repoRoot>/assets/source/generated`. */
  readonly sourceDir?: string;
  /** Defaults to `<repoRoot>/reference`. */
  readonly referenceDir?: string;
}

interface AtlasAnimation {
  readonly key: string;
  readonly frames: readonly string[];
  readonly frameRate: number;
  readonly repeat: number;
}

interface BuiltAtlas {
  readonly packed: PackedAtlas;
  readonly animations: readonly AtlasAnimation[];
}

// ---------------------------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------------------------

class SourceResolver {
  readonly origins = new Map<string, FrameOrigin>();

  constructor(private readonly jobs: ReadonlyMap<string, GenerationJob>) {}

  note(frame: string, origin: FrameOrigin): void {
    this.origins.set(frame, origin);
  }

  /**
   * Derived from `origins`, never accumulated alongside it.
   *
   * A frame can be noted twice — `buildUiAtlas` re-notes a composed button once it knows whether
   * the glyph it carries was generated — and a parallel array would keep the first reading
   * forever. `manifest.placeholders` and `manifest.origins` have to agree (the atlas test asserts
   * it), so there is exactly one place the answer lives.
   */
  get placeholders(): string[] {
    return [...this.origins]
      .filter(([, origin]) => origin === 'placeholder')
      .map(([frame]) => frame)
      .sort();
  }

  prefersProcedural(file: string): boolean {
    return this.jobs.get(file)?.preferProcedural === true;
  }
}

async function loadPngIfPresent(file: string): Promise<RawImage | null> {
  if (!existsSync(file)) return null;
  return decodePng(await readFile(file));
}

// ---------------------------------------------------------------------------------------------
// Species atlases
// ---------------------------------------------------------------------------------------------

/**
 * Resolves one species' best available plate.
 *
 * The 24 line-Base forms ship as 64×64 five-colour placeholders (DESIGN.md §7.1), so a
 * regenerated 256×256 plate in the source layer outranks the reference file for those; for the
 * other 72 there is no generated file and the 512×512 original is used directly.
 */
async function speciesPlate(
  species: SpeciesDef,
  sourceDir: string,
  referenceDir: string,
): Promise<{ image: RawImage; origin: FrameOrigin }> {
  const key = dexKey(species);

  const generated = await loadPngIfPresent(path.join(sourceDir, 'dex', `${key}.png`));
  if (generated) return { image: removeFlatBackground(generated), origin: 'generated' };

  const reference = await loadPngIfPresent(path.join(referenceDir, 'monsterdex', 'dex', `${key}.png`));
  if (reference) return { image: removeFlatBackground(reference), origin: 'reference' };

  return { image: placeholderFrame(`dex/${key}`, DEX_SIZE, DEX_SIZE), origin: 'placeholder' };
}

async function buildSpeciesAtlases(
  species: readonly SpeciesDef[],
  sourceDir: string,
  referenceDir: string,
  resolver: SourceResolver,
): Promise<{ dex: BuiltAtlas; spirits: BuiltAtlas }> {
  const dexFrames: FrameInput[] = [];
  const spiritFrames: FrameInput[] = [];

  for (const s of [...species].sort((a, b) => a.dexNo - b.dexNo)) {
    const key = dexKey(s);
    const { image, origin } = await speciesPlate(s, sourceDir, referenceDir);

    // Battle portrait: fit the whole plate into the box so proportions between species hold.
    dexFrames.push({ name: `dex/${key}`, image: fitInto(image, DEX_SIZE, DEX_SIZE, { trim: true, padding: 2 }) });
    // Party icon: trimmed hard, because at 32 px a centred creature in an empty square is mush.
    spiritFrames.push({
      name: `spirit/${key}`,
      image: fitInto(image, SPIRIT_SIZE, SPIRIT_SIZE, { trim: true, padding: 1, anchorY: 1 }),
    });

    resolver.note(`dex/${key}`, origin);
    resolver.note(`spirit/${key}`, origin);
  }

  return {
    dex: { packed: await packAtlas('dex', dexFrames, { trim: true, padding: 2 }), animations: [] },
    spirits: {
      packed: await packAtlas('spirits', spiritFrames, { trim: true, padding: 1 }),
      animations: [],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Character atlases
// ---------------------------------------------------------------------------------------------

interface CharacterPackMeta {
  states?: Array<{
    folder?: string;
    frames?: {
      rotations?: Record<string, string>;
      animations?: Record<string, Record<string, string[]>>;
    };
  }>;
}

/**
 * Builds a character atlas out of a PixelLab export zip.
 *
 * The zip is read straight out of `reference/` and never unpacked to disk — `reference/` is
 * read-only input, and an extracted copy would be a second source of truth that can drift.
 * Paths come from the pack's own `metadata.json` rather than being hard-coded, so a re-export
 * with a different frame count (the player walks in 4, Fawnix in 5) needs no code change.
 */
async function buildCharacterAtlas(
  key: string,
  zipPath: string,
  namespace: string,
  resolver: SourceResolver,
  fallbackSize: number,
): Promise<BuiltAtlas> {
  const frames: FrameInput[] = [];
  const tags: AsepriteFrameTag[] = [];
  const animations: AtlasAnimation[] = [];

  let entries: Map<string, Buffer> | null = null;
  if (existsSync(zipPath)) {
    entries = readZip(await readFile(zipPath));
  }

  const meta = entries ? readPackMeta(entries) : null;
  const rotations = meta?.states?.[0]?.frames?.rotations ?? {};
  const walk = meta?.states?.[0]?.frames?.animations?.['walk'] ?? {};

  const load = async (relative: string | undefined): Promise<RawImage | null> => {
    if (!relative || !entries) return null;
    const data = entries.get(relative);
    if (!data) return null;
    return decodePng(data);
  };

  // --- eight idle rotations -------------------------------------------------------------------
  for (const dir of DIRECTIONS) {
    const name = `${namespace}/idle-${dir}`;
    const image = await load(rotations[dir]);
    if (image) {
      frames.push({ name, image });
      resolver.note(name, 'reference');
    } else {
      frames.push({ name, image: placeholderFrame(name, fallbackSize, fallbackSize) });
      resolver.note(name, 'placeholder');
    }
  }

  // --- walk cycles ----------------------------------------------------------------------------
  // North, south and east are authored. West is the mirror of east, which is exactly how the
  // pack is meant to be used: it ships no west-side animation because a mirror is free and
  // pixel-identical to what a generator would have produced.
  const eastFrames = await Promise.all((walk['east'] ?? []).map((p) => load(p)));

  for (const dir of ['north', 'south', 'east', 'west'] as const) {
    const paths = dir === 'west' ? [] : (walk[dir] ?? []);
    const images: RawImage[] =
      dir === 'west'
        ? eastFrames.filter((i): i is RawImage => i !== null).map((i) => flop(i))
        : (await Promise.all(paths.map((p) => load(p)))).filter((i): i is RawImage => i !== null);

    const from = frames.length;
    if (images.length === 0) {
      // No authored cycle and nothing to mirror: a one-frame "cycle" of the idle rotation keeps
      // the animation key valid so the game never has to branch on missing art.
      const fallbackName = `${namespace}/walk-${dir}-0`;
      const idle = frames.find((f) => f.name === `${namespace}/idle-${dir}`);
      frames.push({
        name: fallbackName,
        image: idle?.image ?? placeholderFrame(fallbackName, fallbackSize, fallbackSize),
        duration: 120,
      });
      resolver.note(fallbackName, idle ? 'reference' : 'placeholder');
    } else {
      images.forEach((image, i) => {
        const name = `${namespace}/walk-${dir}-${i}`;
        frames.push({ name, image, duration: 120 });
        resolver.note(name, 'reference');
      });
    }

    const to = frames.length - 1;
    tags.push({ name: `walk-${dir}`, from, to, direction: 'forward' });
    animations.push({
      key: `${namespace}-walk-${dir}`,
      frames: frames.slice(from, to + 1).map((f) => f.name),
      frameRate: 8,
      repeat: -1,
    });
  }

  return {
    packed: await packAtlas(key, frames, { trim: true, padding: 1, frameTags: tags }),
    animations,
  };
}

function readPackMeta(entries: Map<string, Buffer>): CharacterPackMeta | null {
  for (const [name, data] of entries) {
    if (name.endsWith('metadata.json')) return JSON.parse(data.toString('utf8')) as CharacterPackMeta;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// UI and tiles
// ---------------------------------------------------------------------------------------------

/**
 * The three deck buttons are a plate plus a glyph, and the glyph is one of the `ui/icon-*`
 * frames rather than a second copy of the same drawing. That is why they are composed here
 * instead of in `procedural.ts`: whichever source wins for `ui/icon-backpack` — the generated
 * leather pack or the drawn one — automatically wins for `ui/button-backpack` too, so the
 * standalone icon and the button can never end up showing two different backpacks.
 */
const COMPOSED_BUTTONS: ReadonlyArray<{ button: string; icon: string; scale: number }> = [
  { button: 'ui/button-action', icon: 'ui/icon-spear', scale: 0.62 },
  { button: 'ui/button-dash', icon: 'ui/icon-dash', scale: 0.52 },
  { button: 'ui/button-backpack', icon: 'ui/icon-backpack', scale: 0.58 },
];

async function buildUiAtlas(sourceDir: string, resolver: SourceResolver): Promise<BuiltAtlas> {
  const frames: FrameInput[] = [];
  const byName = new Map<string, RawImage>();

  for (const piece of UI_FRAMES) {
    const image = await resolveUiPiece(piece, sourceDir, resolver);
    frames.push({ name: piece.frame, image });
    byName.set(piece.frame, image);
  }

  for (const spec of COMPOSED_BUTTONS) {
    const plate = byName.get(spec.button);
    const icon = byName.get(spec.icon);
    if (!plate || !icon) continue;
    const box = Math.round(Math.min(plate.width, plate.height) * spec.scale);
    const glyph = fitInto(icon, box, box, { trim: true });
    blit(plate, glyph, Math.round((plate.width - box) / 2), Math.round((plate.height - box) / 2));
    // The button is only as "generated" as the glyph it carries; the plate is always drawn.
    if (resolver.origins.get(spec.icon) === 'generated') resolver.note(spec.button, 'generated');
  }

  return { packed: await packAtlas('ui', frames, { trim: true, padding: 2 }), animations: [] };
}

async function resolveUiPiece(
  piece: (typeof UI_FRAMES)[number],
  sourceDir: string,
  resolver: SourceResolver,
): Promise<RawImage> {
  if (!resolver.prefersProcedural(piece.file)) {
    const generated = await loadPngIfPresent(path.join(sourceDir, piece.file));
    if (generated) {
      resolver.note(piece.frame, 'generated');
      return fitInto(removeFlatBackground(generated), piece.width, piece.height, {
        trim: true,
        padding: 1,
      });
    }
  }

  const procedural = drawUiFrame(piece.frame, piece.width, piece.height);
  if (procedural) {
    resolver.note(piece.frame, 'procedural');
    return procedural;
  }

  resolver.note(piece.frame, 'placeholder');
  return placeholderFrame(piece.frame, piece.width, piece.height);
}

/** What share of a cut-out prop is still opaque. 1.0 means nothing was removed. */
function opaqueFraction(img: { data: Uint8Array | Uint8ClampedArray; width: number; height: number }): number {
  let opaque = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 10) opaque += 1;
  return opaque / (img.width * img.height);
}

/** Stable per-name seed, so a tile's dither is reproducible across builds. */
function hashName(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

async function buildTilesAtlas(sourceDir: string, resolver: SourceResolver): Promise<BuiltAtlas> {
  const frames: FrameInput[] = [];

  for (const tile of TILE_FRAMES) {
    const generated = await loadPngIfPresent(path.join(sourceDir, tile.file));
    if (generated) {
      // Seamless terrain keeps its full square — cutting a "background" out of a grass tile would
      // punch holes in the ground. Props are cut out and fitted, because they stand on the ground.
      // Seamless terrain keeps its full square — cutting a "background" out of a grass tile
      // would punch holes in the ground — and is then genuinely made to tile. Asking the
      // generator for a seamless tile is not the same as getting one; see makeSeamless().
      const cleaned = tile.stripGreens
        ? stripHue(generated, { fromHue: 65, toHue: 175 })
        : generated;

      if (tile.seamless) {
        frames.push({
          name: tile.frame,
          image: makeSeamless(resizeNearest(cleaned, tile.size, tile.size), {
            seed: hashName(tile.frame),
          }),
        });
        resolver.note(tile.frame, 'generated');
        continue;
      }

      const cut = removeFlatBackground(cleaned, { clearEnclosed: true });

      // A prop stands *on* the ground, so it must be cut out of its own picture. When the
      // generator paints the subject onto textured grass rather than a flat field, the border
      // flood has nothing to key on and returns the whole square — which then renders as an
      // opaque rectangle sitting in the middle of the map. Detect that and take the procedural
      // shape instead: a clean silhouette beats a beautiful rectangle.
      if (opaqueFraction(cut) > 0.9) {
        const fallback = drawTile(tile.frame, tile.size);
        if (fallback) {
          frames.push({ name: tile.frame, image: fallback });
          resolver.note(tile.frame, 'procedural');
          console.warn(
            `  ! ${tile.frame}: background removal failed (still ${Math.round(
              opaqueFraction(cut) * 100,
            )}% opaque) — using the procedural shape`,
          );
          continue;
        }
      }

      frames.push({
        name: tile.frame,
        image: fitInto(cut, tile.size, tile.size, { trim: true, anchorY: 1 }),
      });
      resolver.note(tile.frame, 'generated');
      continue;
    }

    const procedural = drawTile(tile.frame, tile.size);
    if (procedural) {
      frames.push({ name: tile.frame, image: procedural });
      resolver.note(tile.frame, 'procedural');
      continue;
    }

    frames.push({ name: tile.frame, image: placeholderFrame(tile.frame, tile.size, tile.size) });
    resolver.note(tile.frame, 'placeholder');
  }

  // Terrain must not be trimmed: a trimmed 32×32 grass tile stops being 32×32 and stops tiling.
  return { packed: await packAtlas('tiles', frames, { trim: false, padding: 2 }), animations: [] };
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

export async function buildAtlases(options: BuildOptions): Promise<BuildReport> {
  const repoRoot = options.repoRoot;
  const outDir = options.outDir ?? path.join(repoRoot, 'assets', 'generated');
  const sourceDir = options.sourceDir ?? path.join(repoRoot, 'assets', 'source', 'generated');
  const referenceDir = options.referenceDir ?? path.join(repoRoot, 'reference');

  const species = JSON.parse(
    await readFile(path.join(repoRoot, 'src', 'data', 'generated', 'species.json'), 'utf8'),
  ) as SpeciesDef[];

  const jobs = new Map<string, GenerationJob>(generationJobs(species).map((j) => [j.file, j]));
  const resolver = new SourceResolver(jobs);

  await mkdir(outDir, { recursive: true });

  const { dex, spirits } = await buildSpeciesAtlases(species, sourceDir, referenceDir, resolver);
  const player = await buildCharacterAtlas(
    'player',
    path.join(referenceDir, 'characters', 'Manga_Sojutsuka_Player.zip'),
    'player',
    resolver,
    48,
  );
  const companion = await buildCharacterAtlas(
    'companion',
    path.join(referenceDir, 'characters', 'Manga_Fawnix.zip'),
    'companion',
    resolver,
    32,
  );
  const ui = await buildUiAtlas(sourceDir, resolver);
  const tiles = await buildTilesAtlas(sourceDir, resolver);

  const built: Array<[string, BuiltAtlas]> = [
    ['dex', dex],
    ['spirits', spirits],
    ['player', player],
    ['companion', companion],
    ['ui', ui],
    ['tiles', tiles],
  ];

  const reports: AtlasReport[] = [];
  const manifestAtlases: unknown[] = [];

  for (const [key, atlas] of built) {
    const problems = validateAtlas(atlas.packed.atlas, atlas.packed.order);
    if (problems.length > 0) {
      throw new Error(`atlas "${key}" failed validation:\n  ${problems.join('\n  ')}`);
    }

    const json = `${JSON.stringify(atlas.packed.atlas, null, 2)}\n`;
    await writeFile(path.join(outDir, `${key}.png`), atlas.packed.png);
    await writeFile(path.join(outDir, `${key}.json`), json, 'utf8');

    reports.push({
      key,
      image: `${key}.png`,
      json: `${key}.json`,
      sheet: atlas.packed.sheet,
      frameCount: atlas.packed.order.length,
      pngBytes: atlas.packed.png.length,
      jsonBytes: Buffer.byteLength(json),
    });

    manifestAtlases.push({
      key,
      image: `${key}.png`,
      json: `${key}.json`,
      size: atlas.packed.sheet,
      frames: atlas.packed.order,
      animations: atlas.animations,
    });
  }

  const origins = Object.fromEntries([...resolver.origins].sort(([a], [b]) => (a < b ? -1 : 1)));

  const manifest = {
    schema: 1,
    // No timestamp on purpose: the build is deterministic and the output is committed, so a diff
    // in assets/generated/ should always mean an input changed.
    atlases: manifestAtlases,
    species: [...species]
      .sort((a, b) => a.dexNo - b.dexNo)
      .map((s) => ({
        id: s.id,
        dexNo: s.dexNo,
        name: s.name,
        dexFrame: `dex/${dexKey(s)}`,
        spiritFrame: `spirit/${dexKey(s)}`,
      })),
    tiles: TILE_FRAMES.map((t) => ({
      frame: t.frame,
      size: t.size,
      region: t.region,
      overhead: t.overhead === true,
      seamless: t.seamless,
    })),
    characters: {
      player: { atlas: 'player', directions: DIRECTIONS, walkForDirection: WALK_FOR_DIRECTION },
      companion: { atlas: 'companion', directions: DIRECTIONS, walkForDirection: WALK_FOR_DIRECTION },
    },
    origins,
    placeholders: [...resolver.placeholders].sort(),
  };

  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(outDir, 'manifest.json'), manifestJson, 'utf8');

  return {
    atlases: reports,
    placeholders: [...resolver.placeholders].sort(),
    origins,
    manifestBytes: Buffer.byteLength(manifestJson),
  };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} kB`;
}

async function main(): Promise<void> {
  const report = await buildAtlases({ repoRoot: REPO_ROOT });

  console.info('atlas       sheet        frames   png        json');
  console.info('---------------------------------------------------------');
  let total = 0;
  for (const a of report.atlases) {
    total += a.pngBytes + a.jsonBytes;
    console.info(
      `${a.key.padEnd(11)} ${`${a.sheet.w}×${a.sheet.h}`.padEnd(12)} ${String(a.frameCount).padStart(6)}   ` +
        `${formatBytes(a.pngBytes).padStart(9)}  ${formatBytes(a.jsonBytes).padStart(9)}`,
    );
    if (a.pngBytes > 2 * 1024 * 1024) {
      console.warn(`  ! ${a.key}.png is over the 2 MB budget`);
    }
  }
  console.info('---------------------------------------------------------');
  console.info(`total ${formatBytes(total + report.manifestBytes)} across ${report.atlases.length} atlases`);

  const counts = new Map<FrameOrigin, number>();
  for (const origin of Object.values(report.origins)) {
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  console.info(
    `frames by origin: ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ')}`,
  );
  if (report.placeholders.length > 0) {
    console.warn(`${report.placeholders.length} placeholder frame(s): ${report.placeholders.join(', ')}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
