/**
 * Boot: loads the generated atlases, then hands off to the title.
 *
 * Every atlas is optional at load time. The asset pipeline is a separate, re-runnable step, and
 * a missing atlas must degrade to a visible placeholder rather than a black screen — a build
 * that cannot start is worth less than a build that starts ugly and tells you why.
 */
import Phaser from 'phaser';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, PALETTE } from '../layout.ts';

export interface AssetManifest {
  atlases: Array<{ key: string; image: string; data: string; frames: string[] }>;
  generatedAt?: string;
}

/** Atlases the game expects. Anything missing is replaced by a generated placeholder. */
const ATLASES = ['dex', 'spirits', 'player', 'companion', 'tiles', 'ui'] as const;

export class BootScene extends Phaser.Scene {
  private missing: string[] = [];

  constructor() {
    super('Boot');
  }

  preload(): void {
    this.drawLoadingCard();

    this.load.setPath('assets/generated/');
    for (const key of ATLASES) {
      this.load.atlas(key, `${key}.png`, `${key}.json`);
    }
    this.load.json('assetManifest', 'manifest.json');

    // A missing atlas is expected before `npm run assets` has ever run.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      if (!this.missing.includes(file.key)) this.missing.push(file.key);
    });
  }

  create(): void {
    this.makePlaceholders();
    if (this.missing.length > 0) {
      console.warn(
        `[sojutsu] missing asset(s): ${this.missing.join(', ')} — run "npm run assets". ` +
          'Placeholders are in use.',
      );
    }
    this.registry.set('missingAssets', this.missing);
    this.scene.start('Title');
  }

  private drawLoadingCard(): void {
    const g = this.add.graphics();
    g.fillStyle(PALETTE.deckDarkEdge, 1);
    g.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const label = this.add
      .text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 - 30, 'COUNTING…', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '16px',
        color: '#9aa3b0',
      })
      .setOrigin(0.5);
    label.setLetterSpacing?.(4);

    const barW = LOGICAL_WIDTH * 0.5;
    const barX = (LOGICAL_WIDTH - barW) / 2;
    const barY = LOGICAL_HEIGHT / 2 + 8;
    const bar = this.add.graphics();

    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => {
      bar.clear();
      bar.fillStyle(PALETTE.chainTrack, 1);
      bar.fillRect(barX, barY, barW, 4);
      bar.fillStyle(PALETTE.accent, 1);
      bar.fillRect(barX, barY, barW * p, 4);
    });
  }

  /**
   * Generates stand-in textures for anything that failed to load.
   *
   * They are deliberately ugly — magenta-on-charcoal chequers with the key written on them —
   * so a missing asset is impossible to mistake for finished art in a screenshot.
   */
  private makePlaceholders(): void {
    for (const key of ATLASES) {
      if (this.textures.exists(key)) continue;
      const size = 64;
      const tex = this.textures.createCanvas(`${key}`, size, size);
      const ctx = tex?.getContext();
      if (!ctx || !tex) continue;
      ctx.fillStyle = '#20242e';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#c0399f';
      for (let y = 0; y < size; y += 16) {
        for (let x = 0; x < size; x += 16) {
          if (((x + y) / 16) % 2 === 0) ctx.fillRect(x, y, 16, 16);
        }
      }
      ctx.fillStyle = '#ffffff';
      ctx.font = '9px monospace';
      ctx.fillText(key.slice(0, 8), 3, size - 5);
      tex.refresh();
    }
  }
}
