/**
 * What the committed atlases must be true of, and what the build must do when there is no art.
 *
 * Two halves:
 *
 *  1. **The shipped output.** `assets/generated/` is committed because the game loads it at
 *     runtime, which makes it the kind of artefact that rots quietly — someone renames a species,
 *     re-runs the build, and the manifest and the atlas disagree until a scene fails to find a
 *     frame six weeks later. These tests read the files on disk and assert the invariants the
 *     game will rely on at boot: the manifest lists exactly what each atlas contains, all 96
 *     species have both frames, nothing overlaps, nothing is over budget.
 *
 *  2. **The offline path.** A build with no source art and no `reference/` at all must still
 *     produce every frame — that is the property that lets the game layer be written against
 *     frame names before the art lands, and it is the one most likely to be broken by accident
 *     because everyone developing the pipeline has the art sitting right there.
 *
 * Both halves run with no network.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import type { SpeciesDef } from '../../src/core/types.ts';
import { validateAtlas, type AsepriteAtlas } from './aseprite-atlas.ts';
import { dexKey, TILE_FRAMES, UI_FRAMES } from './asset-plan.ts';
import { buildAtlases } from './build-atlases.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'assets', 'generated');

/** Each sheet must stay small enough to be a sane mobile download. */
const ATLAS_BYTE_BUDGET = 2 * 1024 * 1024;

interface ManifestAtlas {
  key: string;
  image: string;
  json: string;
  size: { w: number; h: number };
  frames: string[];
  animations: Array<{ key: string; frames: string[]; frameRate: number; repeat: number }>;
}

interface Manifest {
  schema: number;
  atlases: ManifestAtlas[];
  species: Array<{ id: string; dexNo: number; name: string; dexFrame: string; spiritFrame: string }>;
  tiles: Array<{ frame: string; size: number; region: string | null; overhead: boolean; seamless: boolean }>;
  origins: Record<string, string>;
  placeholders: string[];
}

let manifest: Manifest;
let species: SpeciesDef[];
const atlases = new Map<string, AsepriteAtlas>();

beforeAll(async () => {
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  expect(
    existsSync(manifestPath),
    `${manifestPath} is missing — run "npm run assets" before the test suite`,
  ).toBe(true);

  manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  species = JSON.parse(
    await readFile(path.join(REPO_ROOT, 'src', 'data', 'generated', 'species.json'), 'utf8'),
  ) as SpeciesDef[];

  for (const entry of manifest.atlases) {
    atlases.set(entry.key, JSON.parse(await readFile(path.join(OUT_DIR, entry.json), 'utf8')) as AsepriteAtlas);
  }
});

describe('the committed atlases', () => {
  it('ships every atlas the manifest names, as a PNG and a JSON', () => {
    expect(manifest.atlases.map((a) => a.key).sort()).toEqual([
      'companion',
      'dex',
      'player',
      'spirits',
      'tiles',
      'ui',
    ]);
    for (const entry of manifest.atlases) {
      expect(existsSync(path.join(OUT_DIR, entry.image)), `${entry.image} missing`).toBe(true);
      expect(existsSync(path.join(OUT_DIR, entry.json)), `${entry.json} missing`).toBe(true);
    }
  });

  it('lists in the manifest exactly the frames each atlas actually contains', () => {
    for (const entry of manifest.atlases) {
      const atlas = atlases.get(entry.key)!;
      expect(new Set(entry.frames), `${entry.key}: manifest frames`).toEqual(
        new Set(Object.keys(atlas.frames)),
      );
      expect(entry.frames.length).toBe(Object.keys(atlas.frames).length);
      expect(entry.size, `${entry.key}: manifest sheet size`).toEqual(atlas.meta.size);
    }
  });

  it('packs every frame inside its sheet without overlaps', () => {
    for (const entry of manifest.atlases) {
      const atlas = atlases.get(entry.key)!;
      expect(validateAtlas(atlas, entry.frames), `${entry.key}`).toEqual([]);
    }
  });

  it('writes a PNG whose real dimensions match the JSON', async () => {
    for (const entry of manifest.atlases) {
      const meta = await sharp(path.join(OUT_DIR, entry.image)).metadata();
      expect({ w: meta.width, h: meta.height }, `${entry.key}.png`).toEqual(entry.size);
    }
  });

  it('keeps every atlas inside the size budget', async () => {
    for (const entry of manifest.atlases) {
      const bytes = (await readFile(path.join(OUT_DIR, entry.image))).length;
      expect(bytes, `${entry.image} is ${(bytes / 1024 / 1024).toFixed(2)} MB`).toBeLessThan(
        ATLAS_BYTE_BUDGET,
      );
    }
  });

  it('gives all 96 species a dex frame and a spirit frame', () => {
    const dex = atlases.get('dex')!;
    const spirits = atlases.get('spirits')!;

    expect(species).toHaveLength(96);
    expect(manifest.species).toHaveLength(96);

    for (const s of species) {
      const key = dexKey(s);
      expect(dex.frames[`dex/${key}`], `dex frame for ${s.id}`).toBeDefined();
      expect(spirits.frames[`spirit/${key}`], `spirit frame for ${s.id}`).toBeDefined();
    }

    // And the manifest's own species index agrees with both.
    for (const entry of manifest.species) {
      expect(dex.frames[entry.dexFrame], `${entry.id}: ${entry.dexFrame}`).toBeDefined();
      expect(spirits.frames[entry.spiritFrame], `${entry.id}: ${entry.spiritFrame}`).toBeDefined();
    }
    expect(manifest.species.map((s) => s.id).sort()).toEqual(species.map((s) => s.id).sort());
  });

  it('carries every UI and tile frame the asset plan declares', () => {
    const ui = atlases.get('ui')!;
    for (const piece of UI_FRAMES) expect(ui.frames[piece.frame], piece.frame).toBeDefined();

    const tiles = atlases.get('tiles')!;
    for (const tile of TILE_FRAMES) expect(tiles.frames[tile.frame], tile.frame).toBeDefined();
  });

  it('keeps terrain tiles at their full declared size so they still tile', () => {
    const tiles = atlases.get('tiles')!;
    for (const tile of TILE_FRAMES) {
      if (!tile.seamless) continue;
      const frame = tiles.frames[tile.frame]!;
      expect(frame.trimmed, `${tile.frame} must not be trimmed`).toBe(false);
      expect(frame.frame.w, tile.frame).toBe(tile.size);
      expect(frame.frame.h, tile.frame).toBe(tile.size);
    }
  });

  it('gives the player and companion eight idle rotations and four walk cycles', () => {
    const directions = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'];
    for (const key of ['player', 'companion'] as const) {
      const atlas = atlases.get(key)!;
      for (const dir of directions) {
        expect(atlas.frames[`${key}/idle-${dir}`], `${key}/idle-${dir}`).toBeDefined();
      }
      for (const dir of ['north', 'south', 'east', 'west']) {
        expect(atlas.frames[`${key}/walk-${dir}-0`], `${key}/walk-${dir}-0`).toBeDefined();
      }
      expect(atlas.meta.frameTags.map((t) => t.name)).toEqual([
        'walk-north',
        'walk-south',
        'walk-east',
        'walk-west',
      ]);
    }
  });

  it('only names frames in animations that the atlas really has', () => {
    for (const entry of manifest.atlases) {
      const atlas = atlases.get(entry.key)!;
      for (const animation of entry.animations) {
        expect(animation.frames.length).toBeGreaterThan(0);
        for (const frame of animation.frames) {
          expect(atlas.frames[frame], `${animation.key} → ${frame}`).toBeDefined();
        }
      }
    }
  });

  it('accounts for the origin of every frame it ships', () => {
    const all = manifest.atlases.flatMap((a) => a.frames);
    for (const frame of all) {
      expect(manifest.origins[frame], `no recorded origin for ${frame}`).toBeDefined();
    }
    for (const frame of manifest.placeholders) {
      expect(manifest.origins[frame]).toBe('placeholder');
    }
  });
});

describe('the committed atlases are not stale', () => {
  /**
   * The only test that compares `assets/generated/` against the code that produced it.
   *
   * Everything above checks the shipped files are internally consistent, which they stay even if
   * nobody re-ran the build after editing a prompt, a tile size or the packer. The build is
   * deterministic by design, so a fresh one over the same inputs must land on the same output —
   * and if it does not, the committed atlases are older than the pipeline and the game is
   * shipping pixels no source in the repo explains.
   *
   * PNGs are compared as *decoded pixels* rather than as encoded bytes: the pixels are what the
   * game draws, and comparing the deflate stream would make this fail on a machine whose libvips
   * compresses differently, which is a portability trap, not a staleness signal. The JSON is
   * pure JavaScript output, so that is compared byte for byte.
   */
  it('rebuild from the same inputs reproduces exactly what is committed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sojutsu-atlas-fresh-'));
    try {
      await buildAtlases({ repoRoot: REPO_ROOT, outDir: dir });

      const stale = 'differs from a fresh build — run "npm run assets" and commit the result';

      for (const file of ['manifest.json', ...manifest.atlases.map((a) => a.json)]) {
        const fresh = await readFile(path.join(dir, file), 'utf8');
        const shipped = await readFile(path.join(OUT_DIR, file), 'utf8');
        expect(fresh, `${file} ${stale}`).toBe(shipped);
      }

      for (const entry of manifest.atlases) {
        const fresh = await sharp(path.join(dir, entry.image)).ensureAlpha().raw().toBuffer();
        const shipped = await sharp(path.join(OUT_DIR, entry.image)).ensureAlpha().raw().toBuffer();
        expect(fresh.equals(shipped), `${entry.image} ${stale}`).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('the offline build', () => {
  // Slower than the rest: it renders and packs all six atlases from nothing.
  it('produces every frame with no source art and no reference art at all', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sojutsu-atlas-'));
    try {
      const report = await buildAtlases({
        repoRoot: REPO_ROOT,
        outDir: path.join(dir, 'out'),
        sourceDir: path.join(dir, 'no-source'),
        referenceDir: path.join(dir, 'no-reference'),
      });

      expect(report.atlases.map((a) => a.key).sort()).toEqual([
        'companion',
        'dex',
        'player',
        'spirits',
        'tiles',
        'ui',
      ]);

      const built = JSON.parse(
        await readFile(path.join(dir, 'out', 'manifest.json'), 'utf8'),
      ) as Manifest;

      // Every species still gets both frames — they are just placeholders.
      const dexAtlas = JSON.parse(
        await readFile(path.join(dir, 'out', 'dex.json'), 'utf8'),
      ) as AsepriteAtlas;
      for (const s of species) expect(dexAtlas.frames[`dex/${dexKey(s)}`]).toBeDefined();

      // And every one of them is flagged, so a placeholder can never ship unnoticed.
      expect(report.placeholders.length).toBeGreaterThan(0);
      for (const s of species) expect(report.placeholders).toContain(`dex/${dexKey(s)}`);
      expect(built.placeholders).toEqual(report.placeholders);

      // The deck furniture is drawn, not stubbed, so an offline build still has a usable UI.
      for (const piece of UI_FRAMES) {
        expect(report.origins[piece.frame], piece.frame).toBe('procedural');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
