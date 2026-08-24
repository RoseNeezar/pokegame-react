/**
 * Deck and HUD widgets, drawn in Phaser Graphics rather than loaded as textures.
 *
 * The control deck is pure geometry in all three references — rings, circles, rounded
 * rectangles and two icons. Drawing it means it stays crisp at any FIT scale, needs no atlas,
 * and can be restyled from `PALETTE` alone. The pixel-art atlases are reserved for the world
 * and the creatures, which is where hand-authored pixels actually earn their place.
 */
import Phaser from 'phaser';
import { PALETTE } from '../game/layout.ts';

export interface RoundButtonConfig {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  /** Draws the glyph inside the button. Origin is the button centre. */
  readonly icon?: (g: Phaser.GameObjects.Graphics, r: number) => void;
  readonly accent?: boolean;
  readonly label?: string;
}

/**
 * A circular deck button.
 *
 * Two visual grades, both present in the exploration reference: the primary action button has a
 * bright cyan rim and a soft glow, while the dash and backpack buttons use a thin pale-grey
 * stroke. The grade is what tells the thumb which button is the important one.
 */
export class RoundButton extends Phaser.GameObjects.Container {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Zone;
  private readonly cfg: RoundButtonConfig;
  private pressed = false;
  private enabledState = true;
  private labelText: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, cfg: RoundButtonConfig) {
    super(scene, cfg.cx, cfg.cy);
    this.cfg = cfg;
    this.gfx = scene.add.graphics();
    this.add(this.gfx);

    if (cfg.label) {
      this.labelText = scene.add
        .text(0, 0, cfg.label, {
          fontFamily: 'monospace',
          fontSize: `${Math.round(cfg.radius * 0.5)}px`,
          color: '#f2ede2',
        })
        .setOrigin(0.5);
      this.add(this.labelText);
    }

    // A plain interactive Zone rather than a hit area on the Container itself: Container
    // hit-testing depends on the container's own size/transform and silently fails to receive
    // pointers in a multi-camera scene, which is exactly what this deck is.
    this.setSize(cfg.radius * 2, cfg.radius * 2);
    this.hit = scene.add
      .zone(0, 0, cfg.radius * 2.3, cfg.radius * 2.3)
      .setInteractive({ useHandCursor: true });
    this.add(this.hit);

    this.hit.on('pointerdown', () => {
      if (!this.enabledState) return;
      this.pressed = true;
      this.redraw();
      this.emit('press');
    });
    const release = () => {
      if (!this.pressed) return;
      this.pressed = false;
      this.redraw();
      this.emit('release');
    };
    this.hit.on('pointerup', release);
    this.hit.on('pointerout', release);
    this.hit.on('pointerupoutside', release);

    scene.add.existing(this);
    this.redraw();
  }

  setEnabledState(on: boolean): this {
    this.enabledState = on;
    this.setAlpha(on ? 1 : 0.35);
    if (on) this.hit.setInteractive({ useHandCursor: true });
    else this.hit.disableInteractive();
    this.redraw();
    return this;
  }

  isPressed(): boolean {
    return this.pressed;
  }

  private redraw(): void {
    const { radius, accent, icon } = this.cfg;
    const g = this.gfx;
    g.clear();

    if (accent) {
      // Soft outward glow, three decreasing rings — cheaper and crisper than a blur shader.
      for (let i = 3; i >= 1; i--) {
        g.fillStyle(PALETTE.cyanGlow, 0.05 * i);
        g.fillCircle(0, 0, radius + i * 5);
      }
    }

    g.fillStyle(PALETTE.deckDarkEdge, this.pressed ? 0.95 : 0.8);
    g.fillCircle(0, 0, radius);

    g.lineStyle(accent ? 3 : 2, accent ? PALETTE.cyan : PALETTE.stroke, this.pressed ? 1 : 0.75);
    g.strokeCircle(0, 0, radius);

    if (accent) {
      g.lineStyle(1, PALETTE.cyan, 0.35);
      g.strokeCircle(0, 0, radius - 9);
    }

    if (icon) icon(g, radius);
  }
}

/* --------------------------------------------------------------- icons */

/** The `»` dash chevrons from the exploration reference. */
export function dashIcon(g: Phaser.GameObjects.Graphics, r: number): void {
  const s = r * 0.42;
  g.lineStyle(Math.max(3, r * 0.13), PALETTE.cyan, 1);
  for (const dx of [-s * 0.55, s * 0.35]) {
    g.beginPath();
    g.moveTo(dx - s * 0.35, -s * 0.6);
    g.lineTo(dx + s * 0.35, 0);
    g.lineTo(dx - s * 0.35, s * 0.6);
    g.strokePath();
  }
}

/** The blade on the action button. Drawn as pixel-ish blocks to sit with the world art. */
export function bladeIcon(g: Phaser.GameObjects.Graphics, r: number): void {
  const u = Math.max(2, Math.round(r * 0.085));
  const blade = [
    [2, -5],
    [1, -4],
    [1, -3],
    [0, -2],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [-2, 2],
  ];
  g.fillStyle(PALETTE.cyan, 1);
  for (const [x, y] of blade) {
    g.fillRect(x! * u, y! * u, u * 2, u * 2);
  }
  // Tip highlight and crossguard.
  g.fillStyle(0xffffff, 0.9);
  g.fillRect(2 * u, -5 * u, u, u);
  g.fillStyle(PALETTE.cyanGlow, 1);
  g.fillRect(-4 * u, 1 * u, u * 6, u); // guard
  g.fillRect(-4 * u, 2 * u, u * 2, u * 3); // grip
  g.fillRect(-5 * u, 4 * u, u * 3, u); // pommel
}

/** The tan backpack from the exploration reference. */
export function backpackIcon(g: Phaser.GameObjects.Graphics, r: number): void {
  const w = r * 0.9;
  const h = r * 0.95;
  g.fillStyle(0xc99a52, 1);
  g.fillRoundedRect(-w / 2, -h / 2 + h * 0.18, w, h * 0.82, r * 0.18);
  g.fillStyle(0x8a6531, 1);
  g.fillRoundedRect(-w / 2, -h / 2 + h * 0.18, w, h * 0.3, r * 0.16);
  // The two shoulder loops.
  g.lineStyle(Math.max(2, r * 0.09), 0x8a6531, 1);
  g.beginPath();
  g.arc(-w * 0.18, -h * 0.34, r * 0.2, Math.PI, 0);
  g.strokePath();
  g.beginPath();
  g.arc(w * 0.18, -h * 0.34, r * 0.2, Math.PI, 0);
  g.strokePath();
  g.fillStyle(0x5e441f, 1);
  g.fillRect(-w * 0.1, h * 0.02, w * 0.2, h * 0.16);
}

/* ------------------------------------------------------------- joystick */

export interface JoystickConfig {
  readonly cx: number;
  readonly cy: number;
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly knobRadius: number;
  readonly travel: number;
}

/**
 * The analogue stick.
 *
 * Two concentric guide rings with a free-floating knob, exactly as the reference draws it. The
 * stick is *not* re-centred on the touch point: the reference shows fixed rings, so the control
 * is absolute and the player learns where the ring is by feel.
 */
export class Joystick extends Phaser.GameObjects.Container {
  private readonly base: Phaser.GameObjects.Graphics;
  private readonly knob: Phaser.GameObjects.Graphics;
  private readonly hit: Phaser.GameObjects.Zone;
  private readonly cfg: JoystickConfig;
  private pointerId: number | null = null;

  /** −1..1 on each axis, already dead-zoned and magnitude-clamped. */
  vector = new Phaser.Math.Vector2(0, 0);

  constructor(scene: Phaser.Scene, cfg: JoystickConfig) {
    super(scene, cfg.cx, cfg.cy);
    this.cfg = cfg;

    this.base = scene.add.graphics();
    this.knob = scene.add.graphics();
    this.add([this.base, this.knob]);


    this.drawBase();
    this.drawKnob(0, 0);

    // See the note on RoundButton: an explicit Zone is the only reliable hit target here.
    this.setSize(cfg.outerRadius * 2, cfg.outerRadius * 2);
    this.hit = scene.add
      .zone(0, 0, cfg.outerRadius * 2.2, cfg.outerRadius * 2.2)
      .setInteractive({ useHandCursor: true });
    this.add(this.hit);

    this.hit.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.pointerId = p.id;
      this.trackPointer(p);
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.pointerId === p.id) this.trackPointer(p);
    });
    const end = (p: Phaser.Input.Pointer) => {
      if (this.pointerId !== p.id) return;
      this.pointerId = null;
      this.vector.set(0, 0);
      this.drawKnob(0, 0);
    };
    scene.input.on('pointerup', end);
    scene.input.on('pointerupoutside', end);

    scene.add.existing(this);
  }

  private trackPointer(p: Phaser.Input.Pointer): void {
    // Canvas-space coordinates, not world-space: the deck rides a fixed UI camera, so
    // `worldX/Y` would be offset by the world camera's scroll and zoom.
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const len = Math.hypot(dx, dy);
    const clamped = Math.min(len, this.cfg.travel);
    const nx = len === 0 ? 0 : (dx / len) * clamped;
    const ny = len === 0 ? 0 : (dy / len) * clamped;

    const mag = clamped / this.cfg.travel;
    // A small dead zone keeps a resting thumb from drifting the player.
    const dead = 0.14;
    const scaled = mag < dead ? 0 : (mag - dead) / (1 - dead);
    this.vector.set(len === 0 ? 0 : (dx / len) * scaled, len === 0 ? 0 : (dy / len) * scaled);
    this.drawKnob(nx, ny);
  }

  private drawBase(): void {
    const g = this.base;
    g.clear();
    g.lineStyle(2, PALETTE.stroke, 0.32);
    g.strokeCircle(0, 0, this.cfg.outerRadius);
    g.lineStyle(2, PALETTE.stroke, 0.24);
    g.strokeCircle(0, 0, this.cfg.innerRadius);
  }

  private drawKnob(x: number, y: number): void {
    const g = this.knob;
    const r = this.cfg.knobRadius;
    g.clear();
    // The reference parks the knob up-and-right of centre at rest, which reads as "ready".
    const rx = this.pointerId === null ? r * 0.95 : x;
    const ry = this.pointerId === null ? -r * 0.75 : y;
    g.fillStyle(0x8e97a4, 0.55);
    g.fillCircle(rx, ry, r);
    g.lineStyle(3, PALETTE.cyan, 0.95);
    g.strokeCircle(rx, ry, r);
  }

  /** True while the player is actually holding the stick. */
  get held(): boolean {
    return this.pointerId !== null;
  }
}

/* ------------------------------------------------------------ bar & panel */

/** Draws a rounded bar with a track behind it. Used for HP and Chain. */
export function drawBar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  colour: number,
  track: number,
): void {
  const r = Math.min(h / 2, 6);
  g.fillStyle(track, 1);
  g.fillRoundedRect(x, y, w, h, r);
  const filled = Math.max(0, Math.min(1, ratio)) * w;
  if (filled > 1) {
    g.fillStyle(colour, 1);
    g.fillRoundedRect(x, y, Math.max(filled, r * 2), h, r);
    // A lighter top edge, the way the reference bars are lit.
    g.fillStyle(0xffffff, 0.18);
    g.fillRoundedRect(x, y, Math.max(filled, r * 2), Math.max(2, h * 0.3), r);
  }
}

/** HP colour by remaining fraction — green, then amber, then red. */
export function hpColour(ratio: number): number {
  if (ratio > 0.5) return PALETTE.hpHigh;
  if (ratio > 0.2) return PALETTE.hpMid;
  return PALETTE.hpLow;
}

/**
 * The ornate brass-framed panel the battle HUD sits in.
 * Corner ticks stand in for the reference's filigree at this size — the filigree does not
 * survive being drawn at 1/3 scale, but the corner accents preserve its silhouette.
 */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  g.fillStyle(PALETTE.panel, 0.94);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(3, PALETTE.panelEdge, 0.9);
  g.strokeRoundedRect(x, y, w, h, radius);
  g.lineStyle(1, PALETTE.panelEdgeDim, 0.8);
  g.strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, Math.max(2, radius - 3));

  const t = Math.min(14, w * 0.08);
  g.lineStyle(3, PALETTE.panelEdge, 1);
  for (const [cx, cy, sx, sy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ] as const) {
    g.beginPath();
    g.moveTo(cx + sx * t, cy);
    g.lineTo(cx + sx * radius * 0.4, cy);
    g.moveTo(cx, cy + sy * t);
    g.lineTo(cx, cy + sy * radius * 0.4);
    g.strokePath();
  }
}

/** A parchment keypad key, matching the math-combat reference. */
export function drawKey(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  opts: { pressed?: boolean; accent?: boolean; muted?: boolean } = {},
): void {
  // Drop shadow — the reference keys sit visibly proud of the deck.
  g.fillStyle(0x000000, 0.35);
  g.fillRoundedRect(x + 2, y + 4, w, h, radius);

  g.fillStyle(opts.pressed ? PALETTE.keyPressed : opts.muted ? 0xd9d2c6 : PALETTE.key, 1);
  g.fillRoundedRect(x, y, w, h, radius);

  g.lineStyle(3, opts.accent ? PALETTE.accent : opts.muted ? 0x8d8b85 : PALETTE.keyEdge, 1);
  g.strokeRoundedRect(x, y, w, h, radius);
}
