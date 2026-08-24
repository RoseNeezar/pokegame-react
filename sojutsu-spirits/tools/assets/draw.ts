/**
 * A tiny signed-distance-field rasteriser for the procedural asset layer.
 *
 * There is no canvas in a Node build step and adding one (node-canvas, resvg, a headless
 * browser) would put a native dependency in the critical path of `npm run assets` for the sake
 * of a few rings and rounded rectangles. So the deck furniture is rasterised directly.
 *
 * SDFs rather than scanline polygons because every piece of control-deck furniture in
 * `reference/visual/exploration-mode-reference.png` is a circle, a ring, a rounded rectangle or
 * an outline of one, and all four are two lines of arithmetic as a distance function. Coverage
 * comes out of the distance for free, so the rings are smoothly anti-aliased — which is correct
 * here: the deck overlay in the references is vector-smooth UI drawn *over* the pixel-art world,
 * not pixel art itself. (Sprites and tiles never take this path; they are never resampled.)
 *
 * Nothing in this file is ever scaled after drawing. Every piece is rasterised once at its final
 * atlas size.
 */
import { blankImage, type RawImage, type Rgba } from './pixel-ops.ts';

/** Signed distance in pixels: negative inside the shape, positive outside, 0 on the edge. */
export type Sdf = (x: number, y: number) => number;

export function sdfCircle(cx: number, cy: number, r: number): Sdf {
  return (x, y) => Math.hypot(x - cx, y - cy) - r;
}

export function sdfEllipse(cx: number, cy: number, rx: number, ry: number): Sdf {
  // Not a true Euclidean distance, but the gradient-normalised approximation is accurate to
  // well under a pixel at these radii, which is all the coverage step needs.
  return (x, y) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    const k = Math.hypot(dx, dy);
    return (k - 1) * Math.min(rx, ry);
  };
}

export function sdfRoundRect(x0: number, y0: number, w: number, h: number, r: number): Sdf {
  const hx = w / 2;
  const hy = h / 2;
  const cx = x0 + hx;
  const cy = y0 + hy;
  const rr = Math.min(r, hx, hy);
  return (x, y) => {
    const qx = Math.abs(x - cx) - (hx - rr);
    const qy = Math.abs(y - cy) - (hy - rr);
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - rr;
  };
}

/** The `thickness`-wide band straddling a shape's edge — i.e. its outline. */
export function sdfOutline(shape: Sdf, thickness: number): Sdf {
  const half = thickness / 2;
  return (x, y) => Math.abs(shape(x, y)) - half;
}

/** Everything inside `a` but outside `b` — how the knob's specular crescent is cut. */
export function sdfSubtract(a: Sdf, b: Sdf): Sdf {
  return (x, y) => Math.max(a(x, y), -b(x, y));
}

function blendPixel(img: RawImage, x: number, y: number, colour: Rgba, coverage: number): void {
  if (coverage <= 0) return;
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const sa = (colour[3] / 255) * Math.min(1, coverage);
  if (sa <= 0) return;
  const i = (y * img.width + x) * 4;
  const da = img.data[i + 3]! / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) {
    img.data[i + 3] = 0;
    return;
  }
  for (let c = 0; c < 3; c++) {
    const dc = img.data[i + c]!;
    img.data[i + c] = Math.round((colour[c]! * sa + dc * da * (1 - sa)) / outA);
  }
  img.data[i + 3] = Math.round(outA * 255);
}

export interface FillOptions {
  /** Edge softness in pixels. 0 gives a hard, aliased edge — right for pixel-art shapes. */
  readonly feather?: number;
}

/** Fills everywhere the SDF is negative, sampling at pixel centres. */
export function fillShape(img: RawImage, shape: Sdf, colour: Rgba, options: FillOptions = {}): void {
  const feather = options.feather ?? 1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const d = shape(x + 0.5, y + 0.5);
      const coverage = feather <= 0 ? (d < 0 ? 1 : 0) : Math.min(1, Math.max(0, 0.5 - d / feather));
      blendPixel(img, x, y, colour, coverage);
    }
  }
}

/** Vertical two-stop gradient inside a shape. Used for the parchment key faces and HP fills. */
export function fillShapeGradient(
  img: RawImage,
  shape: Sdf,
  top: Rgba,
  bottom: Rgba,
  y0: number,
  y1: number,
  options: FillOptions = {},
): void {
  const feather = options.feather ?? 1;
  const span = Math.max(1e-6, y1 - y0);
  for (let y = 0; y < img.height; y++) {
    const t = Math.min(1, Math.max(0, (y + 0.5 - y0) / span));
    const colour: Rgba = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
      Math.round(top[3] + (bottom[3] - top[3]) * t),
    ];
    for (let x = 0; x < img.width; x++) {
      const d = shape(x + 0.5, y + 0.5);
      const coverage = feather <= 0 ? (d < 0 ? 1 : 0) : Math.min(1, Math.max(0, 0.5 - d / feather));
      blendPixel(img, x, y, colour, coverage);
    }
  }
}

/**
 * An outward falloff around a shape — the cyan bloom the action button and the joystick knob
 * carry in the exploration reference. Additive-looking without needing an additive blend mode:
 * the game composites these over a dark deck, where alpha falloff reads the same.
 */
export function glowShape(img: RawImage, shape: Sdf, colour: Rgba, radius: number): void {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const d = shape(x + 0.5, y + 0.5);
      if (d <= 0 || d > radius) continue;
      const t = 1 - d / radius;
      blendPixel(img, x, y, colour, t * t);
    }
  }
}

/**
 * Even-odd polygon fill with 3×3 supersampling.
 *
 * The icon glyphs — the spear blade, the dash chevrons, the backpack, the backspace arrow — are
 * the one family of shapes that are not circles or rounded rectangles, and writing each as an
 * SDF composition would be far more code than sampling a point list.
 */
export function fillPolygon(img: RawImage, points: ReadonlyArray<readonly [number, number]>, colour: Rgba): void {
  if (points.length < 3) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  const x0 = Math.max(0, Math.floor(minX));
  const x1 = Math.min(img.width - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(img.height - 1, Math.ceil(maxY));

  const S = 3;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let hits = 0;
      for (let sy = 0; sy < S; sy++) {
        const py = y + (sy + 0.5) / S;
        for (let sx = 0; sx < S; sx++) {
          if (pointInPolygon(x + (sx + 0.5) / S, py, points)) hits++;
        }
      }
      if (hits > 0) blendPixel(img, x, y, colour, hits / (S * S));
    }
  }
}

function pointInPolygon(px: number, py: number, points: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

/** A thick line as a rectangle polygon. Chevrons and bracket strokes are built from these. */
export function strokeLine(
  img: RawImage,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness: number,
  colour: Rgba,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const nx = (-dy / len) * (thickness / 2);
  const ny = (dx / len) * (thickness / 2);
  fillPolygon(
    img,
    [
      [ax + nx, ay + ny],
      [bx + nx, by + ny],
      [bx - nx, by - ny],
      [ax - nx, ay - ny],
    ],
    colour,
  );
}

/** Convenience: draw into a fresh transparent canvas. */
export function withCanvas(width: number, height: number, draw: (img: RawImage) => void): RawImage {
  const img = blankImage(width, height);
  draw(img);
  return img;
}
