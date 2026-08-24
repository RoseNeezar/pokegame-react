/**
 * Title, and the prologue that hands the player their first spirit.
 *
 * The manga opens on a licence, three spirits under a shrine's steps, and a mentor who tells you
 * the chain is just "don't stop". The starter choice is the first thing the game asks, and it is
 * the last thing it asks before the player is on their own.
 */
import Phaser from 'phaser';
import { DEPTH, LOGICAL_HEIGHT, LOGICAL_WIDTH, PALETTE } from '../layout.ts';
import { drawKey, drawPanel } from '../../ui/widgets.ts';
import { species } from '../../core/dex.ts';
import { Rng } from '../../core/rng.ts';
import { clearSave, giveStarter, hasSave, load, newGame, save, type GameState } from '../state.ts';

/** The three starters, in the order the manga presents them. */
const STARTERS = ['fawnix', 'spriglim', 'frostel'] as const;

const STARTER_BLURB: Record<string, string> = {
  fawnix: 'Ember-tailed. Quick, and warmer than it looks.',
  spriglim: 'A leaf sprite. Patient. Grows into something wide.',
  frostel: 'Snow weasel. Sharp, and it does not wait.',
};

export class TitleScene extends Phaser.Scene {
  private state!: GameState;
  private step: 'title' | 'starter' = 'title';
  private layer!: Phaser.GameObjects.Container;
  private gfx!: Phaser.GameObjects.Graphics;

  constructor() {
    super('Title');
  }

  create(): void {
    this.gfx = this.add.graphics().setDepth(DEPTH.overlay - 1);
    this.layer = this.add.container(0, 0).setDepth(DEPTH.overlay);
    this.drawBackdrop();
    this.showTitle();
  }

  private drawBackdrop(): void {
    const g = this.gfx;
    g.clear();
    g.fillStyle(PALETTE.deckDarkEdge, 1);
    g.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    // A rain-worn wash: horizontal bands and a scatter of ember motes, cheap and on-tone.
    const rng = new Rng('title-backdrop');
    for (let i = 0; i < 46; i++) {
      const y = rng.int(0, LOGICAL_HEIGHT);
      g.fillStyle(0x16202e, rng.float() * 0.5);
      g.fillRect(0, y, LOGICAL_WIDTH, rng.int(1, 5));
    }
    for (let i = 0; i < 34; i++) {
      g.fillStyle(PALETTE.ember, 0.06 + rng.float() * 0.12);
      g.fillCircle(rng.int(0, LOGICAL_WIDTH), rng.int(0, LOGICAL_HEIGHT), rng.int(1, 3));
    }
  }

  /* -------------------------------------------------------------- title */

  private showTitle(): void {
    this.step = 'title';
    this.layer.removeAll(true);

    const title = this.add
      .text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT * 0.26, 'SOJUTSU\nSPIRITS', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '46px',
        color: '#f2ede2',
        align: 'center',
        stroke: '#0a1018',
        strokeThickness: 6,
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    const tag = this.add
      .text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT * 0.38, 'a drop isn\'t a fail. it\'s a turn.', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        color: '#9aa3b0',
      })
      .setOrigin(0.5);

    this.layer.add([title, tag]);

    const buttons: Array<[string, () => void]> = [];
    if (hasSave()) {
      buttons.push(['CONTINUE', () => this.continueGame()]);
      buttons.push(['NEW ROAD', () => this.confirmNew()]);
    } else {
      buttons.push(['BEGIN', () => this.startNew()]);
    }

    const missing = (this.registry.get('missingAssets') as string[] | undefined) ?? [];
    if (missing.length > 0) {
      const warn = this.add
        .text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 26, `art pending: ${missing.join(', ')}`, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '10px',
          color: '#6d7684',
        })
        .setOrigin(0.5);
      this.layer.add(warn);
    }

    buttons.forEach(([label, fn], i) => {
      this.addButton(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT * 0.56 + i * 78, label, fn);
    });
  }

  private addButton(cx: number, cy: number, label: string, onPress: () => void): void {
    const w = LOGICAL_WIDTH * 0.62;
    const h = 58;
    const g = this.add.graphics();
    drawKey(g, cx - w / 2, cy - h / 2, w, h, 12);
    const t = this.add
      .text(cx, cy, label, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '18px',
        color: '#1b2340',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const zone = this.add.zone(cx, cy, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', onPress);
    this.layer.add([g, t, zone]);
  }

  /* -------------------------------------------------------- new / resume */

  private continueGame(): void {
    const loaded = load();
    if (!loaded) {
      this.startNew();
      return;
    }
    this.state = loaded;
    this.registry.set('state', this.state);
    this.enterWorld();
  }

  private confirmNew(): void {
    this.layer.removeAll(true);
    const warn = this.add
      .text(
        LOGICAL_WIDTH / 2,
        LOGICAL_HEIGHT * 0.4,
        'A new road erases the old one.\nThe Bureau keeps no second copy.',
        {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '15px',
          color: '#f2ede2',
          align: 'center',
          lineSpacing: 8,
        },
      )
      .setOrigin(0.5);
    this.layer.add(warn);
    this.addButton(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT * 0.56, 'ERASE AND BEGIN', () => {
      clearSave();
      this.startNew();
    });
    this.addButton(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT * 0.56 + 78, 'KEEP IT', () => this.showTitle());
  }

  private startNew(): void {
    this.state = newGame();
    this.registry.set('state', this.state);
    this.showStarterChoice();
  }

  /* ------------------------------------------------------------ starters */

  private showStarterChoice(): void {
    this.step = 'starter';
    this.layer.removeAll(true);

    const head = this.add
      .text(
        LOGICAL_WIDTH / 2,
        70,
        'THREE ARE AWAKE.\nONLY ONE WILL WALK WITH YOU.',
        {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '15px',
          color: '#f2ede2',
          align: 'center',
          lineSpacing: 7,
        },
      )
      .setOrigin(0.5, 0);
    this.layer.add(head);

    const cardH = 230;
    const top = 160;

    STARTERS.forEach((id, i) => {
      const s = species(id);
      const y = top + i * (cardH + 14);
      const g = this.add.graphics();
      drawPanel(g, 26, y, LOGICAL_WIDTH - 52, cardH, 12);
      this.layer.add(g);

      const frame = `dex/${String(s.dexNo).padStart(3, '0')}-${s.id}`;
      if (this.textures.exists('dex') && this.textures.get('dex').has(frame)) {
        const img = this.add.image(96, y + cardH / 2, 'dex', frame).setDisplaySize(112, 112);
        this.layer.add(img);
      } else {
        const ph = this.add.graphics();
        ph.fillStyle(PALETTE.accentDim, 0.5);
        ph.fillRoundedRect(40, y + cardH / 2 - 56, 112, 112, 8);
        this.layer.add(ph);
      }

      const name = this.add
        .text(170, y + 28, s.name.toUpperCase(), {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '22px',
          color: '#f2ede2',
        })
        .setOrigin(0, 0);

      const aspect = this.add
        .text(170, y + 62, s.aspects.join(' / '), {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '13px',
          color: '#74d8f0',
        })
        .setOrigin(0, 0);

      const blurb = this.add
        .text(170, y + 92, STARTER_BLURB[id] ?? s.blurb, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '12px',
          color: '#9aa3b0',
          wordWrap: { width: LOGICAL_WIDTH - 210 },
          lineSpacing: 4,
        })
        .setOrigin(0, 0);

      const pick = this.add
        .text(170, y + cardH - 44, '▶  BIND THIS ONE', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '14px',
          color: '#2fc6b0',
        })
        .setOrigin(0, 0);

      const zone = this.add
        .zone(LOGICAL_WIDTH / 2, y + cardH / 2, LOGICAL_WIDTH - 52, cardH)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.chooseStarter(id));

      this.layer.add([name, aspect, blurb, pick, zone]);
    });
  }

  private chooseStarter(id: string): void {
    const rng = new Rng(`starter:${id}:${Date.now()}`);
    giveStarter(this.state, id, rng);
    this.state.flags.licensed = true;
    save(this.state);

    this.layer.removeAll(true);
    const s = species(id);
    const msg = this.add
      .text(
        LOGICAL_WIDTH / 2,
        LOGICAL_HEIGHT * 0.42,
        `${s.name.toUpperCase()} is bound.\n\nThe Bureau licenses anyone\nwho can hold a chain.`,
        {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '17px',
          color: '#f2ede2',
          align: 'center',
          lineSpacing: 9,
        },
      )
      .setOrigin(0.5);
    this.layer.add(msg);
    this.time.delayedCall(2200, () => this.enterWorld());
  }

  private enterWorld(): void {
    this.cameras.main.fadeOut(320, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('World', { state: this.state });
    });
  }

  /** Exposed for the smoke harness so it can skip straight past the title. */
  getStep(): string {
    return this.step;
  }
}
