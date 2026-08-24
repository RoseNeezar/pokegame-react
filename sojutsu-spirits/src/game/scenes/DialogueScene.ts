/**
 * Dialogue, shops, healing, waystone puzzles and shrine hand-offs.
 *
 * One overlay handles all of them because from the player's side they are the same gesture:
 * press the action button near something, read, choose, close. Keeping them in one scene means
 * one input model and one visual language.
 *
 * The waystone puzzle is the game's arithmetic outside combat. It draws from the same
 * curriculum as a battle question but has no timer — the manga's waystones are read at leisure,
 * and the pressure of the timer belongs to the fight.
 */
import Phaser from 'phaser';
import { DECK_HEIGHT, DECK_TOP, DEPTH, LOGICAL_WIDTH, WORLD_HEIGHT } from '../layout.ts';
import { drawKey, drawPanel } from '../../ui/widgets.ts';
import { scriptFor, type Script, type ScriptNode } from '../story/scripts.ts';
import { ZONES } from '../world/zones.ts';
import { generateQuestion, type Question } from '../../math/question.ts';
import { Rng } from '../../core/rng.ts';
import { healParty, recordAnswer, save, segmentCeiling, type GameState } from '../state.ts';
import type { WorldScene } from './WorldScene.ts';
import type { TalismanKind } from '../../core/types.ts';

interface DialogueInit {
  state: GameState;
  script: string;
  speaker: string;
  waystone?: { id: string; tier: 1 | 2 | 3 };
}

/** Prices are round numbers on purpose: the shop board is meant to be read, not decoded. */
const SHOP_STOCK: ReadonlyArray<{ key: string; label: string; price: number }> = [
  { key: 'basic', label: 'Binding Talisman', price: 200 },
  { key: 'great', label: 'Great Talisman', price: 600 },
  { key: 'salve', label: 'Salve  ·  restores 40 HP', price: 300 },
  { key: 'antidote', label: 'Antidote  ·  clears poison', price: 150 },
];

export class DialogueScene extends Phaser.Scene {
  private state!: GameState;
  private script!: Script;
  private nodeKey = 'start';
  private lineIndex = 0;
  private init_!: DialogueInit;

  private gfx!: Phaser.GameObjects.Graphics;
  private layer!: Phaser.GameObjects.Container;
  private nameText!: Phaser.GameObjects.Text;
  private bodyText!: Phaser.GameObjects.Text;
  private mode: 'lines' | 'choices' | 'shop' | 'waystone' | 'done' = 'lines';

  private question: Question | null = null;
  private entry = '';

  constructor() {
    super('Dialogue');
  }

  init(data: DialogueInit): void {
    this.init_ = data;
    this.state = data.state;
  }

  create(): void {
    const s = scriptFor(this.init_.script);
    if (!s) {
      this.close();
      return;
    }
    this.script = s;
    this.nodeKey = this.pickOpeningNode();
    this.lineIndex = 0;

    this.gfx = this.add.graphics().setScrollFactor(0).setDepth(DEPTH.dialogue);
    this.layer = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.dialogue + 1);

    this.nameText = this.add
      .text(34, DECK_TOP + 18, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '15px',
        color: '#74d8f0',
      })
      .setScrollFactor(0)
      .setDepth(DEPTH.dialogue + 2);

    this.bodyText = this.add
      .text(34, DECK_TOP + 46, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '15px',
        color: '#f2ede2',
        wordWrap: { width: LOGICAL_WIDTH - 68 },
        lineSpacing: 7,
      })
      .setScrollFactor(0)
      .setDepth(DEPTH.dialogue + 2);

    // Anywhere on the panel advances; choices and keypads capture their own taps first.
    const advance = this.add
      .zone(LOGICAL_WIDTH / 2, DECK_TOP + DECK_HEIGHT / 2, LOGICAL_WIDTH, DECK_HEIGHT)
      .setScrollFactor(0)
      .setInteractive();
    advance.on('pointerdown', () => this.onTap());

    this.render();
  }

  /**
   * Shrine keepers have a different opening once you already hold their sigil, so the
   * post-battle beat plays exactly once and the keeper never repeats the challenge.
   */
  private pickOpeningNode(): string {
    const shrineSigil = /shrine-(\d)/.exec(this.init_.script)?.[1];
    if (shrineSigil && this.script['after']) {
      const n = Number(shrineSigil);
      if (this.state.flags.sigils.includes(n)) {
        const seen = `shrine-${n}-after`;
        if (!this.state.flags.seenScenes.includes(seen)) {
          this.state.flags.seenScenes.push(seen);
          return 'after';
        }
        return 'after';
      }
    }
    return 'start';
  }

  private get node(): ScriptNode {
    return this.script[this.nodeKey] ?? { lines: [], action: 'close' };
  }

  /* ------------------------------------------------------------- render */

  private render(): void {
    const g = this.gfx;
    g.clear();
    // The dialogue panel takes the deck, not the world — you keep looking at the scene.
    g.fillStyle(0x000000, 0.35);
    g.fillRect(0, 0, LOGICAL_WIDTH, WORLD_HEIGHT);
    drawPanel(g, 12, DECK_TOP + 6, LOGICAL_WIDTH - 24, DECK_HEIGHT - 18, 12);

    this.layer.removeAll(true);

    switch (this.mode) {
      case 'shop':
        this.renderShop();
        return;
      case 'waystone':
        this.renderWaystone();
        return;
      default:
        break;
    }

    const line = this.node.lines[this.lineIndex];
    if (line) {
      line.effect?.(this.state);
      this.nameText.setText(line.who.toUpperCase());
      this.bodyText.setText(line.text);
    }

    const isLast = this.lineIndex >= this.node.lines.length - 1;
    if (isLast && this.node.choices && this.node.choices.length > 0) {
      this.mode = 'choices';
      this.renderChoices();
    } else if (isLast) {
      const more = this.add
        .text(LOGICAL_WIDTH - 40, DECK_TOP + DECK_HEIGHT - 34, '▼', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '16px',
          color: '#2fc6b0',
        })
        .setScrollFactor(0);
      this.tweens.add({ targets: more, y: more.y + 5, duration: 520, yoyo: true, repeat: -1 });
      this.layer.add(more);
    }
  }

  private renderChoices(): void {
    const choices = (this.node.choices ?? []).filter((c) => !c.when || c.when(this.state));
    const h = 44;
    const top = DECK_TOP + DECK_HEIGHT - 18 - choices.length * (h + 8);

    choices.forEach((c, i) => {
      const y = top + i * (h + 8);
      const g = this.add.graphics().setScrollFactor(0);
      drawKey(g, 28, y, LOGICAL_WIDTH - 56, h, 10);
      const t = this.add
        .text(LOGICAL_WIDTH / 2, y + h / 2, c.label, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '14px',
          color: '#1b2340',
        })
        .setOrigin(0.5)
        .setScrollFactor(0);
      const zone = this.add
        .zone(LOGICAL_WIDTH / 2, y + h / 2, LOGICAL_WIDTH - 56, h)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        this.nodeKey = c.goto;
        this.lineIndex = 0;
        this.mode = 'lines';
        this.render();
      });
      this.layer.add([g, t, zone]);
    });
  }

  /* --------------------------------------------------------------- shop */

  private renderShop(): void {
    this.nameText.setText('PROVISIONER');
    this.bodyText.setText(`RM ${this.state.money}`);

    const h = 40;
    const top = DECK_TOP + 78;
    SHOP_STOCK.forEach((item, i) => {
      const y = top + i * (h + 6);
      const affordable = this.state.money >= item.price;
      const g = this.add.graphics().setScrollFactor(0);
      drawKey(g, 28, y, LOGICAL_WIDTH - 56, h, 8, { muted: !affordable });
      const t = this.add
        .text(42, y + h / 2, `${item.label}`, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '13px',
          color: affordable ? '#1b2340' : '#8d8b85',
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0);
      const p = this.add
        .text(LOGICAL_WIDTH - 42, y + h / 2, `RM ${item.price}`, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '13px',
          color: affordable ? '#1b2340' : '#8d8b85',
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0);
      this.layer.add([g, t, p]);

      if (affordable) {
        const zone = this.add
          .zone(LOGICAL_WIDTH / 2, y + h / 2, LOGICAL_WIDTH - 56, h)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => this.buy(item));
        this.layer.add(zone);
      }
    });

    this.addCloseButton();
  }

  private buy(item: (typeof SHOP_STOCK)[number]): void {
    if (this.state.money < item.price) return;
    this.state.money -= item.price;
    switch (item.key) {
      case 'basic':
      case 'great':
      case 'ultra':
        this.state.bag.talismans[item.key as TalismanKind] += 1;
        break;
      case 'salve':
        this.state.bag.salve += 1;
        break;
      case 'antidote':
        this.state.bag.antidote += 1;
        break;
    }
    save(this.state);
    this.render();
  }

  /* ----------------------------------------------------------- waystone */

  /**
   * A waystone puzzle: one question from the curriculum, no timer, and it stays until solved.
   *
   * The manga's waystones are sequence markers with a missing number — "2, 4, 6, □". Getting one
   * wrong costs nothing but another read, which is the point: outside a fight, arithmetic is
   * allowed to be slow.
   */
  private renderWaystone(): void {
    const ws = this.init_.waystone;
    if (!ws) {
      this.close();
      return;
    }
    if (!this.question) {
      this.question = generateQuestion({
        tier: ws.tier,
        segmentCeiling: segmentCeiling(this.state),
        rng: new Rng(`waystone:${ws.id}`),
      });
    }

    this.nameText.setText('WAYSTONE');
    this.bodyText.setText(`${this.question.prompt}\n\n${this.entry.length > 0 ? this.entry : '_'}`);

    // A compact 3×4 pad, the same grammar as the battle keypad.
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
    const cols = 3;
    const kw = (LOGICAL_WIDTH - 56 - 16) / cols;
    const kh = 34;
    const top = DECK_TOP + 108;

    keys.forEach((label, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 28 + col * (kw + 8);
      const y = top + row * (kh + 6);
      const g = this.add.graphics().setScrollFactor(0);
      drawKey(g, x, y, kw, kh, 8, { accent: label === 'OK', muted: label === '⌫' });
      const t = this.add
        .text(x + kw / 2, y + kh / 2, label, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '16px',
          color: '#1b2340',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setScrollFactor(0);
      const zone = this.add
        .zone(x + kw / 2, y + kh / 2, kw, kh)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this.waystoneKey(label));
      this.layer.add([g, t, zone]);
    });
  }

  private waystoneKey(label: string): void {
    if (label === '⌫') {
      this.entry = this.entry.slice(0, -1);
      this.render();
      return;
    }
    if (label === 'OK') {
      this.checkWaystone();
      return;
    }
    if (this.entry.length < 5) this.entry += label;
    this.render();
  }

  private checkWaystone(): void {
    const ws = this.init_.waystone;
    if (!ws || !this.question) return;
    const correct = Number(this.entry) === this.question.answer;
    recordAnswer(this.state, this.question.kind, correct);

    if (!correct) {
      this.entry = '';
      this.mode = 'lines';
      this.script = {
        start: {
          lines: [
            { who: 'Waystone', text: `Not that. ${this.question.explain}` },
            { who: 'Waystone', text: 'Read it again. Nothing here is in a hurry.' },
          ],
          action: 'waystone',
        },
      };
      this.nodeKey = 'start';
      this.lineIndex = 0;
      this.render();
      return;
    }

    this.state.flags.waystonesSolved.push(ws.id);
    this.grantWaystoneReward(ws.id);
    save(this.state);

    this.mode = 'lines';
    this.script = {
      start: {
        lines: [
          { who: 'Waystone', text: 'The marks warm and settle. The stone is lit.' },
          { who: 'Waystone', text: 'The road counts itself from here.' },
        ],
        action: 'close',
      },
    };
    this.nodeKey = 'start';
    this.lineIndex = 0;
    this.render();
  }

  /** Pays out whatever `zones.ts` declared for this waystone. */
  private grantWaystoneReward(id: string): void {
    const declared = ZONES.flatMap((z) => z.waystones).find((w) => w.id === id);
    switch (declared?.reward) {
      case 'salve':
        this.state.bag.salve += 2;
        break;
      case 'money':
        this.state.money += 400;
        break;
      case 'passage':
        // The reward is the road opening; solving it is already recorded.
        break;
      case 'talisman':
      default:
        this.state.bag.talismans.basic += 2;
        break;
    }
  }

  /* -------------------------------------------------------------- input */

  private onTap(): void {
    if (this.mode === 'choices' || this.mode === 'shop' || this.mode === 'waystone') return;

    if (this.lineIndex < this.node.lines.length - 1) {
      this.lineIndex += 1;
      this.render();
      return;
    }

    const node = this.node;
    if (node.next) {
      this.nodeKey = node.next;
      this.lineIndex = 0;
      this.render();
      return;
    }

    switch (node.action) {
      case 'heal':
        healParty(this.state);
        save(this.state);
        this.close();
        return;
      case 'shop':
        this.mode = 'shop';
        this.render();
        return;
      case 'waystone':
        this.mode = 'waystone';
        this.entry = '';
        this.render();
        return;
      case 'shrine-battle':
        this.closeThen(() => (this.scene.get('World') as unknown as WorldScene).startShrineBattle());
        return;
      default:
        this.close();
    }
  }

  private addCloseButton(): void {
    const h = 34;
    const y = DECK_TOP + DECK_HEIGHT - h - 16;
    const g = this.add.graphics().setScrollFactor(0);
    drawKey(g, 28, y, LOGICAL_WIDTH - 56, h, 8, { accent: true });
    const t = this.add
      .text(LOGICAL_WIDTH / 2, y + h / 2, 'DONE', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '14px',
        color: '#1b2340',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    const zone = this.add
      .zone(LOGICAL_WIDTH / 2, y + h / 2, LOGICAL_WIDTH - 56, h)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => this.close());
    this.layer.add([g, t, zone]);
  }

  private closeThen(fn: () => void): void {
    this.scene.stop();
    fn();
  }

  private close(): void {
    const world = this.scene.get('World') as unknown as WorldScene;
    world.resume();
    this.scene.stop();
  }
}
