/**
 * The offline art layer: everything the pipeline can draw without a network call.
 *
 * Two different jobs live here and they are deliberately held to different standards.
 *
 *  1. **Control-deck and HUD furniture** — the real thing, not a stand-in. Every piece in
 *     `reference/visual/*.png` that is pure geometry (rings, rounded key faces, bar frames,
 *     panel plates) is rasterised here, to colours sampled straight out of those references.
 *     A generator cannot hit `#ebdcc6` on a 152×64 rounded rectangle by description, and these
 *     pieces have to align to the pixel because the game lays text on top of them. Drawing them
 *     also means `npm run assets` produces a complete, correct deck with no API key at all.
 *
 *  2. **Terrain, props and missing sprites** — stand-ins, so the build never blocks. Terrain
 *     falls back to seeded value-noise tiles (which read fine), props to simple silhouettes, and
 *     anything with no recipe at all to a loud hatched placeholder that is impossible to mistake
 *     for finished art. Every one of these is recorded in `manifest.json` under `placeholders`.
 *
 * All randomness goes through the engine's seeded `Rng`, keyed by the frame name, so
 * `npm run assets` is byte-for-byte reproducible — the build step is expected to be
 * deterministic and a `Math.random()` texture would break that quietly.
 */
import { Rng } from '../../src/core/rng.ts';
import {
  fillPolygon,
  fillShape,
  fillShapeGradient,
  glowShape,
  sdfCircle,
  sdfEllipse,
  sdfOutline,
  sdfRoundRect,
  sdfSubtract,
  strokeLine,
  withCanvas,
} from './draw.ts';
import { blankImage, blit, hexRgba, type RawImage, type Rgba } from './pixel-ops.ts';

/**
 * Sampled from `reference/visual/math-combat-reference.png` and
 * `reference/visual/exploration-mode-reference.png`. These are measurements, not choices —
 * change them only against a re-sample of the references.
 */
export const PALETTE = {
  /** Exploration deck ground: near-black navy. */
  deckInk: hexRgba('#0b121f'),
  /** Math-combat deck ground: the lighter slate blue behind the keypad. */
  deckNavy: hexRgba('#222745'),
  /** HUD panel interior. */
  panel: hexRgba('#151822'),
  panelEdge: hexRgba('#0a0d14'),
  /** Keypad and equation-strip parchment. */
  parchment: hexRgba('#ebdcc6'),
  parchmentDim: hexRgba('#e0d0b8'),
  parchmentShade: hexRgba('#c6b294'),
  parchmentInk: hexRgba('#2b2b33'),
  /** Tarnished brass on the portrait panels. */
  brass: hexRgba('#c9a227'),
  brassDark: hexRgba('#7a6018'),
  /** HP bar. */
  hpGreen: hexRgba('#6eba3c'),
  hpGreenDark: hexRgba('#3f7a22'),
  /** Chain bar — the blue strip under the HP bar in the combat reference. */
  chainCyan: hexRgba('#00abc2'),
  chainCyanDark: hexRgba('#046b7c'),
  /** Interactive accent: the joystick knob rim and the action-button ring. */
  accent: hexRgba('#5fd0ec'),
  /** OK key border. */
  teal: hexRgba('#17a89e'),
  /** Inert ring / disabled outline. */
  pale: hexRgba('#b9c3cf'),
  steel: hexRgba('#545760'),
  /** Placeholder warning colours — never used by finished art. */
  warnInk: hexRgba('#2a1c14'),
  warnEmber: hexRgba('#e07b2c'),
} as const;

function withAlpha(colour: Rgba, alpha: number): Rgba {
  return [colour[0], colour[1], colour[2], Math.round(255 * alpha)];
}

// ---------------------------------------------------------------------------------------------
// Control deck and HUD
// ---------------------------------------------------------------------------------------------

/**
 * Draws one named UI frame, or null when the name has no recipe.
 *
 * Sizes are passed in rather than hard-coded so `asset-plan.ts` stays the only place that decides
 * how big a piece of furniture is.
 */
export function drawUiFrame(frame: string, width: number, height: number): RawImage | null {
  switch (frame) {
    case 'ui/joystick-base':
      return joystickBase(width, height);
    case 'ui/joystick-knob':
      return joystickKnob(width, height);
    case 'ui/button-round':
      return roundButton(width, height, PALETTE.pale, 0.55);
    case 'ui/button-round-active':
      return roundButton(width, height, PALETTE.accent, 0.9);
    // The three action buttons come back as bare plates. Their glyphs are composited by the
    // builder from the `ui/icon-*` frames, so a button and its standalone icon can never drift
    // apart — whichever source (generated or procedural) wins for the icon wins for the button.
    case 'ui/button-action':
      return actionPlate(width, height);
    case 'ui/button-dash':
      return roundButton(width, height, PALETTE.pale, 0.6);
    case 'ui/button-backpack':
      return roundButton(width, height, PALETTE.pale, 0.55, 2);
    case 'ui/icon-spear':
      return spearIcon(width, height);
    case 'ui/icon-dash':
      return dashIcon(width, height);
    case 'ui/icon-backpack':
      return backpackIcon(width, height);
    case 'ui/icon-backspace':
      return backspaceIcon(width, height);
    case 'ui/keypad-key':
      return keypadKey(width, height, { border: PALETTE.parchmentShade });
    case 'ui/keypad-key-pressed':
      return keypadKey(width, height, { border: PALETTE.parchmentShade, pressed: true });
    case 'ui/keypad-key-ok':
      return keypadKey(width, height, { border: PALETTE.teal, borderWidth: 3 });
    case 'ui/keypad-key-back':
      return keypadKey(width, height, { border: PALETTE.steel, borderWidth: 3, face: PALETTE.parchmentDim });
    case 'ui/equation-strip':
      return equationStrip(width, height);
    case 'ui/back-chip':
      return backChip(width, height);
    case 'ui/portrait-panel-left':
      return portraitPanel(width, height, 'left');
    case 'ui/portrait-panel-right':
      return portraitPanel(width, height, 'right');
    case 'ui/portrait-slot':
      return portraitSlot(width, height);
    case 'ui/bar-frame-hp':
      return barFrame(width, height);
    case 'ui/bar-fill-hp':
      return barFill(width, height, PALETTE.hpGreen, PALETTE.hpGreenDark);
    case 'ui/bar-frame-chain':
      return barFrame(width, height);
    case 'ui/bar-fill-chain':
      return barFill(width, height, PALETTE.chainCyan, PALETTE.chainCyanDark);
    case 'ui/panel-bracket':
      return panelBracket(width, height);
    case 'ui/dialogue-panel':
      return dialoguePanel(width, height);
    default:
      return null;
  }
}

/** Two concentric thin rings on a barely-there disc — the reference joystick is almost invisible. */
function joystickBase(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const cx = w / 2;
    const cy = h / 2;
    const outer = Math.min(w, h) / 2 - 2;
    fillShape(img, sdfCircle(cx, cy, outer), withAlpha(PALETTE.deckInk, 0.22));
    fillShape(img, sdfOutline(sdfCircle(cx, cy, outer), 2.5), withAlpha(PALETTE.pale, 0.5));
    fillShape(img, sdfOutline(sdfCircle(cx, cy, outer * 0.56), 2), withAlpha(PALETTE.pale, 0.32));
  });
}

function joystickKnob(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 4;
    glowShape(img, sdfCircle(cx, cy, r), withAlpha(PALETTE.accent, 0.5), 4);
    fillShapeGradient(
      img,
      sdfCircle(cx, cy, r),
      withAlpha([120, 126, 138, 255], 0.92),
      withAlpha(PALETTE.steel, 0.92),
      cy - r,
      cy + r,
    );
    fillShape(img, sdfOutline(sdfCircle(cx, cy, r), 3), PALETTE.accent);
    // Specular crescent, top-left, the way the reference knob catches the deck light.
    fillShape(
      img,
      sdfSubtract(sdfCircle(cx - r * 0.22, cy - r * 0.24, r * 0.62), sdfCircle(cx - r * 0.05, cy - r * 0.05, r * 0.58)),
      withAlpha([255, 255, 255, 255], 0.16),
    );
  });
}

function roundButton(w: number, h: number, ring: Rgba, ringAlpha: number, ringWidth = 3): RawImage {
  return withCanvas(w, h, (img) => {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 2;
    fillShape(img, sdfCircle(cx, cy, r), withAlpha(PALETTE.deckInk, 0.58));
    fillShape(img, sdfOutline(sdfCircle(cx, cy, r), ringWidth), withAlpha(ring, ringAlpha));
  });
}

/** The action plate carries the cyan bloom the exploration reference gives the spear button. */
function actionPlate(w: number, h: number): RawImage {
  const img = roundButton(w, h, PALETTE.accent, 0.95, 3);
  const r = Math.min(w, h) / 2 - 2;
  glowShape(img, sdfCircle(w / 2, h / 2, r), withAlpha(PALETTE.accent, 0.35), 3);
  return img;
}

/** The spear the Finish window puts on the action button — blade up-right, haft down-left. */
function spearIcon(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const s = Math.min(w, h);
    const haft = hexRgba('#4a3b2a');
    strokeLine(img, s * 0.2, s * 0.82, s * 0.72, s * 0.3, s * 0.1, haft);
    // Blade: a narrow kite along the same axis.
    fillPolygon(
      img,
      [
        [s * 0.9, s * 0.1],
        [s * 0.66, s * 0.2],
        [s * 0.62, s * 0.38],
        [s * 0.82, s * 0.34],
      ],
      PALETTE.accent,
    );
    fillPolygon(
      img,
      [
        [s * 0.9, s * 0.1],
        [s * 0.7, s * 0.28],
        [s * 0.78, s * 0.32],
      ],
      hexRgba('#dffaff'),
    );
    // Cross-guard.
    strokeLine(img, s * 0.56, s * 0.3, s * 0.72, s * 0.46, s * 0.07, hexRgba('#8d99a6'));
  });
}

function dashIcon(w: number, h: number, colour: Rgba = PALETTE.accent): RawImage {
  return withCanvas(w, h, (img) => {
    const s = Math.min(w, h);
    for (const dx of [0, s * 0.28]) {
      strokeLine(img, s * 0.24 + dx, s * 0.26, s * 0.46 + dx, s * 0.5, s * 0.11, colour);
      strokeLine(img, s * 0.46 + dx, s * 0.5, s * 0.24 + dx, s * 0.74, s * 0.11, colour);
    }
  });
}

function backpackIcon(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const leather = hexRgba('#b8874a');
    const leatherDark = hexRgba('#7c5628');
    fillShape(img, sdfRoundRect(w * 0.16, h * 0.3, w * 0.68, h * 0.58, w * 0.14), leather);
    // Flap and the two straps.
    fillShape(img, sdfRoundRect(w * 0.16, h * 0.3, w * 0.68, h * 0.24, w * 0.12), leatherDark);
    fillShape(img, sdfRoundRect(w * 0.3, h * 0.12, w * 0.4, h * 0.26, w * 0.16), leatherDark);
    fillShape(img, sdfRoundRect(w * 0.36, h * 0.18, w * 0.28, h * 0.2, w * 0.12), withAlpha(PALETTE.deckInk, 0.55));
    fillShape(img, sdfRoundRect(w * 0.42, h * 0.5, w * 0.16, h * 0.14, w * 0.04), hexRgba('#e8c98a'));
  });
}

function backspaceIcon(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const ink = PALETTE.parchmentInk;
    // The reference draws a hexagonal delete key with an × inside.
    // Stroked, not filled-and-punched: an alpha-0 fill is a no-op against a source-over blend,
    // so the hollow has to come from drawing the outline in the first place.
    const pts: ReadonlyArray<readonly [number, number]> = [
      [w * 0.28, h * 0.12],
      [w * 0.94, h * 0.12],
      [w * 0.94, h * 0.88],
      [w * 0.28, h * 0.88],
      [w * 0.06, h * 0.5],
    ];
    const stroke = Math.max(2, h * 0.08);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      strokeLine(img, a[0], a[1], b[0], b[1], stroke, ink);
    }
    strokeLine(img, w * 0.48, h * 0.36, w * 0.76, h * 0.64, stroke, ink);
    strokeLine(img, w * 0.76, h * 0.36, w * 0.48, h * 0.64, stroke, ink);
  });
}

interface KeyOptions {
  readonly border: Rgba;
  readonly borderWidth?: number;
  readonly face?: Rgba;
  readonly pressed?: boolean;
}

/**
 * A keypad key face. The reference keys are parchment rounded rectangles with a hairline darker
 * rim and a two-pixel drop shadow; pressed keys lose the shadow and sit a pixel lower.
 */
function keypadKey(w: number, h: number, options: KeyOptions): RawImage {
  const drop = options.pressed ? 0 : 3;
  const bw = options.borderWidth ?? 2;
  const face = options.face ?? PALETTE.parchment;
  return withCanvas(w, h, (img) => {
    const top = options.pressed ? 2 : 0;
    const body = sdfRoundRect(bw / 2, top + bw / 2, w - bw, h - drop - bw, Math.min(w, h) * 0.18);
    if (!options.pressed) {
      fillShape(
        img,
        sdfRoundRect(bw / 2, drop, w - bw, h - drop - bw, Math.min(w, h) * 0.18),
        withAlpha(PALETTE.parchmentShade, 0.75),
      );
    }
    fillShapeGradient(img, body, face, [
      Math.round(face[0] * 0.93),
      Math.round(face[1] * 0.93),
      Math.round(face[2] * 0.93),
      face[3],
    ], top, h - drop);
    fillShape(img, sdfOutline(body, bw), options.border);
  });
}

/** The equation strip: a wide parchment plate with the top corners rounded, as in the reference. */
function equationStrip(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const body = sdfRoundRect(1, 1, w - 2, h + 8, 10);
    fillShapeGradient(img, body, PALETTE.parchment, PALETTE.parchmentDim, 0, h);
    fillShape(img, sdfOutline(body, 2), PALETTE.parchmentShade);
  });
}

/** The small `◂ BACK` chip that sits on the strip's lower-left corner. */
function backChip(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const body = sdfRoundRect(1, 1, w - 2, h - 2, h / 2);
    fillShape(img, body, PALETTE.parchment);
    fillShape(img, sdfOutline(body, 2), PALETTE.parchmentInk);
    fillPolygon(
      img,
      [
        [w * 0.14, h * 0.5],
        [w * 0.24, h * 0.3],
        [w * 0.24, h * 0.7],
      ],
      PALETTE.parchmentInk,
    );
  });
}

/**
 * Battle HUD portrait panel — dark slate plate, brass corner brackets, a square portrait slot on
 * the side nearest the screen edge. `left` is the ally panel, `right` the enemy's mirror.
 */
function portraitPanel(w: number, h: number, side: 'left' | 'right'): RawImage {
  return withCanvas(w, h, (img) => {
    const body = sdfRoundRect(2, 2, w - 4, h - 4, 6);
    fillShape(img, body, withAlpha(PALETTE.panel, 0.94));
    fillShape(img, sdfOutline(body, 3), PALETTE.panelEdge);
    fillShape(img, sdfOutline(sdfRoundRect(5, 5, w - 10, h - 10, 5), 1.5), withAlpha(PALETTE.brassDark, 0.8));

    const slot = Math.round(h * 0.78);
    const slotX = side === 'left' ? 8 : w - slot - 8;
    const slotY = Math.round((h - slot) / 2);
    blit(img, portraitSlot(slot, slot), slotX, slotY);

    for (const [cx, cy, sx, sy] of cornerSpecs(w, h)) {
      drawBracket(img, cx, cy, sx, sy, Math.min(18, h * 0.28));
    }
  });
}

function cornerSpecs(w: number, h: number): Array<[number, number, number, number]> {
  return [
    [3, 3, 1, 1],
    [w - 4, 3, -1, 1],
    [3, h - 4, 1, -1],
    [w - 4, h - 4, -1, -1],
  ];
}

function drawBracket(img: RawImage, x: number, y: number, sx: number, sy: number, len: number): void {
  strokeLine(img, x, y, x + sx * len, y, 3, PALETTE.brass);
  strokeLine(img, x, y, x, y + sy * len, 3, PALETTE.brass);
}

function portraitSlot(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const body = sdfRoundRect(1, 1, w - 2, h - 2, 4);
    fillShape(img, body, hexRgba('#1d2230'));
    fillShape(img, sdfOutline(body, 2), PALETTE.brassDark);
    fillShape(img, sdfOutline(sdfRoundRect(3, 3, w - 6, h - 6, 3), 1), withAlpha(PALETTE.brass, 0.55));
  });
}

/** Empty bar chrome. The fills are separate frames so the game can crop them by ratio. */
function barFrame(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const body = sdfRoundRect(0.5, 0.5, w - 1, h - 1, h / 2);
    fillShape(img, body, hexRgba('#0d1018'));
    fillShape(img, sdfOutline(body, 2), hexRgba('#3a3f4c'));
  });
}

function barFill(w: number, h: number, top: Rgba, bottom: Rgba): RawImage {
  return withCanvas(w, h, (img) => {
    const body = sdfRoundRect(0, 0, w, h, h / 2);
    fillShapeGradient(img, body, top, bottom, 0, h);
    fillShape(img, sdfRoundRect(1, 1, w - 2, Math.max(1, h * 0.34), h * 0.2), withAlpha([255, 255, 255, 255], 0.22));
  });
}

function panelBracket(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    strokeLine(img, 1.5, 1.5, w - 1, 1.5, 3, PALETTE.brass);
    strokeLine(img, 1.5, 1.5, 1.5, h - 1, 3, PALETTE.brass);
    strokeLine(img, 4.5, 4.5, w * 0.6, 4.5, 1, withAlpha(PALETTE.brassDark, 0.9));
    strokeLine(img, 4.5, 4.5, 4.5, h * 0.6, 1, withAlpha(PALETTE.brassDark, 0.9));
  });
}

function dialoguePanel(w: number, h: number): RawImage {
  return withCanvas(w, h, (img) => {
    const body = sdfRoundRect(2, 2, w - 4, h - 4, 10);
    fillShapeGradient(img, body, PALETTE.parchment, PALETTE.parchmentDim, 0, h);
    fillShape(img, sdfOutline(body, 3), PALETTE.parchmentInk);
    fillShape(img, sdfOutline(sdfRoundRect(7, 7, w - 14, h - 14, 7), 1), withAlpha(PALETTE.parchmentShade, 0.9));
  });
}

// ---------------------------------------------------------------------------------------------
// Terrain and props (stand-ins)
// ---------------------------------------------------------------------------------------------

interface TilePalette {
  readonly base: readonly string[];
  readonly fleck?: readonly string[];
  readonly kind?: 'grass' | 'water' | 'planks' | 'stone';
}

const TILE_PALETTES: Readonly<Record<string, TilePalette>> = {
  'tiles/grass-0': { base: ['#3c5a2e', '#456a34', '#33502a', '#4f7a3c'], fleck: ['#c9d3a2', '#8fae62'], kind: 'grass' },
  'tiles/grass-1': { base: ['#3b5232', '#47603a', '#33482c', '#526b41'], fleck: ['#8d8b7e', '#a7a08c'], kind: 'grass' },
  'tiles/grass-2': { base: ['#4d5442', '#5a6247', '#434a3a', '#666d52'], fleck: ['#7a7f78', '#8f9184'], kind: 'grass' },
  'tiles/dirt-path-0': { base: ['#5b4832', '#6b563c', '#513f2c', '#7a6448'], fleck: ['#46545f', '#8b7256'] },
  'tiles/dirt-path-1': { base: ['#6b6860', '#7d7a70', '#5e5b54', '#8c8880'], fleck: ['#a09c93'] },
  'tiles/stone-0': { base: ['#5b6060', '#6a6f6e', '#4f5454', '#787d7a'], fleck: ['#4e6b3f'], kind: 'stone' },
  'tiles/stone-1': { base: ['#616463', '#70746f', '#565958', '#7c807a'], fleck: ['#2f6f74'], kind: 'stone' },
  'tiles/water-edge-0': { base: ['#3f6d72', '#4e8189', '#37605f', '#5f979d'], fleck: ['#cfe3e0'], kind: 'water' },
  'tiles/water-deep-0': { base: ['#24484f', '#1c3a41', '#2d565e', '#20424a'], fleck: ['#5f979d'], kind: 'water' },
  'tiles/reeds-0': { base: ['#33482c', '#3b5232', '#2b3d26'], fleck: ['#6d8a4a', '#8ea45c'], kind: 'grass' },
  'tiles/bridge-planks-0': { base: ['#6a4f36', '#5b432d', '#77593d'], fleck: ['#3a2a1c'], kind: 'planks' },
};

/**
 * Seeded value-noise terrain. Not art — but it tiles, it sits in the right palette, and a build
 * with no network produces a world you can actually walk around in rather than a checkerboard.
 */
export function drawTile(frame: string, size: number): RawImage | null {
  const palette = TILE_PALETTES[frame];
  if (palette) return noiseTile(frame, size, palette);
  return drawProp(frame, size);
}

function noiseTile(frame: string, size: number, palette: TilePalette): RawImage {
  const rng = new Rng(`tile:${frame}`);
  const colours = palette.base.map((c) => hexRgba(c));
  const img = blankImage(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let idx = rng.int(0, colours.length - 1);
      if (palette.kind === 'water') {
        // Horizontal banding reads as slow current rather than static.
        idx = (idx + Math.floor(y / 4)) % colours.length;
      } else if (palette.kind === 'planks') {
        idx = Math.floor(y / 8) % 2 === 0 ? idx % 2 : 2;
      }
      const c = colours[idx]!;
      const i = (y * size + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }

  if (palette.kind === 'planks') {
    const seam = hexRgba('#332415');
    for (let y = 0; y < size; y += 8) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        img.data[i] = seam[0];
        img.data[i + 1] = seam[1];
        img.data[i + 2] = seam[2];
      }
    }
  }

  if (palette.kind === 'grass') {
    // Blades wrap at the edges so the tile stays seamless.
    const blade = colours[colours.length - 1]!;
    for (let n = 0; n < size; n++) {
      const bx = rng.int(0, size - 1);
      const by = rng.int(0, size - 1);
      for (let k = 0; k < 3; k++) {
        const i = (((by + k) % size) * size + bx) * 4;
        img.data[i] = blade[0];
        img.data[i + 1] = blade[1];
        img.data[i + 2] = blade[2];
      }
    }
  }

  for (const hex of palette.fleck ?? []) {
    const c = hexRgba(hex);
    const count = Math.max(2, Math.round((size * size) / 220));
    for (let n = 0; n < count; n++) {
      const i = (rng.int(0, size - 1) * size + rng.int(0, size - 1)) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
    }
  }

  return img;
}

/** Simple readable silhouettes for the hero props, in the same palette as the terrain. */
function drawProp(frame: string, size: number): RawImage | null {
  const s = size;
  switch (frame) {
    case 'tiles/rock-0':
    case 'tiles/rock-1':
      return withCanvas(s, s, (img) => {
        fillShape(img, sdfEllipse(s * 0.5, s * 0.86, s * 0.36, s * 0.09), withAlpha(PALETTE.deckInk, 0.35));
        fillShape(img, sdfEllipse(s * 0.5, s * 0.6, s * 0.38, s * 0.3), hexRgba('#6a6f6e'));
        fillShape(img, sdfEllipse(s * 0.42, s * 0.5, s * 0.24, s * 0.18), hexRgba('#7d8280'));
        fillShape(img, sdfEllipse(s * 0.6, s * 0.42, s * 0.16, s * 0.08), hexRgba('#4e6b3f'));
      });
    case 'tiles/waystone-0':
      return withCanvas(s, s, (img) => {
        fillShape(img, sdfEllipse(s * 0.5, s * 0.92, s * 0.3, s * 0.07), withAlpha(PALETTE.deckInk, 0.35));
        fillPolygon(
          img,
          [
            [s * 0.36, s * 0.9],
            [s * 0.4, s * 0.18],
            [s * 0.6, s * 0.14],
            [s * 0.66, s * 0.9],
          ],
          hexRgba('#6d7370'),
        );
        fillShape(img, sdfOutline(sdfCircle(s * 0.51, s * 0.44, s * 0.11), 3), withAlpha(PALETTE.accent, 0.9));
        glowShape(img, sdfCircle(s * 0.51, s * 0.44, s * 0.12), withAlpha(PALETTE.accent, 0.4), 4);
      });
    case 'tiles/lantern-0':
      return withCanvas(s, s, (img) => {
        fillShape(img, sdfEllipse(s * 0.5, s * 0.94, s * 0.24, s * 0.05), withAlpha(PALETTE.deckInk, 0.35));
        fillShape(img, sdfRoundRect(s * 0.42, s * 0.5, s * 0.16, s * 0.44, 2), hexRgba('#5e6360'));
        fillShape(img, sdfRoundRect(s * 0.3, s * 0.26, s * 0.4, s * 0.28, 3), hexRgba('#6d7370'));
        fillShape(img, sdfRoundRect(s * 0.36, s * 0.32, s * 0.28, s * 0.16, 2), hexRgba('#f0a94a'));
        glowShape(img, sdfRoundRect(s * 0.34, s * 0.3, s * 0.32, s * 0.2, 2), withAlpha(hexRgba('#ffb35c'), 0.45), 8);
        fillPolygon(
          img,
          [
            [s * 0.26, s * 0.28],
            [s * 0.74, s * 0.28],
            [s * 0.5, s * 0.12],
          ],
          hexRgba('#4d5250'),
        );
      });
    case 'tiles/tree-trunk-0':
      return withCanvas(s, s, (img) => {
        fillPolygon(
          img,
          [
            [s * 0.38, s * 0.98],
            [s * 0.42, s * 0.2],
            [s * 0.58, s * 0.2],
            [s * 0.64, s * 0.98],
          ],
          hexRgba('#4a3a2a'),
        );
        fillShape(img, sdfEllipse(s * 0.5, s * 0.96, s * 0.32, s * 0.08), hexRgba('#3a2d20'));
      });
    case 'tiles/shrine-torii-0':
      return withCanvas(s, s, (img) => {
        const wood = hexRgba('#5a3f34');
        const woodDark = hexRgba('#412d25');
        fillShape(img, sdfRoundRect(s * 0.2, s * 0.28, s * 0.08, s * 0.66, 2), wood);
        fillShape(img, sdfRoundRect(s * 0.72, s * 0.28, s * 0.08, s * 0.66, 2), wood);
        fillPolygon(
          img,
          [
            [s * 0.08, s * 0.24],
            [s * 0.92, s * 0.24],
            [s * 0.88, s * 0.32],
            [s * 0.12, s * 0.32],
          ],
          woodDark,
        );
        fillShape(img, sdfRoundRect(s * 0.16, s * 0.42, s * 0.68, s * 0.07, 2), wood);
        fillShape(img, sdfRoundRect(s * 0.34, s * 0.33, s * 0.32, s * 0.06, 2), hexRgba('#c8b48c'));
      });
    case 'tiles/tree-canopy-0':
      return withCanvas(s, s, (img) => {
        const rng = new Rng('canopy');
        for (let n = 0; n < 22; n++) {
          const cx = s * 0.5 + (rng.float() - 0.5) * s * 0.58;
          const cy = s * 0.5 + (rng.float() - 0.5) * s * 0.58;
          const r = s * (0.13 + rng.float() * 0.12);
          const shade = ['#243d1f', '#2d4a26', '#1c3019', '#37582c'][rng.int(0, 3)]!;
          fillShape(img, sdfCircle(cx, cy, r), hexRgba(shade));
        }
      });
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Last-resort placeholder
// ---------------------------------------------------------------------------------------------

/**
 * The loud one. Used only when a frame has neither source art nor a procedural recipe — a
 * diagonal-hatched ember-on-slate plate with a corner notch. It must be impossible to mistake
 * for finished art in a screenshot, because a subtle placeholder is a bug that ships.
 */
export function placeholderFrame(frame: string, width: number, height: number): RawImage {
  const img = blankImage(width, height);
  const body = sdfRoundRect(1, 1, width - 2, height - 2, Math.min(width, height) * 0.12);
  fillShape(img, body, PALETTE.warnInk);

  const step = Math.max(4, Math.round(Math.min(width, height) / 6));
  for (let d = -height; d < width; d += step) {
    strokeLine(img, d, 0, d + height, height, Math.max(1, step / 4), withAlpha(PALETTE.warnEmber, 0.55));
  }
  fillShape(img, sdfOutline(body, 2), PALETTE.warnEmber);

  // A dot per word of the frame name gives a coarse but readable identity at a glance.
  const rng = new Rng(`placeholder:${frame}`);
  const dots = Math.min(6, Math.max(1, frame.split(/[/\-_]/).length));
  const dotR = Math.max(1, Math.min(width, height) * 0.05);
  for (let i = 0; i < dots; i++) {
    fillShape(
      img,
      sdfCircle(width * (0.16 + 0.14 * i), height * (0.5 + (rng.float() - 0.5) * 0.1), dotR),
      PALETTE.warnEmber,
    );
  }
  return img;
}
