/**
 * The control deck — the bottom 38% of the screen.
 *
 * All three mode references share one world viewport and differ only here, so the deck is a
 * single persistent object that morphs rather than three separate UIs that swap. That is not
 * merely tidy: it is why battle in this game feels like something that happens *to* the walk
 * rather than a place you are taken to. The camera pushes in, the deck changes shape, and the
 * scene under it never cuts.
 *
 * Modes:
 *   explore — joystick, dash, action, backpack           (exploration reference)
 *   math    — equation strip, BACK, 3×4 numeric keypad   (math-combat reference)
 *   finish  — the exploration deck again, action re-labelled as the Finish strike
 *             (finish reference: the deck visibly reverts)
 */
import Phaser from 'phaser';
import {
  DECK,
  DECK_HEIGHT,
  DECK_TOP,
  KEYPAD,
  LOGICAL_WIDTH,
  PALETTE,
  DEPTH,
} from '../game/layout.ts';
import { Joystick, RoundButton, backpackIcon, bladeIcon, dashIcon, drawKey } from './widgets.ts';

export type DeckMode = 'explore' | 'math' | 'finish' | 'hidden';

export interface DeckEvents {
  /** Fired on every keypad digit / backspace / OK. */
  key: (value: string) => void;
  /** Fired when the player submits a complete answer. */
  submit: (value: number) => void;
  back: () => void;
  action: () => void;
  /** Emitted when the action button is held past the Bind threshold. */
  actionHold: () => void;
  dash: (down: boolean) => void;
  backpack: () => void;
}

/** How long the action button must be held for a Bind rather than a Sever. */
export const BIND_HOLD_MS = 420;

export class ControlDeck extends Phaser.Events.EventEmitter {
  readonly scene: Phaser.Scene;
  private mode: DeckMode = 'explore';

  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly exploreLayer: Phaser.GameObjects.Container;
  private readonly mathLayer: Phaser.GameObjects.Container;

  readonly joystick: Joystick;
  private readonly dashBtn: RoundButton;
  private readonly actionBtn: RoundButton;
  private readonly backpackBtn: RoundButton;

  private readonly keyGfx: Phaser.GameObjects.Graphics;
  private readonly keyTexts: Phaser.GameObjects.Text[] = [];
  private readonly equationText: Phaser.GameObjects.Text;
  private readonly entryText: Phaser.GameObjects.Text;
  private readonly timerGfx: Phaser.GameObjects.Graphics;
  private readonly actionLabel: Phaser.GameObjects.Text;

  private entry = '';
  private expectedDigits = 3;
  private pressedKey: string | null = null;
  private actionDownAt = 0;
  private holdFired = false;
  private timerRatio = 1;

  constructor(scene: Phaser.Scene) {
    super();
    this.scene = scene;

    this.ground = scene.add.graphics().setDepth(DEPTH.deck).setScrollFactor(0);
    this.exploreLayer = scene.add.container(0, 0).setDepth(DEPTH.deck + 1).setScrollFactor(0);
    this.mathLayer = scene.add.container(0, 0).setDepth(DEPTH.deck + 1).setScrollFactor(0);

    /* -------------------------------------------------- exploration deck */

    this.joystick = new Joystick(scene, DECK.joystick);
    this.dashBtn = new RoundButton(scene, { ...DECK.dash, icon: dashIcon });
    this.actionBtn = new RoundButton(scene, { ...DECK.action, icon: bladeIcon, accent: true });
    this.backpackBtn = new RoundButton(scene, { ...DECK.backpack, icon: backpackIcon });

    this.actionLabel = scene.add
      .text(DECK.action.cx, DECK.action.cy + DECK.action.radius + 14, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '15px',
        color: '#74d8f0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);

    this.exploreLayer.add([
      this.joystick,
      this.dashBtn,
      this.actionBtn,
      this.backpackBtn,
      this.actionLabel,
    ]);

    this.dashBtn.on('press', () => this.emit('dash', true));
    this.dashBtn.on('release', () => this.emit('dash', false));
    this.backpackBtn.on('press', () => this.emit('backpack'));

    this.actionBtn.on('press', () => {
      this.actionDownAt = scene.time.now;
      this.holdFired = false;
    });
    this.actionBtn.on('release', () => {
      if (this.holdFired) return;
      this.emit('action');
    });

    /* --------------------------------------------------- math-combat deck */

    this.keyGfx = scene.add.graphics().setScrollFactor(0);
    this.timerGfx = scene.add.graphics().setScrollFactor(0);

    this.equationText = scene.add
      .text(KEYPAD.equation.x + 12, KEYPAD.equation.y + KEYPAD.equation.h / 2, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '24px',
        color: '#1b2340',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0);

    this.entryText = scene.add
      .text(
        KEYPAD.equation.x + KEYPAD.equation.w - 14,
        KEYPAD.equation.y + KEYPAD.equation.h / 2,
        '',
        {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '26px',
          color: '#22305a',
          fontStyle: 'bold',
        },
      )
      .setOrigin(1, 0.5)
      .setScrollFactor(0);

    this.mathLayer.add([this.keyGfx, this.timerGfx, this.equationText, this.entryText]);
    this.buildKeypad();

    this.setMode('explore');
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
      this.removeAllListeners();
    });
  }

  /* ------------------------------------------------------------ keypad */

  /** Key faces in the reference's order: 1-9, then backspace, 0, OK. */
  private static readonly KEYS: ReadonlyArray<ReadonlyArray<string>> = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['⌫', '0', 'OK'],
  ];

  private keyRect(row: number, col: number): { x: number; y: number; w: number; h: number } {
    return {
      x: KEYPAD.origin.x + col * (KEYPAD.keyWidth + KEYPAD.gapX),
      y: KEYPAD.origin.y + row * (KEYPAD.keyHeight + KEYPAD.gapY),
      w: KEYPAD.keyWidth,
      h: KEYPAD.keyHeight,
    };
  }

  private buildKeypad(): void {
    ControlDeck.KEYS.forEach((rowKeys, row) => {
      rowKeys.forEach((label, col) => {
        const r = this.keyRect(row, col);
        const t = this.scene.add
          .text(r.x + r.w / 2, r.y + r.h / 2, label, {
            fontFamily: 'ui-monospace, monospace',
            fontSize: label.length > 1 ? '30px' : '40px',
            color: '#1b2340',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setScrollFactor(0);

        const zone = this.scene.add
          .zone(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true });

        zone.on('pointerdown', () => {
          this.pressedKey = label;
          this.redrawKeys();
          this.press(label);
        });
        const up = () => {
          if (this.pressedKey === label) {
            this.pressedKey = null;
            this.redrawKeys();
          }
        };
        zone.on('pointerup', up);
        zone.on('pointerout', up);

        this.keyTexts.push(t);
        this.mathLayer.add([zone, t]);
      });
    });

    // The "◀ BACK" pill.
    const b = KEYPAD.back;
    const backText = this.scene.add
      .text(b.x + b.w / 2, b.y + b.h / 2, '◀ BACK', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '16px',
        color: '#1b2340',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    const backZone = this.scene.add
      .zone(b.x + b.w / 2, b.y + b.h / 2, b.w, b.h)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    backZone.on('pointerdown', () => this.emit('back'));
    this.mathLayer.add([backZone, backText]);
  }

  private press(label: string): void {
    this.emit('key', label);
    if (label === 'OK') {
      this.commit();
      return;
    }
    if (label === '⌫') {
      this.entry = this.entry.slice(0, -1);
      this.refreshEntry();
      return;
    }
    // A leading zero is meaningless for these answers and only causes mis-entry.
    if (this.entry === '0') this.entry = '';
    if (this.entry.length >= Math.max(this.expectedDigits, 4)) return;
    this.entry += label;
    this.refreshEntry();
  }

  private commit(): void {
    if (this.entry.length === 0) return;
    const value = Number(this.entry);
    this.entry = '';
    this.refreshEntry();
    if (Number.isFinite(value)) this.emit('submit', value);
  }

  private refreshEntry(): void {
    this.entryText.setText(this.entry.length > 0 ? this.entry : '_');
  }

  private redrawKeys(): void {
    const g = this.keyGfx;
    g.clear();

    // Deck ground behind the keypad — the deep navy of the reference.
    g.fillStyle(PALETTE.deckNavy, 1);
    g.fillRect(0, DECK_TOP, LOGICAL_WIDTH, DECK_HEIGHT);
    g.fillStyle(0x000000, 0.12);
    g.fillRect(0, DECK_TOP, LOGICAL_WIDTH, 6);

    // BACK pill and the equation strip, both parchment.
    drawKey(g, KEYPAD.back.x, KEYPAD.back.y, KEYPAD.back.w, KEYPAD.back.h, KEYPAD.back.h / 2, {
      muted: true,
    });
    drawKey(
      g,
      KEYPAD.equation.x,
      KEYPAD.equation.y,
      KEYPAD.equation.w,
      KEYPAD.equation.h,
      KEYPAD.cornerRadius,
    );

    ControlDeck.KEYS.forEach((rowKeys, row) => {
      rowKeys.forEach((label, col) => {
        const r = this.keyRect(row, col);
        drawKey(g, r.x, r.y, r.w, r.h, KEYPAD.cornerRadius, {
          pressed: this.pressedKey === label,
          accent: label === 'OK',
          muted: label === '⌫',
        });
      });
    });
  }

  /* ------------------------------------------------------------- timer */

  /**
   * The answer timer, drawn as a thin bar across the top of the equation strip.
   *
   * The manga is explicit that the timer is the pressure ("The hard part is not panicking when
   * the timer bar moves"), so it is always visible but never the loudest thing on screen.
   */
  setTimer(ratio: number): void {
    this.timerRatio = Phaser.Math.Clamp(ratio, 0, 1);
    const g = this.timerGfx;
    g.clear();
    if (this.mode !== 'math') return;
    const { x, y, w } = KEYPAD.equation;
    const h = 5;
    g.fillStyle(PALETTE.chainTrack, 1);
    g.fillRect(x, y - h - 3, w, h);
    const colour =
      this.timerRatio > 0.5 ? PALETTE.accent : this.timerRatio > 0.2 ? PALETTE.hpMid : PALETTE.danger;
    g.fillStyle(colour, 1);
    g.fillRect(x, y - h - 3, w * this.timerRatio, h);
  }

  /* -------------------------------------------------------------- modes */

  setMode(mode: DeckMode): void {
    this.mode = mode;
    const explore = mode === 'explore' || mode === 'finish';
    this.exploreLayer.setVisible(explore).setActive(explore);
    this.mathLayer.setVisible(mode === 'math').setActive(mode === 'math');

    // The joystick has scene-level pointer listeners, so it must be told to stop tracking.
    this.joystick.setVisible(explore);

    if (mode === 'finish') {
      this.actionLabel.setText('FINISH  ·  hold to BIND');
      this.dashBtn.setEnabledState(false);
    } else {
      this.actionLabel.setText('');
      this.dashBtn.setEnabledState(true);
    }

    this.redrawGround();
    if (mode === 'math') this.redrawKeys();
    this.setTimer(this.timerRatio);
  }

  getMode(): DeckMode {
    return this.mode;
  }

  private redrawGround(): void {
    const g = this.ground;
    g.clear();
    if (this.mode === 'hidden') return;

    if (this.mode === 'math') {
      // The keypad graphics paint their own ground.
      return;
    }
    // Exploration / Finish: near-black navy with a subtle vertical lift, as measured.
    g.fillStyle(PALETTE.deckDark, 1);
    g.fillRect(0, DECK_TOP, LOGICAL_WIDTH, DECK_HEIGHT);
    g.fillStyle(PALETTE.deckDarkEdge, 0.85);
    g.fillRect(0, DECK_TOP + DECK_HEIGHT * 0.55, LOGICAL_WIDTH, DECK_HEIGHT * 0.45);
    g.fillStyle(0x000000, 0.35);
    g.fillRect(0, DECK_TOP, LOGICAL_WIDTH, 3);
  }

  /* ------------------------------------------------------------ question */

  /** Shows a question on the equation strip. `digits` sizes the entry field. */
  showQuestion(prompt: string, digits: number): void {
    this.equationText.setText(prompt);
    this.expectedDigits = Math.max(1, digits);
    this.entry = '';
    this.refreshEntry();
    this.redrawKeys();
  }

  clearQuestion(): void {
    this.equationText.setText('');
    this.entry = '';
    this.entryText.setText('');
  }

  /* ------------------------------------------------------------- update */

  private onUpdate(): void {
    if (
      this.mode === 'finish' &&
      this.actionBtn.isPressed() &&
      !this.holdFired &&
      this.scene.time.now - this.actionDownAt >= BIND_HOLD_MS
    ) {
      this.holdFired = true;
      this.emit('actionHold');
    }
  }

  /** Movement vector from the stick, for the world scene to consume. */
  get moveVector(): Phaser.Math.Vector2 {
    return this.joystick.vector;
  }

  get dashHeld(): boolean {
    return this.dashBtn.isPressed();
  }
}
