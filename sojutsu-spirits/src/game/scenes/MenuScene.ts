/**
 * The backpack: party, Monsterdex, bag, and the report card.
 *
 * The report card is the part that matters and it is deliberately not hidden in a settings
 * menu. This is a game about arithmetic; the player is owed a plain statement of which
 * arithmetic they are actually good at, drawn from every question they have answered.
 */
import Phaser from 'phaser';
import { DEPTH, LOGICAL_HEIGHT, LOGICAL_WIDTH, PALETTE } from '../layout.ts';
import { drawBar, drawKey, drawPanel, hpColour } from '../../ui/widgets.ts';
import { SPECIES, species } from '../../core/dex.ts';
import { xpProgress } from '../../core/progression.ts';
import { statusLabel } from '../../core/status.ts';
import { maxHpOf, save, type GameState } from '../state.ts';
import type { WorldScene } from './WorldScene.ts';

type Tab = 'party' | 'dex' | 'bag' | 'report';

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'party', label: 'CIRCLE' },
  { key: 'dex', label: 'DEX' },
  { key: 'bag', label: 'BAG' },
  { key: 'report', label: 'RECORD' },
];

export class MenuScene extends Phaser.Scene {
  private state!: GameState;
  private tab: Tab = 'party';
  private gfx!: Phaser.GameObjects.Graphics;
  private layer!: Phaser.GameObjects.Container;
  private dexPage = 0;

  constructor() {
    super('Menu');
  }

  init(data: { state: GameState }): void {
    this.state = data.state;
  }

  create(): void {
    this.gfx = this.add.graphics().setScrollFactor(0).setDepth(DEPTH.overlay);
    this.layer = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.overlay + 1);
    this.render();
  }

  private render(): void {
    const g = this.gfx;
    g.clear();
    this.layer.removeAll(true);

    g.fillStyle(PALETTE.deckDarkEdge, 0.97);
    g.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    this.renderTabs();

    switch (this.tab) {
      case 'party':
        this.renderParty();
        break;
      case 'dex':
        this.renderDex();
        break;
      case 'bag':
        this.renderBag();
        break;
      case 'report':
        this.renderReport();
        break;
    }

    this.renderCloseButton();
  }

  private renderTabs(): void {
    const w = LOGICAL_WIDTH / TABS.length;
    TABS.forEach((t, i) => {
      const active = t.key === this.tab;
      const g = this.add.graphics().setScrollFactor(0);
      g.fillStyle(active ? PALETTE.accentDim : PALETTE.panel, 1);
      g.fillRect(i * w, 0, w, 52);
      g.lineStyle(1, PALETTE.panelEdgeDim, 0.8);
      g.strokeRect(i * w, 0, w, 52);

      const label = this.add
        .text(i * w + w / 2, 26, t.label, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '13px',
          color: active ? '#f2ede2' : '#9aa3b0',
        })
        .setOrigin(0.5)
        .setScrollFactor(0);

      const zone = this.add
        .zone(i * w + w / 2, 26, w, 52)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        this.tab = t.key;
        this.render();
      });
      this.layer.add([g, label, zone]);
    });
  }

  /* -------------------------------------------------------------- party */

  private renderParty(): void {
    if (this.state.party.length === 0) {
      this.note('The Bound Circle is empty.');
      return;
    }

    const cardH = 104;
    this.state.party.forEach((inst, i) => {
      const s = species(inst.species);
      const y = 70 + i * (cardH + 10);
      const g = this.add.graphics().setScrollFactor(0);
      drawPanel(g, 16, y, LOGICAL_WIDTH - 32, cardH, 10);

      const frame = `dex/${String(s.dexNo).padStart(3, '0')}-${s.id}`;
      if (this.textures.exists('dex') && this.textures.get('dex').has(frame)) {
        const img = this.add
          .image(66, y + cardH / 2, 'dex', frame)
          .setDisplaySize(72, 72)
          .setScrollFactor(0);
        this.layer.add(img);
      }

      const maxHp = maxHpOf(inst);
      const ratio = inst.currentHp / Math.max(1, maxHp);
      const status = statusLabel(inst.status);

      const name = this.add
        .text(116, y + 16, `${(inst.nickname ?? s.name).toUpperCase()}  Lv ${inst.level}${status ? `  ${status}` : ''}`, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '15px',
          color: '#f2ede2',
        })
        .setScrollFactor(0);

      const aspects = this.add
        .text(116, y + 38, s.aspects.join(' / '), {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '11px',
          color: '#74d8f0',
        })
        .setScrollFactor(0);

      drawBar(g, 116, y + 58, 200, 12, ratio, hpColour(ratio), PALETTE.hpTrack);
      const xp = xpProgress(s.growth, inst.xp);
      drawBar(g, 116, y + 74, 200, 7, xp.ratio, PALETTE.chain, PALETTE.chainTrack);

      const hpText = this.add
        .text(324, y + 58, `${inst.currentHp}/${maxHp}`, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '12px',
          color: '#f2ede2',
        })
        .setScrollFactor(0);

      this.layer.add([g, name, aspects, hpText]);
    });
  }

  /* ---------------------------------------------------------------- dex */

  private renderDex(): void {
    const perPage = 36;
    const pages = Math.ceil(SPECIES.length / perPage);
    this.dexPage = Phaser.Math.Clamp(this.dexPage, 0, pages - 1);
    const start = this.dexPage * perPage;
    const slice = SPECIES.slice(start, start + perPage);

    const seen = new Set(this.state.dexSeen);
    const bound = new Set(this.state.dexBound);

    const header = this.add
      .text(LOGICAL_WIDTH / 2, 66, `MONSTERDEX  ${bound.size} bound  ·  ${seen.size} seen  ·  ${SPECIES.length} known to exist`, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '11px',
        color: '#9aa3b0',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.layer.add(header);

    const cols = 6;
    const cell = (LOGICAL_WIDTH - 32) / cols;
    slice.forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 16 + col * cell;
      const y = 92 + row * (cell + 14);

      const g = this.add.graphics().setScrollFactor(0);
      const known = seen.has(s.id);
      g.fillStyle(bound.has(s.id) ? PALETTE.accentDim : PALETTE.panel, known ? 0.9 : 0.4);
      g.fillRoundedRect(x + 2, y, cell - 6, cell - 6, 6);
      this.layer.add(g);

      const frame = `dex/${String(s.dexNo).padStart(3, '0')}-${s.id}`;
      if (known && this.textures.exists('dex') && this.textures.get('dex').has(frame)) {
        const img = this.add
          .image(x + cell / 2 - 1, y + (cell - 6) / 2, 'dex', frame)
          .setDisplaySize(cell - 16, cell - 16)
          .setScrollFactor(0);
        this.layer.add(img);
      }

      const label = this.add
        .text(x + cell / 2 - 1, y + cell - 4, known ? s.name.slice(0, 8) : '???', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '8px',
          color: known ? '#f2ede2' : '#5a6472',
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0);
      this.layer.add(label);
    });

    if (pages > 1) {
      this.pageButton(60, LOGICAL_HEIGHT - 130, '◀', () => {
        this.dexPage -= 1;
        this.render();
      });
      this.pageButton(LOGICAL_WIDTH - 60, LOGICAL_HEIGHT - 130, '▶', () => {
        this.dexPage += 1;
        this.render();
      });
      const p = this.add
        .text(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 130, `${this.dexPage + 1} / ${pages}`, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '12px',
          color: '#9aa3b0',
        })
        .setOrigin(0.5)
        .setScrollFactor(0);
      this.layer.add(p);
    }
  }

  private pageButton(cx: number, cy: number, label: string, fn: () => void): void {
    const g = this.add.graphics().setScrollFactor(0);
    drawKey(g, cx - 32, cy - 18, 64, 36, 8);
    const t = this.add
      .text(cx, cy, label, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '16px',
        color: '#1b2340',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    const z = this.add.zone(cx, cy, 64, 36).setScrollFactor(0).setInteractive({ useHandCursor: true });
    z.on('pointerdown', fn);
    this.layer.add([g, t, z]);
  }

  /* ---------------------------------------------------------------- bag */

  private renderBag(): void {
    const rows: Array<[string, number]> = [
      ['Binding Talisman', this.state.bag.talismans.basic],
      ['Great Talisman', this.state.bag.talismans.great],
      ['Ultra Talisman', this.state.bag.talismans.ultra],
      ['Salve', this.state.bag.salve],
      ['Balm', this.state.bag.balm],
      ['Antidote', this.state.bag.antidote],
    ];

    const money = this.add
      .text(LOGICAL_WIDTH / 2, 70, `RM ${this.state.money}`, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '20px',
        color: '#f2ede2',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.layer.add(money);

    rows.forEach(([label, count], i) => {
      const y = 120 + i * 48;
      const g = this.add.graphics().setScrollFactor(0);
      drawPanel(g, 20, y, LOGICAL_WIDTH - 40, 40, 8);
      const t = this.add
        .text(38, y + 20, label, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '14px',
          color: count > 0 ? '#f2ede2' : '#5a6472',
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0);
      const c = this.add
        .text(LOGICAL_WIDTH - 38, y + 20, `× ${count}`, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '14px',
          color: count > 0 ? '#f2ede2' : '#5a6472',
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0);
      this.layer.add([g, t, c]);
    });
  }

  /* ------------------------------------------------------------- record */

  /**
   * The report card.
   *
   * Every question the player has answered is tallied by kind, so this screen can say exactly
   * which arithmetic is costing them chains. That is the whole educational contract of the game
   * made legible, and it is why `kindStats` is part of the save file rather than telemetry.
   */
  private renderReport(): void {
    const f = this.state.flags;
    const accuracy = f.questionsPosed > 0 ? (f.questionsSolved / f.questionsPosed) * 100 : 0;

    const head = this.add
      .text(
        LOGICAL_WIDTH / 2,
        72,
        `${f.questionsSolved} of ${f.questionsPosed} solved   ·   ${accuracy.toFixed(0)}%`,
        {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '16px',
          color: '#f2ede2',
        },
      )
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    const best = this.add
      .text(LOGICAL_WIDTH / 2, 100, `Longest chain held: ${f.bestChainEver}`, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        color: '#34b8dc',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    const sigils = this.add
      .text(LOGICAL_WIDTH / 2, 124, `Sigils: ${f.sigils.length > 0 ? f.sigils.join(' · ') : 'none yet'}`, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        color: '#b08a4a',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    this.layer.add([head, best, sigils]);

    const entries = Object.entries(f.kindStats)
      .filter(([, v]) => v.posed > 0)
      .sort((a, b) => a[1].solved / a[1].posed - b[1].solved / b[1].posed);

    if (entries.length === 0) {
      this.note('No questions answered yet. Go and drop a few.', 190);
      return;
    }

    const weakest = entries[0];
    if (weakest && weakest[1].posed >= 4) {
      const advice = this.add
        .text(
          LOGICAL_WIDTH / 2,
          156,
          `Weakest: ${prettyKind(weakest[0])} — ${Math.round((weakest[1].solved / weakest[1].posed) * 100)}%`,
          {
            fontFamily: 'ui-monospace, monospace',
            fontSize: '12px',
            color: '#e8c23a',
          },
        )
        .setOrigin(0.5, 0)
        .setScrollFactor(0);
      this.layer.add(advice);
    }

    entries.slice(0, 12).forEach(([kind, v], i) => {
      const y = 190 + i * 34;
      const ratio = v.solved / v.posed;
      const g = this.add.graphics().setScrollFactor(0);
      const t = this.add
        .text(24, y, prettyKind(kind), {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '11px',
          color: '#f2ede2',
        })
        .setScrollFactor(0);
      drawBar(g, 24, y + 16, LOGICAL_WIDTH - 110, 9, ratio, hpColour(ratio), PALETTE.hpTrack);
      const pct = this.add
        .text(LOGICAL_WIDTH - 24, y + 8, `${v.solved}/${v.posed}`, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '11px',
          color: '#9aa3b0',
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0);
      this.layer.add([g, t, pct]);
    });
  }

  /* --------------------------------------------------------------- misc */

  private note(text: string, y = 200): void {
    const t = this.add
      .text(LOGICAL_WIDTH / 2, y, text, {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        color: '#9aa3b0',
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.layer.add(t);
  }

  private renderCloseButton(): void {
    const h = 52;
    const y = LOGICAL_HEIGHT - h - 24;
    const g = this.add.graphics().setScrollFactor(0);
    drawKey(g, 40, y, LOGICAL_WIDTH - 80, h, 12, { accent: true });
    const t = this.add
      .text(LOGICAL_WIDTH / 2, y + h / 2, 'BACK TO THE ROAD', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '15px',
        color: '#1b2340',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    const z = this.add
      .zone(LOGICAL_WIDTH / 2, y + h / 2, LOGICAL_WIDTH - 80, h)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    z.on('pointerdown', () => this.close());
    this.layer.add([g, t, z]);
  }

  private close(): void {
    save(this.state);
    (this.scene.get('World') as unknown as WorldScene).resume();
    this.scene.stop();
  }
}

/** "times-table" → "Times table". */
function prettyKind(kind: string): string {
  const s = kind.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
