/**
 * The single, declarative catalogue of every generated art asset.
 *
 * Both halves of the pipeline read this file and nothing else decides what exists:
 *
 *   • `pixellab-generate.ts` walks it, asks PixelLab for anything not already on disk, and
 *     writes the results into `assets/source/generated/`.
 *   • `build-atlases.ts` walks the same list to decide which source files to *look* for, and
 *     substitutes a procedural stand-in for every one that is missing.
 *
 * Keeping it in one place is what makes the build work offline. The build never asks "what did
 * the generator happen to produce?" — it asks "what should exist?", finds out what does, and
 * fills the gaps. So a clean checkout with no `assets/source/generated/` at all still produces a
 * complete, correctly-named set of atlases; only the pixels differ.
 *
 * Prompts live here too, next to the frame names they produce, because a prompt is the asset's
 * source code. Editing one and re-running `npm run assets:generate` is how art changes.
 */
import type { SpeciesDef } from '../../src/core/types.ts';

/**
 * Appended to every creature prompt. Fixed by the art direction — do not vary it per species,
 * or 96 spirits stop looking like they come from the same world.
 */
export const MONSTER_STYLE =
  'pixel art creature sprite, centred, transparent background, muted earthy palette, ' +
  'moss green and rain grey with warm ember accents, rain-worn dark-fantasy manga mood, ' +
  'clean readable silhouette';

export const TILE_STYLE =
  'top-down pixel art tile, seamless, muted earthy palette, moss green and rain grey, ' +
  'rain-worn dark-fantasy manga mood';

/**
 * The deck overlay is drawn *over* the world, so it is smooth vector-ish UI rather than pixel
 * art (see `reference/visual/exploration-mode-reference.png`). PixelLab is a sprite generator;
 * it is asked for the pieces that read as objects — icons, plates, ornament — and the pieces
 * that are pure geometry at exact pixel sizes are rasterised procedurally instead, where the
 * palette can be matched to the reference exactly. `preferProcedural` records that judgement per
 * piece so it is visible and reversible rather than buried in the builder.
 */
export const UI_STYLE =
  'game UI element, pixel art, centred on a plain flat background, muted earthy palette, ' +
  'moss green and rain grey with a cool cyan accent, rain-worn dark-fantasy manga mood';

export type AssetGroup = 'dex' | 'tiles' | 'ui';

export interface GenerationJob {
  /** Path under `assets/source/generated/`, e.g. `dex/069-fawnix.png`. */
  readonly file: string;
  readonly group: AssetGroup;
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  /**
   * True when the procedural rasteriser produces a better result than a generated raster and the
   * generated file is only kept as a reference. The builder still prefers a file on disk, so
   * deleting the procedural preference is a one-line change.
   */
  readonly preferProcedural?: boolean;
}

/** A frame the tiles atlas must contain, and the source file that would fill it. */
export interface TileFrame {
  readonly frame: string;
  readonly file: string;
  readonly size: number;
  /** Which Part-One region this dresses. `null` = shared. */
  readonly region: 'R1-meadow' | 'R2-riverside' | 'R3-highland' | null;
  /** Rendered above the actor layer (canopies) rather than below it. */
  readonly overhead?: boolean;
  /** Tiles must tile; props must not be treated as seamless. */
  readonly seamless: boolean;
  /**
   * Remove the green hue band from the source art.
   *
   * Set where the generator baked vegetation into a surface tile — it draws the verges of a
   * road as readily as the road, and repeated across a map those verges read as stripes.
   * See `stripHue()` in pixel-ops.
   */
  readonly stripGreens?: boolean;
}

export interface UiFrame {
  readonly frame: string;
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

/** Zero-padded dex number, the ordering key for every species-derived name. */
export function dexKey(species: SpeciesDef): string {
  return `${String(species.dexNo).padStart(3, '0')}-${species.id}`;
}

/**
 * Exactly the 24 line-Base forms shipped as 64×64 five-colour placeholders (DESIGN.md §7.1).
 * Detected by source dimension rather than by dex number so a founder who replaces one of the
 * originals with real art immediately drops out of the regeneration set.
 */
export const PLACEHOLDER_SOURCE_EDGE = 64;

/**
 * Species whose first generation came back as a *scene* — the creature standing in a forest or
 * a rain-lit clearing, with the environment baked into the plate. Those cannot be cut out (the
 * background is not flat, so the flood fill has nothing to seize on) and a 32×32 party icon of a
 * baked forest is unreadable. The override adds an isolation clause for exactly those five, and
 * is kept as an override rather than folded into every prompt so the nineteen plates that came
 * out well stay reproducible from the prompt that actually produced them.
 */
const MONSTER_ISOLATION =
  'isolated on a plain flat solid background, no scenery, no grass, no trees, no environment, ' +
  'single full-body creature';

const MONSTER_PROMPT_OVERRIDES: ReadonlySet<string> = new Set([
  'gearbit',
  'brontide',
  'buzzle',
  'wickisp',
  'hootusk',
]);

export function monsterPrompt(species: SpeciesDef): string {
  const aspects = species.aspects.join(' and ');
  const stage =
    species.stage === 'Base'
      ? 'a small young creature'
      : species.stage === 'Stage 2'
        ? 'a grown adolescent creature'
        : 'a fully evolved imposing creature';
  const isolation = MONSTER_PROMPT_OVERRIDES.has(species.id) ? `, ${MONSTER_ISOLATION}` : '';
  return `${species.blurb}, ${stage}, ${aspects} aspect spirit${isolation}, ${MONSTER_STYLE}`;
}

export function monsterJob(species: SpeciesDef): GenerationJob {
  return {
    file: `dex/${dexKey(species)}.png`,
    group: 'dex',
    prompt: monsterPrompt(species),
    width: 256,
    height: 256,
  };
}

/**
 * Terrain and props for the three Part-One regions. Terrain is 32×32 to match the character
 * packs' "low top-down" scale (a 48×48 player standing on a 32×32 tile is the Eastward ratio);
 * hero props are larger because a torii or a canopy is a landmark, not a floor.
 */
export const TILE_FRAMES: readonly TileFrame[] = [
  { frame: 'tiles/grass-0', file: 'tiles/grass-0.png', size: 32, region: 'R1-meadow', seamless: true },
  { frame: 'tiles/grass-1', file: 'tiles/grass-1.png', size: 32, region: 'R2-riverside', seamless: true },
  { frame: 'tiles/grass-2', file: 'tiles/grass-2.png', size: 32, region: 'R3-highland', seamless: true },
  { frame: 'tiles/tall-grass-0', file: 'tiles/tall-grass-0.png', size: 32, region: 'R1-meadow', seamless: true },
  { frame: 'tiles/tall-grass-1', file: 'tiles/tall-grass-1.png', size: 32, region: 'R2-riverside', seamless: true },
  { frame: 'tiles/tall-grass-2', file: 'tiles/tall-grass-2.png', size: 32, region: 'R3-highland', seamless: true },
  {
    frame: 'tiles/dirt-path-0',
    file: 'tiles/dirt-path-0.png',
    size: 32,
    region: 'R1-meadow',
    seamless: true,
    // The generator draws verges on every road it is asked for. See stripHue().
    stripGreens: true,
  },
  { frame: 'tiles/dirt-path-1', file: 'tiles/dirt-path-1.png', size: 32, region: 'R3-highland', seamless: true },
  { frame: 'tiles/stone-0', file: 'tiles/stone-0.png', size: 32, region: 'R3-highland', seamless: true },
  { frame: 'tiles/stone-1', file: 'tiles/stone-1.png', size: 32, region: null, seamless: true },
  { frame: 'tiles/water-edge-0', file: 'tiles/water-edge-0.png', size: 32, region: 'R2-riverside', seamless: true },
  { frame: 'tiles/water-deep-0', file: 'tiles/water-deep-0.png', size: 32, region: 'R2-riverside', seamless: true },
  // Reeds are a clump you stand beside, not a floor you stand on — a prop, so it gets cut out.
  { frame: 'tiles/reeds-0', file: 'tiles/reeds-0.png', size: 32, region: 'R2-riverside', seamless: false },
  { frame: 'tiles/bridge-planks-0', file: 'tiles/bridge-planks-0.png', size: 32, region: 'R2-riverside', seamless: true },
  { frame: 'tiles/bush-0', file: 'tiles/bush-0.png', size: 32, region: null, seamless: false },
  { frame: 'tiles/bush-1', file: 'tiles/bush-1.png', size: 32, region: 'R3-highland', seamless: false },
  { frame: 'tiles/flower-0', file: 'tiles/flower-0.png', size: 32, region: null, seamless: false },
  { frame: 'tiles/stump-0', file: 'tiles/stump-0.png', size: 32, region: null, seamless: false },
  { frame: 'tiles/crate-0', file: 'tiles/crate-0.png', size: 32, region: null, seamless: false },
  { frame: 'tiles/house-0', file: 'tiles/house-0.png', size: 96, region: null, seamless: false, overhead: true },
  { frame: 'tiles/house-1', file: 'tiles/house-1.png', size: 96, region: null, seamless: false, overhead: true },
  { frame: 'tiles/rock-0', file: 'tiles/rock-0.png', size: 32, region: null, seamless: false },
  { frame: 'tiles/rock-1', file: 'tiles/rock-1.png', size: 64, region: 'R3-highland', seamless: false },
  { frame: 'tiles/waystone-0', file: 'tiles/waystone-0.png', size: 64, region: 'R1-meadow', seamless: false },
  { frame: 'tiles/lantern-0', file: 'tiles/lantern-0.png', size: 64, region: null, seamless: false },
  { frame: 'tiles/tree-trunk-0', file: 'tiles/tree-trunk-0.png', size: 64, region: null, seamless: false },
  { frame: 'tiles/shrine-torii-0', file: 'tiles/shrine-torii-0.png', size: 128, region: null, seamless: false },
  {
    frame: 'tiles/tree-canopy-0',
    file: 'tiles/tree-canopy-0.png',
    size: 128,
    region: null,
    overhead: true,
    seamless: false,
  },
];

const TILE_PROMPTS: Readonly<Record<string, string>> = {
  'tiles/grass-0.png': 'lush wet meadow grass with tiny pale wildflowers, ' + TILE_STYLE,
  'tiles/grass-1.png': 'damp riverbank grass with silt and scattered pebbles, ' + TILE_STYLE,
  // Tall grass is where wild spirits are met, so it has to read as *different* from the plain
  // ground beside it at a glance, not merely as a slightly darker green.
  'tiles/tall-grass-0.png':
    'dense tall meadow grass, long upright blades filling the whole square, much darker and ' +
    'taller than short lawn grass, flat repeating swatch, no horizon, no scene, ' + TILE_STYLE,
  'tiles/tall-grass-1.png':
    'dense tall riverbank sedge, long wet upright blades filling the whole square, ' +
    'flat repeating swatch, no horizon, no scene, ' + TILE_STYLE,
  'tiles/tall-grass-2.png':
    'coarse tall highland tussock grass, long wind-bent blades filling the whole square, ' +
    'flat repeating swatch, no horizon, no scene, ' + TILE_STYLE,
  'tiles/grass-2.png': 'sparse highland turf over cold grey bedrock, ' + TILE_STYLE,
  // Rewritten after the first pass drew hedgerows down both sides of the path: repeated across
  // a road, that reads as green stripes rather than as ground.
  'tiles/dirt-path-0.png':
    'flat repeating swatch of packed wet brown earth with fine gravel and shallow puddles, ' +
    'bare soil only, no plants, no grass, no leaves, no edges, no horizon, no scene, ' +
    TILE_STYLE,
  // Rewritten after the first pass returned a landscape vignette with a horizon in it.
  'tiles/dirt-path-1.png':
    'flat repeating swatch of loose grey highland gravel, no horizon, no sky, no scene, ' + TILE_STYLE,
  'tiles/stone-0.png': 'weathered grey flagstone paving with moss in the joints, ' + TILE_STYLE,
  'tiles/stone-1.png': 'old shrine flagstone with faint carved sigils and lichen, ' + TILE_STYLE,
  'tiles/water-edge-0.png':
    'flat repeating swatch of shallow water over pale pebbles, no horizon, no sky, no scene, ' + TILE_STYLE,
  'tiles/water-deep-0.png':
    'flat repeating swatch of deep dark teal water with fine ripples, no horizon, no sky, no scene, ' +
    TILE_STYLE,
  'tiles/reeds-0.png': 'clump of tall marsh reeds standing in shallow water, ' + TILE_STYLE,
  'tiles/bridge-planks-0.png': 'weathered wooden bridge planks with iron nails, ' + TILE_STYLE,
  'tiles/bush-0.png': 'small round shrub of wet dark-green leaves seen from above, transparent background, ' + TILE_STYLE,
  'tiles/bush-1.png': 'low windbitten highland shrub with sparse grey-green leaves, transparent background, ' + TILE_STYLE,
  // Rewritten after the first pass painted the clump onto a patch of grass: with no flat
  // border to key on, the cut-out returns the whole square and it renders as a rectangle.
  'tiles/flower-0.png':
    'a single small clump of pale wildflowers on thin stems, isolated object, nothing else, ' +
    'plain solid flat white background, no grass, no ground, no soil, no shadow, ' + TILE_STYLE,
  'tiles/stump-0.png': 'cut tree stump with visible rings and moss, transparent background, ' + TILE_STYLE,
  'tiles/crate-0.png': 'weathered wooden supply crate bound with rope, transparent background, ' + TILE_STYLE,
  'tiles/house-0.png':
    'small village house with dark timber walls and a steep wet tiled roof, seen from a low ' +
    'top-down angle, whole building, transparent background, ' + TILE_STYLE,
  'tiles/house-1.png':
    'village shop stall with a cloth awning and a wooden counter, seen from a low top-down ' +
    'angle, whole building, transparent background, ' + TILE_STYLE,
  'tiles/rock-0.png': 'small mossy grey boulder, transparent background, ' + TILE_STYLE,
  'tiles/rock-1.png': 'large cracked granite boulder with moss and rain streaks, transparent background, ' + TILE_STYLE,
  'tiles/waystone-0.png':
    'standing stone waystone marker carved with a glowing pale-cyan counting sigil, transparent background, ' +
    TILE_STYLE,
  'tiles/lantern-0.png':
    'stone pedestal lantern with a warm ember flame inside, transparent background, ' + TILE_STYLE,
  // Rewritten alongside flower-0: the first pass drew the trunk standing in a patch of
  // undergrowth, which leaves nothing for the border flood to key on.
  'tiles/tree-trunk-0.png':
    'a single dark wet tree trunk with exposed roots, isolated object, nothing else, ' +
    'plain solid flat white background, no grass, no ground, no undergrowth, no shadow, ' +
    TILE_STYLE,
  'tiles/shrine-torii-0.png':
    'weathered dark wood torii shrine gate hung with a faded rope, transparent background, ' + TILE_STYLE,
  // Rewritten after the first pass returned a whole clearing rather than one crown.
  'tiles/tree-canopy-0.png':
    'the crown of a single tree seen from directly above, one round mass of dark green leaves, ' +
    'nothing else in frame, transparent background, ' +
    TILE_STYLE,
};

/**
 * Control-deck and HUD furniture, sized from the 540×1170 logical screen in DESIGN.md §3.
 * The deck is the bottom 38% (≈445 px tall), which is what fixes the joystick at 192 px and the
 * keypad key at 152×64 — a 3×4 grid of those plus gutters is the reference layout.
 */
export const UI_FRAMES: readonly UiFrame[] = [
  { frame: 'ui/joystick-base', file: 'ui/joystick-base.png', width: 192, height: 192 },
  { frame: 'ui/joystick-knob', file: 'ui/joystick-knob.png', width: 72, height: 72 },
  { frame: 'ui/button-round', file: 'ui/button-round.png', width: 96, height: 96 },
  { frame: 'ui/button-round-active', file: 'ui/button-round-active.png', width: 96, height: 96 },
  { frame: 'ui/button-action', file: 'ui/button-action.png', width: 120, height: 120 },
  { frame: 'ui/button-dash', file: 'ui/button-dash.png', width: 96, height: 96 },
  { frame: 'ui/button-backpack', file: 'ui/button-backpack.png', width: 80, height: 80 },
  { frame: 'ui/icon-spear', file: 'ui/icon-spear.png', width: 64, height: 64 },
  { frame: 'ui/icon-dash', file: 'ui/icon-dash.png', width: 48, height: 48 },
  { frame: 'ui/icon-backpack', file: 'ui/icon-backpack.png', width: 48, height: 48 },
  { frame: 'ui/icon-backspace', file: 'ui/icon-backspace.png', width: 48, height: 40 },
  { frame: 'ui/keypad-key', file: 'ui/keypad-key.png', width: 152, height: 64 },
  { frame: 'ui/keypad-key-pressed', file: 'ui/keypad-key-pressed.png', width: 152, height: 64 },
  { frame: 'ui/keypad-key-ok', file: 'ui/keypad-key-ok.png', width: 152, height: 64 },
  { frame: 'ui/keypad-key-back', file: 'ui/keypad-key-back.png', width: 152, height: 64 },
  { frame: 'ui/equation-strip', file: 'ui/equation-strip.png', width: 512, height: 96 },
  { frame: 'ui/back-chip', file: 'ui/back-chip.png', width: 112, height: 36 },
  { frame: 'ui/portrait-panel-left', file: 'ui/portrait-panel-left.png', width: 320, height: 112 },
  { frame: 'ui/portrait-panel-right', file: 'ui/portrait-panel-right.png', width: 320, height: 112 },
  { frame: 'ui/portrait-slot', file: 'ui/portrait-slot.png', width: 88, height: 88 },
  { frame: 'ui/bar-frame-hp', file: 'ui/bar-frame-hp.png', width: 200, height: 18 },
  { frame: 'ui/bar-fill-hp', file: 'ui/bar-fill-hp.png', width: 192, height: 10 },
  { frame: 'ui/bar-frame-chain', file: 'ui/bar-frame-chain.png', width: 200, height: 14 },
  { frame: 'ui/bar-fill-chain', file: 'ui/bar-fill-chain.png', width: 192, height: 6 },
  { frame: 'ui/panel-bracket', file: 'ui/panel-bracket.png', width: 24, height: 24 },
  { frame: 'ui/dialogue-panel', file: 'ui/dialogue-panel.png', width: 480, height: 128 },
];

/**
 * The subset of UI furniture worth a generation. Everything else is exact geometry at an exact
 * pixel size — a 200×18 bar frame or a 152×64 key face is drawn to the reference palette far
 * more faithfully than a sprite generator can hit by description.
 */
const UI_PROMPTS: Readonly<Record<string, string>> = {
  'ui/icon-spear.png':
    'single short spear weapon icon pointing up-right, pale cyan steel blade with a faint glow, dark wooden haft, ' +
    UI_STYLE,
  'ui/icon-backpack.png': 'small worn leather traveller backpack icon with straps and buckles, ' + UI_STYLE,
  'ui/icon-dash.png': 'double chevron dash arrow icon pointing right, pale cyan, ' + UI_STYLE,
  'ui/panel-bracket.png':
    'ornate tarnished brass corner bracket for a HUD panel, top-left corner piece, ' + UI_STYLE,
  'ui/portrait-slot.png':
    'empty square HUD portrait frame with a tarnished brass rim and dark slate interior, ' + UI_STYLE,
  'ui/joystick-knob.png':
    'round translucent virtual joystick thumb knob, brushed steel face with a glowing cyan rim, ' + UI_STYLE,
};

/**
 * UI pieces the builder draws itself even when a generated file exists.
 *
 * Judged from the first generation pass: the joystick knob came back as a green gem in a brass
 * ring rather than the reference's steel disc with a cyan rim, the dash glyph as a solid arrow
 * rather than the reference's double chevron, and the portrait slot as an ornate frame whose
 * inner rectangle is not where the HUD needs it. All three are geometry the deck lays text and
 * portraits into, so an inexact version is worse than a plain one. The generated files stay on
 * disk as reference; flipping a name out of this set is how you adopt one.
 */
const UI_PREFER_PROCEDURAL: ReadonlySet<string> = new Set([
  'ui/joystick-knob.png',
  'ui/icon-dash.png',
  'ui/portrait-slot.png',
]);

/**
 * Every job the generator would run, in a stable order.
 *
 * `speciesToRegenerate` is the *filtered* set — in practice the 24 placeholder Base forms the
 * generator detects by source dimension. Passing the full 96 would re-render art that already
 * ships at 512×512, which is both a waste of quota and a downgrade.
 */
export function generationJobs(speciesToRegenerate: readonly SpeciesDef[]): GenerationJob[] {
  const jobs: GenerationJob[] = [];

  for (const s of [...speciesToRegenerate].sort((a, b) => a.dexNo - b.dexNo)) {
    jobs.push(monsterJob(s));
  }

  for (const tile of TILE_FRAMES) {
    const prompt = TILE_PROMPTS[tile.file];
    if (!prompt) continue;
    jobs.push({ file: tile.file, group: 'tiles', prompt, width: tile.size, height: tile.size });
  }

  for (const ui of UI_FRAMES) {
    const prompt = UI_PROMPTS[ui.file];
    if (!prompt) continue;
    // PixelLab generates squares and rejects anything under 32×32; the atlas builder fits the
    // result into the declared box afterwards.
    const edge = Math.max(32, ui.width, ui.height);
    jobs.push({
      file: ui.file,
      group: 'ui',
      prompt,
      width: edge,
      height: edge,
      preferProcedural: UI_PREFER_PROCEDURAL.has(ui.file),
    });
  }

  return jobs;
}
