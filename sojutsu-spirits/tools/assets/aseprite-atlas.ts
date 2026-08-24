/**
 * An Aseprite-compatible atlas packer and writer.
 *
 * There is no Aseprite CLI in this environment (DESIGN.md §7), so rather than invent a private
 * atlas format we emit the one Aseprite itself exports: the JSON **hash** sheet, `{ frames: {
 * name: {...} }, meta: {...} }`. That choice buys three things at no cost:
 *
 *  • **Phaser loads it natively.** `this.load.atlas(key, png, json)` parses this exact shape,
 *    including `trimmed` frames via `spriteSourceSize`/`sourceSize`. No custom loader plugin,
 *    no runtime translation layer.
 *  • **It round-trips.** If Aseprite ever enters the pipeline, an artist can import the sheet,
 *    edit it and re-export over the top; frame names, durations and tags survive.
 *  • **It is inspectable.** A failed build is a diffable JSON file, not an opaque binary.
 *
 * Packing is MaxRects with the best-short-side-fit heuristic, into power-of-two sheets. Shelf
 * packing was the simpler option and is what the brief allows, but the frames here are wildly
 * heterogeneous — 128×128 dex plates next to 200×18 bar frames next to 32×32 tiles — and a
 * shelf packer wastes most of a sheet on that mix. MaxRects keeps every atlas comfortably
 * inside the ~2 MB budget, which is the actual constraint.
 *
 * Scaling never happens here. Frames arrive at their final size from `pixel-ops.ts`, which only
 * knows how to sample nearest-neighbour.
 */
import {
  alphaBounds,
  blankImage,
  blit,
  crop,
  encodePng,
  type EncodeOptions,
  type RawImage,
  type Rect,
} from './pixel-ops.ts';

/** Aseprite's default frame duration, in milliseconds. */
export const DEFAULT_FRAME_DURATION = 100;

export interface FrameInput {
  /** Stable atlas key, e.g. `dex/069-fawnix`. This is what the game asks Phaser for. */
  readonly name: string;
  readonly image: RawImage;
  /** Milliseconds this frame is shown when played as part of a tag. */
  readonly duration?: number;
}

export interface AsepriteFrameTag {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly direction: 'forward' | 'reverse' | 'pingpong';
}

export interface AsepriteFrame {
  readonly frame: { x: number; y: number; w: number; h: number };
  readonly rotated: false;
  readonly trimmed: boolean;
  readonly spriteSourceSize: { x: number; y: number; w: number; h: number };
  readonly sourceSize: { w: number; h: number };
  readonly duration: number;
}

export interface AsepriteMeta {
  readonly app: string;
  readonly version: string;
  readonly image: string;
  readonly format: 'RGBA8888';
  readonly size: { w: number; h: number };
  readonly scale: string;
  readonly frameTags: readonly AsepriteFrameTag[];
}

export interface AsepriteAtlas {
  readonly frames: Record<string, AsepriteFrame>;
  readonly meta: AsepriteMeta;
}

export interface PackOptions {
  /**
   * Transparent gutter between frames, in pixels. Phaser runs this project with `pixelArt: true`
   * (NEAREST filtering, no mipmaps) so bleeding is already near-impossible, but one pixel of
   * slack costs nothing and protects against a future switch to linear filtering.
   */
  readonly padding?: number;
  /** Largest sheet edge to consider. 2048 keeps us inside every mobile GL texture limit. */
  readonly maxSize?: number;
  /**
   * Crop each frame to its alpha bounding box and record the offset, exactly as Aseprite's
   * "trim" export does. Big win on the dex sheet, where painted plates carry wide empty margins.
   */
  readonly trim?: boolean;
  readonly frameTags?: readonly AsepriteFrameTag[];
  readonly encode?: EncodeOptions;
}

export interface PackedAtlas {
  readonly name: string;
  readonly atlas: AsepriteAtlas;
  readonly png: Buffer;
  /** Frame names in the order they appear in `atlas.frames`; `frameTags` index into this. */
  readonly order: readonly string[];
  readonly sheet: { w: number; h: number };
}

interface Placement {
  readonly name: string;
  readonly image: RawImage;
  readonly duration: number;
  /** Trimmed sub-image actually written to the sheet. */
  readonly trimmed: RawImage;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly sourceW: number;
  readonly sourceH: number;
  readonly isTrimmed: boolean;
  x: number;
  y: number;
}

/**
 * MaxRects with best-short-side-fit.
 *
 * The free list holds maximal empty rectangles. Inserting splits every free rectangle the new
 * placement overlaps, then prunes any rectangle fully contained in another — that pruning is
 * what keeps the list from growing without bound and is the part naive implementations skip.
 */
class MaxRectsBin {
  private free: Rect[];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.free = [{ x: 0, y: 0, w: width, h: height }];
  }

  insert(w: number, h: number): Rect | null {
    let best: Rect | null = null;
    let bestShort = Infinity;
    let bestLong = Infinity;

    for (const fr of this.free) {
      if (fr.w < w || fr.h < h) continue;
      const leftoverX = fr.w - w;
      const leftoverY = fr.h - h;
      const short = Math.min(leftoverX, leftoverY);
      const long = Math.max(leftoverX, leftoverY);
      if (short < bestShort || (short === bestShort && long < bestLong)) {
        best = { x: fr.x, y: fr.y, w, h };
        bestShort = short;
        bestLong = long;
      }
    }
    if (!best) return null;

    const next: Rect[] = [];
    for (const fr of this.free) {
      if (!splitFree(fr, best, next)) next.push(fr);
    }
    this.free = pruneContained(next);
    return best;
  }
}

/** Returns false when `used` does not touch `fr`; otherwise pushes the surviving slivers. */
function splitFree(fr: Rect, used: Rect, out: Rect[]): boolean {
  if (
    used.x >= fr.x + fr.w ||
    used.x + used.w <= fr.x ||
    used.y >= fr.y + fr.h ||
    used.y + used.h <= fr.y
  ) {
    return false;
  }
  if (used.x > fr.x) out.push({ x: fr.x, y: fr.y, w: used.x - fr.x, h: fr.h });
  if (used.x + used.w < fr.x + fr.w) {
    out.push({ x: used.x + used.w, y: fr.y, w: fr.x + fr.w - (used.x + used.w), h: fr.h });
  }
  if (used.y > fr.y) out.push({ x: fr.x, y: fr.y, w: fr.w, h: used.y - fr.y });
  if (used.y + used.h < fr.y + fr.h) {
    out.push({ x: fr.x, y: used.y + used.h, w: fr.w, h: fr.y + fr.h - (used.y + used.h) });
  }
  return true;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function pruneContained(rects: readonly Rect[]): Rect[] {
  const kept: Rect[] = [];
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i]!;
    if (a.w <= 0 || a.h <= 0) continue;
    let redundant = false;
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const b = rects[j]!;
      // On mutual containment (identical rects) keep exactly one — the lower index.
      if (contains(b, a) && (!contains(a, b) || j < i)) {
        redundant = true;
        break;
      }
    }
    if (!redundant) kept.push(a);
  }
  return kept;
}

/** Power-of-two sheet candidates, smallest total area first, squarest first on a tie. */
function candidateSheets(minArea: number, maxSize: number): Array<{ w: number; h: number }> {
  const sizes: number[] = [];
  for (let s = 32; s <= maxSize; s *= 2) sizes.push(s);
  const out: Array<{ w: number; h: number }> = [];
  for (const w of sizes) {
    for (const h of sizes) {
      if (w * h < minArea) continue;
      // Skip absurd slivers; nothing needs an 8:1 sheet and they pack badly.
      if (w / h > 4 || h / w > 4) continue;
      out.push({ w, h });
    }
  }
  out.sort((a, b) => a.w * a.h - b.w * b.h || Math.abs(a.w - a.h) - Math.abs(b.w - b.h));
  return out;
}

/**
 * Packs frames into the smallest power-of-two sheet that holds them and returns both the PNG
 * and the Aseprite JSON. Frame *order* in the JSON is the order given, because `frameTags`
 * address frames by index and the game reads those indices back.
 */
export async function packAtlas(
  name: string,
  frames: readonly FrameInput[],
  options: PackOptions = {},
): Promise<PackedAtlas> {
  if (frames.length === 0) throw new Error(`packAtlas("${name}"): no frames given`);

  const seen = new Set<string>();
  for (const f of frames) {
    if (seen.has(f.name)) throw new Error(`packAtlas("${name}"): duplicate frame "${f.name}"`);
    seen.add(f.name);
  }

  const padding = options.padding ?? 1;
  const maxSize = options.maxSize ?? 2048;

  const placements: Placement[] = frames.map((f) => {
    const bounds = options.trim ? alphaBounds(f.image) : null;
    // A fully transparent frame still needs a real rectangle; 1×1 is the cheapest legal one.
    const box: Rect = options.trim
      ? (bounds ?? { x: 0, y: 0, w: 1, h: 1 })
      : { x: 0, y: 0, w: f.image.width, h: f.image.height };
    const trimmed =
      box.x === 0 && box.y === 0 && box.w === f.image.width && box.h === f.image.height
        ? f.image
        : crop(f.image, box);
    return {
      name: f.name,
      image: f.image,
      duration: f.duration ?? DEFAULT_FRAME_DURATION,
      trimmed,
      offsetX: box.x,
      offsetY: box.y,
      sourceW: f.image.width,
      sourceH: f.image.height,
      isTrimmed: trimmed !== f.image,
      x: 0,
      y: 0,
    };
  });

  let minArea = 0;
  for (const p of placements) minArea += (p.trimmed.width + padding) * (p.trimmed.height + padding);

  // Tallest-first is the standard MaxRects pre-sort; the name tie-break makes it deterministic.
  const order = [...placements].sort(
    (a, b) =>
      b.trimmed.height - a.trimmed.height ||
      b.trimmed.width - a.trimmed.width ||
      (a.name < b.name ? -1 : 1),
  );

  let sheet: { w: number; h: number } | null = null;
  for (const candidate of candidateSheets(minArea, maxSize)) {
    const bin = new MaxRectsBin(candidate.w, candidate.h);
    let ok = true;
    for (const p of order) {
      const spot = bin.insert(p.trimmed.width + padding, p.trimmed.height + padding);
      if (!spot) {
        ok = false;
        break;
      }
      p.x = spot.x;
      p.y = spot.y;
    }
    if (ok) {
      sheet = candidate;
      break;
    }
  }
  if (!sheet) {
    throw new Error(
      `packAtlas("${name}"): ${frames.length} frames do not fit in a ${maxSize}×${maxSize} sheet`,
    );
  }

  const canvas = blankImage(sheet.w, sheet.h);
  for (const p of placements) blit(canvas, p.trimmed, p.x, p.y);

  const frameRecords: Record<string, AsepriteFrame> = {};
  for (const p of placements) {
    frameRecords[p.name] = {
      frame: { x: p.x, y: p.y, w: p.trimmed.width, h: p.trimmed.height },
      rotated: false,
      trimmed: p.isTrimmed,
      spriteSourceSize: { x: p.offsetX, y: p.offsetY, w: p.trimmed.width, h: p.trimmed.height },
      sourceSize: { w: p.sourceW, h: p.sourceH },
      duration: p.duration,
    };
  }

  const atlas: AsepriteAtlas = {
    frames: frameRecords,
    meta: {
      app: 'https://www.aseprite.org/',
      version: '1.3.7',
      image: `${name}.png`,
      format: 'RGBA8888',
      size: { w: sheet.w, h: sheet.h },
      scale: '1',
      frameTags: options.frameTags ?? [],
    },
  };

  return {
    name,
    atlas,
    png: await encodePng(canvas, options.encode ?? {}),
    order: placements.map((p) => p.name),
    sheet,
  };
}

/**
 * Structural checks on a written atlas: every frame inside the sheet, no two frames overlapping,
 * every tag addressing frames that exist.
 *
 * Returned as a list of strings rather than thrown so both the build (which fails loudly) and
 * the tests (which want to report every problem at once) can use the same code path.
 */
export function validateAtlas(atlas: AsepriteAtlas, order?: readonly string[]): string[] {
  const problems: string[] = [];
  const names = order ?? Object.keys(atlas.frames);
  const { w: sheetW, h: sheetH } = atlas.meta.size;

  const boxes: Array<{ name: string; r: Rect }> = [];
  for (const name of names) {
    const f = atlas.frames[name];
    if (!f) {
      problems.push(`frame "${name}" is listed in the order but missing from frames`);
      continue;
    }
    const r: Rect = { x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h };
    if (r.w <= 0 || r.h <= 0) problems.push(`frame "${name}" has a degenerate size ${r.w}×${r.h}`);
    if (r.x < 0 || r.y < 0 || r.x + r.w > sheetW || r.y + r.h > sheetH) {
      problems.push(
        `frame "${name}" at (${r.x},${r.y}) ${r.w}×${r.h} falls outside the ${sheetW}×${sheetH} sheet`,
      );
    }
    boxes.push({ name, r });
  }

  // O(n²), but n is in the hundreds and this only runs in the build and the tests.
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!;
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!;
      if (
        a.r.x < b.r.x + b.r.w &&
        b.r.x < a.r.x + a.r.w &&
        a.r.y < b.r.y + b.r.h &&
        b.r.y < a.r.y + a.r.h
      ) {
        problems.push(`frames "${a.name}" and "${b.name}" overlap on the sheet`);
      }
    }
  }

  const count = names.length;
  for (const tag of atlas.meta.frameTags) {
    if (tag.from < 0 || tag.to >= count || tag.from > tag.to) {
      problems.push(`tag "${tag.name}" addresses frames ${tag.from}..${tag.to} of ${count}`);
    }
  }

  if (!isPowerOfTwo(sheetW) || !isPowerOfTwo(sheetH)) {
    problems.push(`sheet size ${sheetW}×${sheetH} is not power-of-two`);
  }
  return problems;
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}
