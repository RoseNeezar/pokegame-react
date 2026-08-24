/**
 * Turns a `GeneratedZone` into Phaser display objects.
 *
 * Layers follow the research bundle's recommended scene package exactly — ground, lower props,
 * animated water, actors, overhead, lighting — because that split is what makes the Eastward
 * look work: actors pass *behind* canopies and *in front of* their trunks, water animates in
 * local regions rather than by swapping the whole plate, and lighting is presentation only, so
 * gameplay stays correct with it switched off.
 *
 * Ground and props are baked into RenderTextures once per zone rather than kept as thousands of
 * live sprites. A 44 × 62 zone is 2,700 tiles; drawing them individually every frame is the
 * difference between a smooth phone and a slideshow.
 */
import Phaser from 'phaser';
import { DEPTH, PALETTE, TILE } from '../layout.ts';
import { isEncounterTerrain, type GeneratedZone, type PropKind, type Terrain } from './generate.ts';
import type { Biome, ZoneDef } from './zones.ts';

/** Fallback flat colours, used per-tile when the tiles atlas has no matching frame. */
const TERRAIN_COLOUR: Record<Terrain, number> = {
  ground: 0x4a5a3a,
  path: 0x6d6047,
  grass: 0x3c5230,
  water: 0x1f3a4a,
  shallow: 0x2f5a63,
  rock: 0x4b4b52,
  wall: 0x22242c,
  floor: 0x5a5646,
};

const PROP_COLOUR: Record<PropKind, number> = {
  tree: 0x2c4326,
  bush: 0x39512f,
  rock: 0x55555c,
  reed: 0x4f6b41,
  lantern: 0xff9a3c,
  waystone: 0x8a8f9c,
  torii: 0xa8432f,
  house: 0x6b543a,
  crate: 0x7a6039,
  stump: 0x51412c,
  flower: 0xc9a0d0,
};

/**
 * Terrain → atlas frame, per biome.
 *
 * The tiles atlas ships one grass and one road per region rather than a full tileset per biome,
 * so a region's identity comes from *which* terrain its generator paints and what is scattered
 * on top. That keeps the atlas at 256 × 512 instead of six times that, which matters on a phone.
 */
type TerrainMap = Partial<Record<Terrain, string>>;

const BIOME_TERRAIN: Record<Biome, TerrainMap> = {
  meadow: {
    ground: 'tiles/grass-0',
    grass: 'tiles/tall-grass-0',
    path: 'tiles/dirt-path-0',
    rock: 'tiles/stone-1',
    wall: 'tiles/stone-0',
    floor: 'tiles/stone-0',
  },
  thicket: {
    ground: 'tiles/grass-0',
    grass: 'tiles/tall-grass-0',
    path: 'tiles/dirt-path-0',
    rock: 'tiles/stone-1',
    wall: 'tiles/stone-0',
    floor: 'tiles/stone-0',
  },
  riverside: {
    ground: 'tiles/grass-1',
    grass: 'tiles/tall-grass-1',
    path: 'tiles/dirt-path-0',
    rock: 'tiles/stone-1',
    wall: 'tiles/stone-0',
    floor: 'tiles/bridge-planks-0',
  },
  shallows: {
    ground: 'tiles/grass-1',
    grass: 'tiles/tall-grass-1',
    path: 'tiles/bridge-planks-0',
    rock: 'tiles/stone-1',
    wall: 'tiles/stone-0',
    floor: 'tiles/bridge-planks-0',
  },
  highland: {
    ground: 'tiles/grass-2',
    grass: 'tiles/tall-grass-2',
    path: 'tiles/dirt-path-1',
    rock: 'tiles/stone-1',
    wall: 'tiles/stone-0',
    floor: 'tiles/stone-0',
  },
  cavern: {
    ground: 'tiles/dirt-path-1',
    grass: 'tiles/dirt-path-1',
    path: 'tiles/dirt-path-1',
    rock: 'tiles/stone-1',
    wall: 'tiles/stone-0',
    floor: 'tiles/stone-0',
  },
  town: {
    ground: 'tiles/grass-0',
    grass: 'tiles/grass-0',
    path: 'tiles/stone-0',
    rock: 'tiles/stone-1',
    wall: 'tiles/stone-0',
    floor: 'tiles/stone-0',
  },
  shrine: {
    ground: 'tiles/grass-2',
    grass: 'tiles/tall-grass-2',
    path: 'tiles/stone-1',
    rock: 'tiles/stone-1',
    wall: 'tiles/stone-0',
    floor: 'tiles/stone-1',
  },
};

/** Water is the same everywhere; only its margin changes. */
const WATER_FRAMES: TerrainMap = {
  water: 'tiles/water-deep-0',
  shallow: 'tiles/water-edge-0',
};

function terrainFrame(biome: Biome, t: Terrain): string | null {
  return WATER_FRAMES[t] ?? BIOME_TERRAIN[biome][t] ?? null;
}

/**
 * Prop → atlas frame, split by layer.
 *
 * A tree is two frames, not one: the trunk belongs on `lower-props` so the player collides with
 * it and walks in front of it, while the canopy belongs on `overhead` so the player walks
 * *behind* it. That split is the whole reason the research bundle lists them as separate layers,
 * and it is what makes a top-down forest read as having depth.
 */
const PROP_FRAMES: Partial<Record<PropKind, { lower?: string[]; overhead?: string[] }>> = {
  tree: { lower: ['tiles/tree-trunk-0'], overhead: ['tiles/tree-canopy-0'] },
  rock: { lower: ['tiles/rock-0', 'tiles/rock-1'] },
  reed: { lower: ['tiles/reeds-0'] },
  waystone: { lower: ['tiles/waystone-0'] },
  lantern: { lower: ['tiles/lantern-0'] },
  torii: { overhead: ['tiles/shrine-torii-0'] },
  bush: { lower: ['tiles/bush-0', 'tiles/bush-1'] },
  flower: { lower: ['tiles/flower-0'] },
  stump: { lower: ['tiles/stump-0'] },
  crate: { lower: ['tiles/crate-0'] },
  // A house is tall: its walls belong under the actors and its roof over them, so the player
  // walks in at the door and disappears behind the eaves.
  house: { lower: ['tiles/house-0', 'tiles/house-1'], overhead: [] },
};

function propFrames(kind: PropKind, variant: number): { lower: string | null; overhead: string | null } {
  const entry = PROP_FRAMES[kind];
  const pick = (list?: string[]): string | null =>
    list && list.length > 0 ? (list[variant % list.length] ?? list[0]!) : null;
  return { lower: pick(entry?.lower), overhead: pick(entry?.overhead) };
}

/** Deterministic per-tile hash, used to vary orientation. */
function tileHash(tx: number, ty: number): number {
  let h = (tx * 374761393 + ty * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return h >>> 0;
}

export class ZoneRenderer {
  private readonly scene: Phaser.Scene;
  private readonly zone: ZoneDef;
  private readonly data: GeneratedZone;

  private ground!: Phaser.GameObjects.RenderTexture;
  private lowerProps!: Phaser.GameObjects.RenderTexture;
  private overhead!: Phaser.GameObjects.RenderTexture;
  private waterTiles: Phaser.GameObjects.Rectangle[] = [];
  private lights!: Phaser.GameObjects.Graphics;
  private vignette!: Phaser.GameObjects.Graphics;
  private waterPhase = 0;

  constructor(scene: Phaser.Scene, zone: ZoneDef, data: GeneratedZone) {
    this.scene = scene;
    this.zone = zone;
    this.data = data;
  }

  get pixelWidth(): number {
    return this.data.width * TILE;
  }

  get pixelHeight(): number {
    return this.data.height * TILE;
  }

  build(): void {
    const w = this.pixelWidth;
    const h = this.pixelHeight;
    const hasTiles = this.scene.textures.exists('tiles');

    this.ground = this.scene.add.renderTexture(0, 0, w, h).setOrigin(0, 0).setDepth(DEPTH.ground);
    this.lowerProps = this.scene.add
      .renderTexture(0, 0, w, h)
      .setOrigin(0, 0)
      .setDepth(DEPTH.lowerProps);
    this.overhead = this.scene.add.renderTexture(0, 0, w, h).setOrigin(0, 0).setDepth(DEPTH.overhead);

    this.paintGround(hasTiles);
    this.paintProps(hasTiles);
    this.buildWater();
    this.buildLighting();
  }

  /* ------------------------------------------------------------- ground */

  /**
   * Bakes the ground.
   *
   * Terrain tiles are drawn unmirrored, deliberately. Mirroring is the obvious way to break up
   * repetition and it is wrong here: the tiles are made seamless by matching their own opposite
   * edges, and a mirrored tile's edge no longer matches its unmirrored neighbour's. Flipping
   * them put a dark seam back on every other tile boundary — the exact grid it was meant to
   * hide.
   *
   * Variety comes from the props scattered on top instead. Encounter terrain also gets a tuft
   * overlay, which is not decoration: it is the game saying, in the genre's own language, where
   * a spirit can reach you. The road is safe and the grass is not, and that must be visible at
   * a glance.
   */
  private paintGround(hasTiles: boolean): void {
    const { width, height, terrain } = this.data;
    const tex = hasTiles ? this.scene.textures.get('tiles') : null;
    const swatch = this.scene.add.graphics().setVisible(false);

    this.ground.beginDraw();
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const t = terrain[ty * width + tx]!;
        const frame = terrainFrame(this.zone.biome, t);
        const h = tileHash(tx, ty);

        if (frame && tex?.has(frame)) {
          this.ground.batchDrawFrame('tiles', frame, tx * TILE, ty * TILE);
        } else {
          // No authored tile: paint a shaded flat colour so the map is still readable.
          swatch.clear();
          const variant = h % 3;
          const base = TERRAIN_COLOUR[t];
          swatch.fillStyle(shade(base, variant === 0 ? 0 : variant === 1 ? 0.06 : -0.06), 1);
          swatch.fillRect(0, 0, TILE, TILE);
          this.ground.batchDraw(swatch, tx * TILE, ty * TILE);
        }

        // Encounter terrain now has its own tile per region, so it no longer needs an
        // overlay to be told apart from the ground beside it. The tufts remain only as the
        // fallback for a build with no tiles atlas at all.
        if (!tex && isEncounterTerrain(this.zone.biome, t)) {
          swatch.clear();
          drawTufts(swatch, h);
          this.ground.batchDraw(swatch, tx * TILE, ty * TILE);
        }
      }
    }
    this.ground.endDraw();
    swatch.destroy();
  }

  /* -------------------------------------------------------------- props */

  private paintProps(hasTiles: boolean): void {
    const tex = hasTiles ? this.scene.textures.get('tiles') : null;
    const swatch = this.scene.add.graphics().setVisible(false);

    // Props are sorted by feet-Y so overlapping props stack correctly inside their own layer.
    const sorted = [...this.data.props].sort((a, b) => a.ty - b.ty);

    for (const p of sorted) {
      const px = p.tx * TILE;
      const py = p.ty * TILE;
      const frames = propFrames(p.kind, p.variant);
      let drewSomething = false;

      // Anchor every prop by its feet, so a tall piece sits on its own tile rather than
      // floating above it.
      const place = (frame: string, target: Phaser.GameObjects.RenderTexture): void => {
        const f = tex!.get(frame);
        target.drawFrame('tiles', frame, px + (TILE - f.width) / 2, py + TILE - f.height);
      };

      if (tex && frames.lower && tex.has(frames.lower)) {
        place(frames.lower, this.lowerProps);
        drewSomething = true;
      }
      if (tex && frames.overhead && tex.has(frames.overhead)) {
        place(frames.overhead, this.overhead);
        drewSomething = true;
      }
      if (drewSomething) continue;

      swatch.clear();
      drawFallbackProp(swatch, p.kind, p.variant);
      (p.overhead ? this.overhead : this.lowerProps).draw(swatch, px, py);
    }

    swatch.destroy();
  }

  /* -------------------------------------------------------------- water */

  /**
   * Local animated water regions, not a whole-plate swap.
   *
   * The feasibility document is explicit that replacing the entire scene image for six water
   * frames would cost ~36 MiB of texture; animating only the water tiles costs nothing. All
   * tiles share one phase clock so neighbouring tiles never tear at their seams.
   */
  private buildWater(): void {
    const { width, height, terrain } = this.data;
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const t = terrain[ty * width + tx]!;
        if (t !== 'water' && t !== 'shallow') continue;
        const r = this.scene.add
          .rectangle(tx * TILE, ty * TILE, TILE, TILE, t === 'water' ? 0x2b6b86 : 0x3f8f9c, 0.35)
          .setOrigin(0, 0)
          .setDepth(DEPTH.animatedWater);
        r.setData('phase', ((tx * 3 + ty * 5) % 6) / 6);
        this.waterTiles.push(r);
      }
    }
  }

  /* ------------------------------------------------------------ lighting */

  /**
   * Lighting is presentation only.
   *
   * The acceptance criteria in the feasibility document require that gameplay stays correct with
   * lighting disabled, so nothing here touches collision or state — it is a vignette and a set
   * of additive glows under the actors.
   */
  private buildLighting(): void {
    this.lights = this.scene.add.graphics().setDepth(DEPTH.lighting).setBlendMode(Phaser.BlendModes.ADD);
    for (const p of this.data.props) {
      if (p.kind !== 'lantern' && p.kind !== 'waystone') continue;
      const cx = p.tx * TILE + TILE / 2;
      const cy = p.ty * TILE + TILE / 2;
      const colour = p.kind === 'lantern' ? PALETTE.ember : PALETTE.cyan;
      for (let i = 4; i >= 1; i--) {
        this.lights.fillStyle(colour, 0.045 * i);
        this.lights.fillCircle(cx, cy, 10 + i * 13);
      }
    }

    // A soft frame darkening, applied to the camera rather than the world.
    this.vignette = this.scene.add
      .graphics()
      .setScrollFactor(0)
      .setDepth(DEPTH.lighting + 1);
  }

  /** Called each frame; advances the shared water clock. */
  update(_time: number, delta: number): void {
    this.waterPhase = (this.waterPhase + delta / 1000) % 6;
    for (const tile of this.waterTiles) {
      const phase = (this.waterPhase + (tile.getData('phase') as number) * 6) % 6;
      // Three-step shimmer: cheap, seam-safe, and it reads as moving water at this scale.
      const step = Math.floor(phase / 2);
      tile.setAlpha(step === 0 ? 0.28 : step === 1 ? 0.42 : 0.34);
    }
  }

  destroy(): void {
    this.ground?.destroy();
    this.lowerProps?.destroy();
    this.overhead?.destroy();
    this.lights?.destroy();
    this.vignette?.destroy();
    for (const t of this.waterTiles) t.destroy();
    this.waterTiles = [];
  }
}

/* ------------------------------------------------------------- fallbacks */

function shade(colour: number, amount: number): number {
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v + v * amount)));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

/**
 * Stand-in prop shapes.
 *
 * These are deliberately simple silhouettes rather than magenta error blocks: a zone whose art
 * has not been generated yet should still be *playable and legible*, so collision, encounters
 * and routing can be tested before the atlases land.
 */
function drawFallbackProp(g: Phaser.GameObjects.Graphics, kind: PropKind, variant: number): void {
  const c = PROP_COLOUR[kind];
  switch (kind) {
    case 'tree':
      g.fillStyle(0x3a2c1e, 1);
      g.fillRect(TILE * 0.4, TILE * 0.55, TILE * 0.2, TILE * 0.45);
      g.fillStyle(c, 1);
      g.fillCircle(TILE * 0.5, TILE * 0.42, TILE * (0.38 + variant * 0.03));
      g.fillStyle(shade(c, 0.25), 1);
      g.fillCircle(TILE * 0.4, TILE * 0.33, TILE * 0.18);
      break;
    case 'house':
      g.fillStyle(c, 1);
      g.fillRect(0, TILE * 0.35, TILE * 2, TILE * 1.4);
      g.fillStyle(0x53331f, 1);
      g.fillTriangle(-TILE * 0.15, TILE * 0.4, TILE * 2.15, TILE * 0.4, TILE, -TILE * 0.5);
      g.fillStyle(0x241a12, 1);
      g.fillRect(TILE * 0.8, TILE * 1.05, TILE * 0.42, TILE * 0.7);
      break;
    case 'torii':
      g.fillStyle(c, 1);
      g.fillRect(-TILE * 0.9, -TILE * 0.4, TILE * 2.8, TILE * 0.26);
      g.fillRect(-TILE * 0.6, TILE * 0.05, TILE * 2.2, TILE * 0.18);
      g.fillRect(-TILE * 0.35, -TILE * 0.3, TILE * 0.28, TILE * 1.6);
      g.fillRect(TILE * 1.1, -TILE * 0.3, TILE * 0.28, TILE * 1.6);
      break;
    case 'waystone':
      g.fillStyle(c, 1);
      g.fillRect(TILE * 0.24, TILE * 0.1, TILE * 0.52, TILE * 0.9);
      g.fillStyle(PALETTE.cyan, 0.85);
      g.fillRect(TILE * 0.36, TILE * 0.3, TILE * 0.28, TILE * 0.12);
      g.fillRect(TILE * 0.36, TILE * 0.52, TILE * 0.28, TILE * 0.12);
      break;
    case 'lantern':
      g.fillStyle(0x2f2a22, 1);
      g.fillRect(TILE * 0.44, TILE * 0.42, TILE * 0.12, TILE * 0.58);
      g.fillStyle(c, 1);
      g.fillCircle(TILE * 0.5, TILE * 0.34, TILE * 0.2);
      break;
    case 'rock':
      g.fillStyle(c, 1);
      g.fillEllipse(TILE * 0.5, TILE * 0.66, TILE * (0.62 + variant * 0.06), TILE * 0.5);
      g.fillStyle(shade(c, 0.22), 1);
      g.fillEllipse(TILE * 0.42, TILE * 0.56, TILE * 0.28, TILE * 0.2);
      break;
    case 'crate':
      g.fillStyle(c, 1);
      g.fillRect(TILE * 0.16, TILE * 0.3, TILE * 0.68, TILE * 0.66);
      g.fillStyle(shade(c, -0.3), 1);
      g.fillRect(TILE * 0.16, TILE * 0.58, TILE * 0.68, TILE * 0.08);
      break;
    case 'reed':
      g.lineStyle(2, c, 1);
      for (let i = 0; i < 3 + variant; i++) {
        const x = TILE * (0.25 + i * 0.18);
        g.beginPath();
        g.moveTo(x, TILE);
        g.lineTo(x + (i % 2 === 0 ? 3 : -3), TILE * 0.28);
        g.strokePath();
      }
      break;
    case 'stump':
      g.fillStyle(c, 1);
      g.fillEllipse(TILE * 0.5, TILE * 0.72, TILE * 0.5, TILE * 0.34);
      break;
    case 'flower':
      g.fillStyle(0x3f5a34, 1);
      g.fillRect(TILE * 0.48, TILE * 0.6, 2, TILE * 0.36);
      g.fillStyle(c, 1);
      g.fillCircle(TILE * 0.49, TILE * 0.56, 3.5);
      break;
    case 'bush':
    default:
      g.fillStyle(c, 1);
      g.fillCircle(TILE * 0.5, TILE * 0.66, TILE * (0.3 + variant * 0.04));
      g.fillStyle(shade(c, 0.2), 1);
      g.fillCircle(TILE * 0.42, TILE * 0.58, TILE * 0.14);
      break;
  }
}

/**
 * Tall-grass tufts.
 *
 * Drawn over encounter terrain so the player can see, without being told, where a wild spirit
 * can reach them. Three blades on a per-tile hash, so they never march in step with the tile
 * grid underneath.
 */
function drawTufts(g: Phaser.GameObjects.Graphics, hash: number): void {
  const blades = 3 + (hash % 2);
  for (let i = 0; i < blades; i++) {
    const h = (hash >>> (i * 5)) & 0x1f;
    const x = 4 + ((h * 7) % (TILE - 8));
    const y = 6 + ((h * 11) % (TILE - 12));
    const tall = 5 + (h % 4);
    g.fillStyle(0x1e3318, 0.55);
    g.fillRect(x, y, 2, tall);
    g.fillStyle(0x4d7a35, 0.85);
    g.fillRect(x - 1, y + 1, 2, tall - 2);
    g.fillRect(x + 2, y + 3, 2, tall - 4);
  }
}
