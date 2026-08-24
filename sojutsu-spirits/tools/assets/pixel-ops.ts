/**
 * Raw-RGBA pixel primitives for the art pipeline.
 *
 * Everything downstream — the packer, the procedural fallback renderer, the PixelLab
 * post-processing — works on one plain structure (`RawImage`: width, height, tightly packed
 * RGBA8888) rather than on `sharp` pipelines. Three reasons, and they are all about the fact
 * that this is *pixel art*:
 *
 *  1. **Nearest-neighbour, always.** `sharp`'s resize kernels are all smooth except `nearest`,
 *     and it is far too easy for a stray `.resize(w, h)` to slip in a Lanczos pass that turns a
 *     47-colour sprite into a 4000-colour blur. Scaling lives here, in one function, sampling
 *     by point. There is no smooth path to accidentally take.
 *  2. **Testability.** These are pure functions over a Buffer, so the packer's geometry and the
 *     trim maths are unit-testable with no image files and no I/O.
 *  3. **Composability.** Trim → scale → pad → flop → composite is four array walks. Expressing
 *     it as four `sharp` round-trips would re-encode PNG between every step.
 *
 * `sharp` is still used, but only at the edges: decode a PNG in, encode a PNG out.
 */
import sharp from 'sharp';

/** A tightly packed, non-premultiplied RGBA8888 raster. `data.length === width * height * 4`. */
export interface RawImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

/** Red, green, blue, alpha — each 0-255. */
export type Rgba = readonly [number, number, number, number];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function blankImage(width: number, height: number): RawImage {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

export function cloneImage(img: RawImage): RawImage {
  return { width: img.width, height: img.height, data: Buffer.from(img.data) };
}

/** `#rrggbb` or `#rrggbbaa` → Rgba. Written for readable palette tables, not for hot loops. */
export function hexRgba(hex: string, alpha = 255): Rgba {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : alpha;
  return [r, g, b, a];
}

export async function decodePng(png: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

export interface EncodeOptions {
  /**
   * Quantise to an indexed palette. Pixel art has few colours by construction, so this is
   * usually free fidelity-wise and cuts sheet bytes by 3-5×. Off by default because the 512×512
   * dex plates are painted illustration, not 16-colour sprites.
   */
  readonly palette?: boolean;
  readonly colours?: number;
}

export async function encodePng(img: RawImage, options: EncodeOptions = {}): Promise<Buffer> {
  const pipeline = sharp(img.data, {
    raw: { width: img.width, height: img.height, channels: 4 },
  });
  if (options.palette) {
    return pipeline
      .png({
        compressionLevel: 9,
        effort: 10,
        palette: true,
        colours: options.colours ?? 256,
        dither: 0,
      })
      .toBuffer();
  }
  return pipeline.png({ compressionLevel: 9, effort: 10 }).toBuffer();
}

/**
 * Point-sampled rescale. This is the *only* resize in the pipeline.
 *
 * Non-integer ratios are allowed (a 512→32 party icon is a 16× decimation, a 64→128 upscale of a
 * legacy placeholder is 2×) and both are still pure point sampling, so no colour that was not in
 * the source can appear in the result.
 */
export function resizeNearest(img: RawImage, width: number, height: number): RawImage {
  if (width === img.width && height === img.height) return cloneImage(img);
  const out = blankImage(width, height);
  const xMap = new Int32Array(width);
  for (let x = 0; x < width; x++) {
    xMap[x] = Math.min(img.width - 1, Math.floor((x * img.width) / width));
  }
  for (let y = 0; y < height; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / height));
    const srcRow = sy * img.width * 4;
    const dstRow = y * width * 4;
    for (let x = 0; x < width; x++) {
      const s = srcRow + xMap[x]! * 4;
      const d = dstRow + x * 4;
      out.data[d] = img.data[s]!;
      out.data[d + 1] = img.data[s + 1]!;
      out.data[d + 2] = img.data[s + 2]!;
      out.data[d + 3] = img.data[s + 3]!;
    }
  }
  return out;
}

/** Bounding box of everything with alpha > `threshold`, or null if the image is empty. */
export function alphaBounds(img: RawImage, threshold = 0): Rect | null {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width * 4;
    for (let x = 0; x < img.width; x++) {
      if (img.data[row + x * 4 + 3]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function crop(img: RawImage, rect: Rect): RawImage {
  const out = blankImage(rect.w, rect.h);
  for (let y = 0; y < rect.h; y++) {
    const sy = rect.y + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < rect.w; x++) {
      const sx = rect.x + x;
      if (sx < 0 || sx >= img.width) continue;
      const s = (sy * img.width + sx) * 4;
      const d = (y * rect.w + x) * 4;
      img.data.copy(out.data, d, s, s + 4);
    }
  }
  return out;
}

/** Horizontal mirror. The character packs ship east-facing walk cycles only; west is this. */
export function flop(img: RawImage): RawImage {
  const out = blankImage(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width * 4;
    for (let x = 0; x < img.width; x++) {
      const s = row + x * 4;
      const d = row + (img.width - 1 - x) * 4;
      img.data.copy(out.data, d, s, s + 4);
    }
  }
  return out;
}

/** Source-over composite of `src` onto `dst` at (left, top). Mutates `dst`. */
export function blit(dst: RawImage, src: RawImage, left: number, top: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = left + x;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (y * src.width + x) * 4;
      const sa = src.data[s + 3]!;
      if (sa === 0) continue;
      const d = (dy * dst.width + dx) * 4;
      if (sa === 255) {
        src.data.copy(dst.data, d, s, s + 4);
        continue;
      }
      const da = dst.data[d + 3]!;
      const outA = sa + (da * (255 - sa)) / 255;
      for (let c = 0; c < 3; c++) {
        const sc = src.data[s + c]!;
        const dc = dst.data[d + c]!;
        dst.data[d + c] = Math.round((sc * sa + dc * da * (1 - sa / 255)) / outA);
      }
      dst.data[d + 3] = Math.round(outA);
    }
  }
}

export interface FitOptions {
  /** Crop to the alpha bounding box before scaling, so the subject fills the box. */
  readonly trim?: boolean;
  /** Transparent margin left inside the box, in destination pixels. */
  readonly padding?: number;
  /** 0 = top, 0.5 = middle, 1 = bottom. Sprites read better bottom-anchored. */
  readonly anchorY?: number;
}

/**
 * Scale-to-fit inside a box, centred, nearest-neighbour, aspect preserved.
 *
 * The dex plates are square but the creatures inside them are not, and a party icon that shows
 * a 32×32 crop of mostly-empty canvas is unreadable at a glance. Trimming first and then fitting
 * is what makes a 512×512 illustration survive a 16× decimation as a recognisable silhouette.
 */
export function fitInto(img: RawImage, boxW: number, boxH: number, options: FitOptions = {}): RawImage {
  const padding = options.padding ?? 0;
  const innerW = Math.max(1, boxW - padding * 2);
  const innerH = Math.max(1, boxH - padding * 2);

  let subject = img;
  if (options.trim) {
    const bounds = alphaBounds(img);
    if (bounds) subject = crop(img, bounds);
  }

  const scale = Math.min(innerW / subject.width, innerH / subject.height);
  const w = Math.max(1, Math.floor(subject.width * scale));
  const h = Math.max(1, Math.floor(subject.height * scale));
  const scaled = resizeNearest(subject, w, h);

  const out = blankImage(boxW, boxH);
  const anchorY = options.anchorY ?? 0.5;
  blit(out, scaled, Math.floor((boxW - w) / 2), padding + Math.round((innerH - h) * anchorY));
  return out;
}

/**
 * Knock out a flat, border-connected background.
 *
 * PixelLab is asked for a transparent background and returns an opaque near-white one anyway.
 * A flood fill inward from the frame edge is the safe removal: it only clears pixels reachable
 * from outside the subject, so a white highlight *inside* the creature survives, which a naive
 * "delete every pixel matching the background colour" pass would punch a hole through.
 *
 * If the border is not dominated by a single colour the image is assumed to already have a real
 * alpha channel (or to be a seamless tile, where the edges are content) and is returned as-is.
 */
export interface BackgroundOptions {
  readonly tolerance?: number;
  /**
   * Also clear *enclosed* pockets of the background colour — the sky between a torii's posts,
   * the gap inside a lantern's frame. Those pockets are not reachable from the border, so the
   * flood fill leaves them as an opaque plate behind the prop.
   *
   * Off by default, and deliberately not used for creatures: a grey spirit on a grey plate would
   * have holes punched straight through it. Props are geometric and hollow; creatures are not.
   */
  readonly clearEnclosed?: boolean;
}

export function removeFlatBackground(img: RawImage, options: BackgroundOptions = {}): RawImage {
  const tolerance = options.tolerance ?? 16;
  const { width, height, data } = img;
  if (width < 3 || height < 3) return cloneImage(img);

  const counts = new Map<number, number>();
  const border: number[] = [];
  const pushBorder = (x: number, y: number): void => {
    const i = (y * width + x) * 4;
    if (data[i + 3]! === 0) return;
    border.push(y * width + x);
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = 0; x < width; x++) {
    pushBorder(x, 0);
    pushBorder(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    pushBorder(0, y);
    pushBorder(width - 1, y);
  }

  const perimeter = width * 2 + (height - 2) * 2;
  let bestKey = -1;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  // Fewer than 60% of edge pixels agreeing means this is content, not a backdrop.
  if (bestKey < 0 || bestCount / perimeter < 0.6) return cloneImage(img);

  const br = (bestKey >> 16) & 0xff;
  const bg = (bestKey >> 8) & 0xff;
  const bb = bestKey & 0xff;

  const out = cloneImage(img);
  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (const p of border) {
    if (seen[p]) continue;
    const i = p * 4;
    if (
      Math.abs(data[i]! - br) <= tolerance &&
      Math.abs(data[i + 1]! - bg) <= tolerance &&
      Math.abs(data[i + 2]! - bb) <= tolerance
    ) {
      seen[p] = 1;
      stack.push(p);
    }
  }
  if (options.clearEnclosed) {
    for (let p = 0; p < width * height; p++) {
      const i = p * 4;
      if (
        Math.abs(data[i]! - br) <= tolerance &&
        Math.abs(data[i + 1]! - bg) <= tolerance &&
        Math.abs(data[i + 2]! - bb) <= tolerance
      ) {
        out.data[i + 3] = 0;
      }
    }
  }

  while (stack.length > 0) {
    const p = stack.pop()!;
    out.data[p * 4 + 3] = 0;
    const x = p % width;
    const y = (p - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const q = ny * width + nx;
      if (seen[q]) continue;
      const j = q * 4;
      if (data[j + 3]! === 0) {
        seen[q] = 1;
        continue;
      }
      if (
        Math.abs(data[j]! - br) <= tolerance &&
        Math.abs(data[j + 1]! - bg) <= tolerance &&
        Math.abs(data[j + 2]! - bb) <= tolerance
      ) {
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  return out;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/* ------------------------------------------------------------- seamless */

export interface SeamlessOptions {
  /** How many pixels either side of the seam are rebuilt. */
  readonly band?: number;
  /** Deterministic dither seed. */
  readonly seed?: number;
}

/**
 * Makes a tile actually tile.
 *
 * `seamless: true` in the asset plan is a *request* to the generator, and generators do not
 * honour it. PixelLab returns a handsome 32 × 32 sprite — with its own dark border, because it
 * is drawing a sprite. Repeated across a field, that border is a lattice, and the map reads as
 * a grid of tiles rather than as ground.
 *
 * Two steps:
 *
 *  1. **Roll** by half the width and height. Afterwards column 0 holds what used to be column
 *     w/2 and column w−1 holds what used to be column w/2 − 1 — *adjacent columns in the
 *     original* — so the new outer edges match each other by construction. The old border has
 *     moved to a cross through the middle, where it can be dealt with.
 *  2. **Clone over that cross** with clean texture taken from outside the band, jittered so the
 *     repeat is not obvious.
 *
 * The clone matters. An earlier version merely dithered the two sides of the seam into each
 * other, which mixes a dark border with a dark border and leaves the lattice exactly where it
 * was, only offset by half a tile. You cannot blend away a line that is present on both sides;
 * you have to replace it.
 */
export function makeSeamless(img: RawImage, options: SeamlessOptions = {}): RawImage {
  const { width: w, height: h } = img;
  if (w < 12 || h < 12) return cloneImage(img);

  const band = Math.max(2, Math.min(options.band ?? Math.round(Math.min(w, h) / 8), Math.floor(Math.min(w, h) / 6)));
  const hx = Math.floor(w / 2);
  const hy = Math.floor(h / 2);
  const seed = options.seed ?? 0x5eed;

  // 1. Roll.
  const rolled = blankImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      copy(rolled, x, y, img, (x + hx) % w, (y + hy) % h);
    }
  }

  // 2. Clone clean texture over the cross, reading from a frozen copy.
  const source = cloneImage(rolled);
  const jitter = (x: number, y: number, salt: number): number => {
    let n = (x * 374761393 + y * 668265263 + seed + salt) >>> 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
    return n % 3; // −1, 0 or +1 after the shift below
  };

  const inCross = (x: number, y: number): boolean =>
    Math.abs(x - hx) < band + 1 || Math.abs(y - hy) < band + 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inCross(x, y)) continue;

      // Reach past the band to unspoiled texture, on whichever side this pixel sits.
      let sx = x;
      let sy = y;
      if (Math.abs(x - hx) < band + 1) {
        const dir = x < hx ? -1 : 1;
        sx = x + dir * (2 * band + 2) + (jitter(x, y, 1) - 1);
      }
      if (Math.abs(y - hy) < band + 1) {
        const dir = y < hy ? -1 : 1;
        sy = y + dir * (2 * band + 2) + (jitter(x, y, 2) - 1);
      }

      // Wrap rather than clamp: the rolled image already tiles, so wrapping stays in texture.
      sx = ((sx % w) + w) % w;
      sy = ((sy % h) + h) % h;
      // Never sample the cross itself, or the border comes straight back.
      if (inCross(sx, sy)) {
        sx = ((x + hx + band) % w + w) % w;
        sy = ((y + hy + band) % h + h) % h;
        if (inCross(sx, sy)) continue;
      }
      copy(rolled, x, y, source, sx, sy);
    }
  }

  return rolled;
}

function copy(dst: RawImage, dx: number, dy: number, src: RawImage, sx: number, sy: number): void {
  const from = (sy * src.width + sx) * 4;
  const to = (dy * dst.width + dx) * 4;
  dst.data[to] = src.data[from]!;
  dst.data[to + 1] = src.data[from + 1]!;
  dst.data[to + 2] = src.data[from + 2]!;
  dst.data[to + 3] = src.data[from + 3]!;
}

/* -------------------------------------------------------- hue stripping */

export interface StripHueOptions {
  /** Hue window to remove, in degrees. Greens are roughly 70°–170°. */
  readonly fromHue: number;
  readonly toHue: number;
  /** Ignore near-grey pixels, which have an unstable hue. */
  readonly minSaturation?: number;
}

/**
 * Removes one hue band from a tile, keeping its texture.
 *
 * A generator asked for "packed wet dirt footpath" reliably draws the *verges* as well as the
 * path, because that is what a path looks like in a picture. Repeated across a road, those
 * verges read as green stripes rather than as ground — the tile is describing a scene when it
 * needs to describe a surface.
 *
 * Regenerating does not fix it (three prompts, three sets of hedges), and falling back to flat
 * noise throws away the gravel and cart ruts that make the tile worth having. So the vegetation
 * is removed by hue instead: every offending pixel is replaced with the tile's own dominant
 * remaining colour, re-lit to its original brightness. The texture survives; the hedges do not.
 */
export function stripHue(img: RawImage, options: StripHueOptions): RawImage {
  const { fromHue, toHue } = options;
  const minSat = options.minSaturation ?? 0.18;
  const out = cloneImage(img);

  // The dominant colour among the pixels we are keeping, so the fill matches the tile.
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!;
    const g = img.data[i + 1]!;
    const b = img.data[i + 2]!;
    if (img.data[i + 3]! < 8) continue;
    if (inHueBand(r, g, b, fromHue, toHue, minSat)) continue;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n += 1;
    e.r += r;
    e.g += g;
    e.b += b;
    buckets.set(key, e);
  }

  let best = { n: 0, r: 128, g: 110, b: 90 };
  for (const e of buckets.values()) if (e.n > best.n) best = e;
  const fill =
    best.n > 0
      ? { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n }
      : { r: 128, g: 110, b: 90 };
  const fillLuma = luma(fill.r, fill.g, fill.b) || 1;

  for (let i = 0; i < out.data.length; i += 4) {
    const r = out.data[i]!;
    const g = out.data[i + 1]!;
    const b = out.data[i + 2]!;
    if (out.data[i + 3]! < 8) continue;
    if (!inHueBand(r, g, b, fromHue, toHue, minSat)) continue;

    // Keep the pixel's own brightness so ruts, shadows and highlights are preserved.
    const scale = Math.max(0.35, Math.min(1.6, luma(r, g, b) / fillLuma));
    out.data[i] = clamp255(fill.r * scale);
    out.data[i + 1] = clamp255(fill.g * scale);
    out.data[i + 2] = clamp255(fill.b * scale);
  }

  return out;
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function inHueBand(
  r: number,
  g: number,
  b: number,
  fromHue: number,
  toHue: number,
  minSat: number,
): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return false;
  const sat = (max - min) / max;
  if (sat < minSat) return false;

  const d = max - min;
  if (d === 0) return false;
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue *= 60;
  if (hue < 0) hue += 360;

  return hue >= fromHue && hue <= toHue;
}
