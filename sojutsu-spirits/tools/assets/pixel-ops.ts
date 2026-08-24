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
