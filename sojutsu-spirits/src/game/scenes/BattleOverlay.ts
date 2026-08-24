/**
 * Battle and Finish — an overlay on the world, never a separate place.
 *
 * The three mode references share one viewport and differ only in the deck, so combat runs as a
 * scene layered over `World`: the camera pushes in, the HUD panels fade in at the top corners,
 * and the deck morphs from joystick to keypad. When the foe faints the deck *reverts* to the
 * exploration controls and the action button becomes the spear — that is the Finish reference,
 * literally.
 *
 * All rules live in `src/core` and all arithmetic in `src/math`. This file draws things and
 * forwards input; it never decides damage, never decides what a drop costs, and never computes
 * a multiplier.
 */
import Phaser from 'phaser';
import {
  CAMERA,
  DECK_HEIGHT,
  DECK_TOP,
  DEPTH,
  HUD,
  LOGICAL_WIDTH,
  PALETTE,
  WORLD_HEIGHT,
  KEYPAD,
} from '../layout.ts';
import { drawBar, drawKey, drawPanel, hpColour } from '../../ui/widgets.ts';
import type { ControlDeck } from '../../ui/ControlDeck.ts';
import { Battle, type BattleKind } from '../../core/battle.ts';
import { dex, species } from '../../core/dex.ts';
import { computeStats } from '../../core/stats.ts';
import { statusLabel } from '../../core/status.ts';
import { Rng } from '../../core/rng.ts';
import type { SpiritInstance, TalismanKind } from '../../core/types.ts';
import { MathSession, toBattleCommand } from '../../math/session.ts';
import type { MathOutcome } from '../../math/session.ts';
import { CHAIN_CAP } from '../../math/chain.ts';
import type { GameState } from '../state.ts';
import {
  activeSpirit,
  addToParty,
  recordAnswer,
  recordBound,
  segmentCeiling,
  maxHpOf,
} from '../state.ts';
import type { WorldScene } from './WorldScene.ts';

type Phase = 'intro' | 'choosing' | 'question' | 'resolving' | 'finish' | 'closing';

interface BattleInit {
  state: GameState;
  foe: SpiritInstance;
  kind: BattleKind;
  worldPoint?: { x: number; y: number };
  shrine?: { keeper: string; sigil: number };
}

export class BattleOverlay extends Phaser.Scene {
  private state!: GameState;
  private battle!: Battle;
  private session!: MathSession;
  private deck!: ControlDeck;
  private world!: WorldScene;
  private init_!: BattleInit;

  private phase: Phase = 'intro';
  private hud!: Phaser.GameObjects.Graphics;
  private hudTexts: Phaser.GameObjects.Text[] = [];
  private allyPortrait: Phaser.GameObjects.Image | null = null;
  private foePortrait: Phaser.GameObjects.Image | null = null;

  private moveLayer!: Phaser.GameObjects.Container;
  private moveGfx!: Phaser.GameObjects.Graphics;
  private logText!: Phaser.GameObjects.Text;
  private bannerText!: Phaser.GameObjects.Text;

  private questionStartedAt = 0;
  private timeLimitMs = 0;
  private pendingSlot = 0;
  private lastLogLength = 0;

  constructor() {
    super('Battle');
  }

  init(data: BattleInit): void {
    this.init_ = data;
    this.state = data.state;
  }

  create(): void {
    this.world = this.scene.get('World') as unknown as WorldScene;
    this.deck = this.registry.get('deck') as ControlDeck;

    const ally = activeSpirit(this.state);
    if (!ally) {
      this.close();
      return;
    }

    const seed = `battle:${this.init_.foe.uid}:${Math.floor(this.state.playedMs)}`;
    this.battle = new Battle(dex, ally, this.init_.foe, {
      kind: this.init_.kind,
      seed,
      canFlee: this.init_.kind === 'wild',
      canBind: this.init_.kind === 'wild',
      sigilsOwned: this.state.flags.sigils.length,
    });
    this.session = new MathSession({ rng: new Rng(`${seed}:math`) });

    this.buildHud();
    this.buildDeckOverlay();
    this.pushCamera(CAMERA.battleZoom);
    this.wireDeck();

    this.banner(`A wild ${species(this.init_.foe.species).name.toUpperCase()} bars the way.`);
    this.time.delayedCall(700, () => this.enterChoosing());
  }

  /* ---------------------------------------------------------------- HUD */

  private buildHud(): void {
    this.hud = this.add.graphics().setScrollFactor(0).setDepth(DEPTH.worldUi);

    const ally = this.battle.state.ally;
    const foe = this.battle.state.foe;

    this.allyPortrait = this.makePortrait(ally.species.dexNo, ally.species.id, true);
    this.foePortrait = this.makePortrait(foe.species.dexNo, foe.species.id, false);

    this.logText = this.add
      .text(LOGICAL_WIDTH / 2, WORLD_HEIGHT - 14, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        color: '#f2ede2',
        backgroundColor: '#0a1018e0',
        padding: { x: 10, y: 6 },
        align: 'center',
        wordWrap: { width: LOGICAL_WIDTH - 48 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(DEPTH.worldUi + 2);

    this.bannerText = this.add
      .text(LOGICAL_WIDTH / 2, WORLD_HEIGHT * 0.42, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '22px',
        color: '#f2ede2',
        stroke: '#0a1018',
        strokeThickness: 5,
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay)
      .setAlpha(0);

    this.refreshHud();
  }

  /** Uses the dex atlas when the pipeline has produced it, and a coloured disc otherwise. */
  private makePortrait(dexNo: number, id: string, ally: boolean): Phaser.GameObjects.Image | null {
    const frame = `dex/${String(dexNo).padStart(3, '0')}-${id}`;
    const size = HUD.portrait;
    const x = ally ? HUD.panel.margin + size / 2 + 4 : LOGICAL_WIDTH - HUD.panel.margin - size / 2 - 4;
    const y = HUD.panel.margin + HUD.panel.h / 2;

    if (this.textures.exists('dex') && this.textures.get('dex').has(frame)) {
      return this.add
        .image(x, y, 'dex', frame)
        .setDisplaySize(size, size)
        .setScrollFactor(0)
        .setDepth(DEPTH.worldUi + 1);
    }
    return null;
  }

  private refreshHud(): void {
    const g = this.hud;
    g.clear();

    const ally = this.battle.state.ally;
    const foe = this.battle.state.foe;

    this.drawSide(g, ally, true);
    this.drawSide(g, foe, false);
  }

  private drawSide(g: Phaser.GameObjects.Graphics, f: typeof this.battle.state.ally, isAlly: boolean): void {
    const { w, h, margin } = HUD.panel;
    const x = isAlly ? margin : LOGICAL_WIDTH - margin - w;
    const y = margin;

    drawPanel(g, x, y, w, h, HUD.cornerRadius);

    const stats = computeStats(f.species.base, f.instance.grade, f.instance.resonance, f.instance.level);
    const ratio = f.instance.currentHp / Math.max(1, stats.maxHp);

    // Portrait sits on the outer edge in both panels — the reference mirrors them.
    const portraitX = isAlly ? x + 6 : x + w - HUD.portrait - 6;
    if (!this.textures.exists('dex') || !this.allyPortrait) {
      g.fillStyle(isAlly ? PALETTE.accentDim : PALETTE.danger, 0.5);
      g.fillRoundedRect(portraitX, y + (h - HUD.portrait) / 2, HUD.portrait, HUD.portrait, 6);
    }

    const barX = isAlly ? x + HUD.portrait + 14 : x + 12;
    const barW = HUD.hpBar.w;

    // Vertical rhythm, measured off the reference panel: name, then the HP figure on its own
    // line, then the two bars. Cramming the figure onto the name's line makes them collide on
    // a long species name, which is exactly what the reference avoids by stacking them.
    const hpBarY = y + h * 0.55;
    drawBar(g, barX, hpBarY, barW, HUD.hpBar.h, ratio, hpColour(ratio), PALETTE.hpTrack);

    // The Chain bar sits under HP, exactly as the reference stacks them. It is the ally's
    // chain: the foe does not do arithmetic, so its lower bar shows its stamina instead.
    const chainRatio = isAlly
      ? Math.min(1, this.battle.state.chain / CHAIN_CAP)
      : Math.min(1, f.instance.level / 40);
    drawBar(
      g,
      barX,
      hpBarY + HUD.hpBar.h + 4,
      barW,
      HUD.chainBar.h,
      chainRatio,
      isAlly ? PALETTE.chain : PALETTE.strokeDim,
      PALETTE.chainTrack,
    );

    this.syncHudText(f, isAlly, barX, y, h, stats.maxHp);
  }

  private syncHudText(
    f: typeof this.battle.state.ally,
    isAlly: boolean,
    barX: number,
    y: number,
    h: number,
    maxHp: number,
  ): void {
    const hpKey = isAlly ? 0 : 1;
    const nameKey = isAlly ? 2 : 3;
    const barW = HUD.hpBar.w;

    if (!this.hudTexts[nameKey]) {
      this.hudTexts[nameKey] = this.add
        .text(barX, y + 8, '', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '14px',
          color: '#f2ede2',
        })
        .setScrollFactor(0)
        .setDepth(DEPTH.worldUi + 1);
    }
    if (!this.hudTexts[hpKey]) {
      this.hudTexts[hpKey] = this.add
        .text(barX + barW, y + 28, '', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '13px',
          color: '#f2ede2',
        })
        .setOrigin(1, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH.worldUi + 1);
    }

    const status = statusLabel(f.status.kind);
    // Species names run to eleven characters; truncate rather than let the panel overflow.
    const name = f.species.name.toUpperCase();
    this.hudTexts[nameKey]!.setText(`${name}  ${f.instance.level}${status ? `  ${status}` : ''}`);
    this.hudTexts[hpKey]!.setText(`${f.instance.currentHp}/${maxHp}`);
  }

  /* ------------------------------------------------------- deck overlay */

  /**
   * The move list.
   *
   * The reference deck in combat shows only the equation strip and the keypad, so the move list
   * has to be a step *before* the question — pick the strike, then earn it. BACK returns here,
   * which is exactly what the reference's BACK button is for.
   */
  private buildDeckOverlay(): void {
    this.moveGfx = this.add.graphics().setScrollFactor(0).setDepth(DEPTH.deck + 4);
    this.moveLayer = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.deck + 5);
  }

  private enterChoosing(): void {
    this.phase = 'choosing';
    this.deck.setMode('math');
    this.deck.clearQuestion();
    this.deck.setTimer(1);
    this.drawMoveList();
  }

  private drawMoveList(): void {
    this.moveLayer.removeAll(true);
    const g = this.moveGfx;
    g.clear();

    // Cover the keypad with the move list while choosing.
    g.fillStyle(PALETTE.deckNavy, 1);
    g.fillRect(0, DECK_TOP, LOGICAL_WIDTH, DECK_HEIGHT);

    const label = this.add
      .text(LOGICAL_WIDTH / 2, DECK_TOP + 18, 'CHOOSE A STRIKE', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '14px',
        color: '#eadbc6',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);
    this.moveLayer.add(label);

    const slots = this.battle.state.ally.instance.moves;
    const cols = 2;
    const pad = 14;
    const bw = (LOGICAL_WIDTH - pad * (cols + 1)) / cols;
    const bh = 74;
    const top = DECK_TOP + 46;

    slots.forEach((slot, i) => {
      const move = dex.move(slot.move);
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * (bw + pad);
      const y = top + row * (bh + 12);
      const usable = slot.pp > 0;

      drawKey(g, x, y, bw, bh, 12, { muted: !usable });

      const name = this.add
        .text(x + 12, y + 12, move.name, {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '15px',
          color: usable ? '#1b2340' : '#7a7a72',
          fontStyle: 'bold',
        })
        .setScrollFactor(0);

      const detail = this.add
        .text(
          x + 12,
          y + 36,
          `${move.aspect} · ${move.category}${move.power ? ` · ${move.power}` : ''}\nT${move.engine.mathTier}  PP ${slot.pp}/${slot.maxPp}`,
          {
            fontFamily: 'ui-monospace, monospace',
            fontSize: '11px',
            color: usable ? '#4a5468' : '#8d8b85',
            lineSpacing: 2,
          },
        )
        .setScrollFactor(0);

      this.moveLayer.add([name, detail]);

      if (usable) {
        const zone = this.add
          .zone(x + bw / 2, y + bh / 2, bw, bh)
          .setScrollFactor(0)
          .setInteractive({ useHandCursor: true });
        zone.on('pointerdown', () => this.chooseMove(i));
        this.moveLayer.add(zone);
      }
    });

    // Flee / Bag row, only where the rules allow it.
    if (this.init_.kind === 'wild') {
      const y = top + 2 * (bh + 12);
      const bwf = (LOGICAL_WIDTH - pad * 3) / 2;
      drawKey(g, pad, y, bwf, 46, 10, { muted: true });
      const flee = this.add
        .text(pad + bwf / 2, y + 23, 'BREAK AWAY', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '13px',
          color: '#1b2340',
        })
        .setOrigin(0.5)
        .setScrollFactor(0);
      const fleeZone = this.add
        .zone(pad + bwf / 2, y + 23, bwf, 46)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      fleeZone.on('pointerdown', () => this.flee());
      this.moveLayer.add([flee, fleeZone]);
    }
  }

  private chooseMove(slot: number): void {
    this.pendingSlot = slot;
    const move = dex.move(this.battle.state.ally.instance.moves[slot]!.move);
    const start = this.session.start(move, segmentCeiling(this.state));

    this.moveLayer.removeAll(true);
    this.moveGfx.clear();

    if (start.autoResolve) {
      // radModifier 0 — no question is posed. You do not need arithmetic to blow yourself up.
      this.banner('NO TIME TO THINK');
      this.resolveOutcome(this.session.resolveAuto());
      return;
    }

    this.phase = 'question';
    this.timeLimitMs = start.timeLimitMs;
    this.questionStartedAt = this.time.now;
    this.deck.setMode('math');
    this.deck.showQuestion(start.question.prompt, String(start.question.answer).length);
    this.showVisual(start.question);
  }

  /** Draws a question's picture — a bar chart, an array of dots, a row of solids. */
  private visualLayer: Phaser.GameObjects.Container | null = null;

  private showVisual(question: { visual?: { kind: string; data: unknown }; choices?: number[] }): void {
    this.visualLayer?.destroy(true);
    this.visualLayer = null;
    if (!question.visual) return;

    const layer = this.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.worldUi + 3);
    const g = this.add.graphics().setScrollFactor(0);
    layer.add(g);

    const panelW = LOGICAL_WIDTH - 80;
    const panelH = 120;
    const px = 40;
    const py = WORLD_HEIGHT - panelH - 44;

    g.fillStyle(PALETTE.key, 0.96);
    g.fillRoundedRect(px, py, panelW, panelH, 10);
    g.lineStyle(3, PALETTE.keyEdge, 1);
    g.strokeRoundedRect(px, py, panelW, panelH, 10);

    const data = question.visual.data;
    if (question.visual.kind === 'bar-chart' && Array.isArray(data)) {
      const bars = data as Array<{ label: string; value: number }>;
      const max = Math.max(1, ...bars.map((b) => b.value));
      const bw = (panelW - 30) / Math.max(1, bars.length);
      bars.forEach((b, i) => {
        const hgt = (b.value / max) * (panelH - 44);
        g.fillStyle(PALETTE.keyEdge, 1);
        g.fillRect(px + 15 + i * bw + bw * 0.2, py + panelH - 22 - hgt, bw * 0.6, hgt);
        const t = this.add
          .text(px + 15 + i * bw + bw * 0.5, py + panelH - 16, b.label, {
            fontFamily: 'ui-monospace, monospace',
            fontSize: '11px',
            color: '#1b2340',
          })
          .setOrigin(0.5, 0)
          .setScrollFactor(0);
        layer.add(t);
      });
    } else if (question.visual.kind === 'array' && typeof data === 'object' && data !== null) {
      const { rows, cols } = data as { rows: number; cols: number };
      const dot = Math.min(14, (panelW - 40) / Math.max(1, cols), (panelH - 30) / Math.max(1, rows));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          g.fillStyle(PALETTE.keyEdge, 1);
          g.fillCircle(px + 24 + c * dot * 1.6, py + 24 + r * dot * 1.6, dot * 0.4);
        }
      }
    }

    this.visualLayer = layer;
  }

  /* ----------------------------------------------------------- deck wiring */

  private wireDeck(): void {
    this.deck.on('submit', this.onSubmit, this);
    this.deck.on('back', this.onBack, this);
    this.deck.on('action', this.onFinishTap, this);
    this.deck.on('actionHold', this.onFinishHold, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.deck.off('submit', this.onSubmit, this);
      this.deck.off('back', this.onBack, this);
      this.deck.off('action', this.onFinishTap, this);
      this.deck.off('actionHold', this.onFinishHold, this);
    });
  }

  private onSubmit(value: number): void {
    if (this.phase !== 'question') return;
    const elapsed = this.time.now - this.questionStartedAt;
    this.resolveOutcome(this.session.submit(value, elapsed));
  }

  private onBack(): void {
    if (this.phase !== 'question') return;
    // Backing out of a question costs nothing — the chain is only broken by a wrong answer or
    // a drained bar, never by changing your mind about which strike to throw.
    this.session.cancel();
    this.visualLayer?.destroy(true);
    this.visualLayer = null;
    this.deck.clearQuestion();
    this.enterChoosing();
  }

  /* ------------------------------------------------------------ resolution */

  private resolveOutcome(outcome: MathOutcome): void {
    this.phase = 'resolving';
    this.visualLayer?.destroy(true);
    this.visualLayer = null;
    this.deck.clearQuestion();
    this.deck.setTimer(0);

    const question = this.session.question;
    recordAnswer(this.state, question?.kind ?? 'auto', outcome.solved);

    this.battle.state.chain = outcome.chain;
    this.battle.state.chainBest = Math.max(this.battle.state.chainBest, outcome.chainBest);
    this.state.flags.bestChainEver = Math.max(this.state.flags.bestChainEver, outcome.chainBest);

    if (outcome.solved && outcome.reason === 'correct') {
      this.banner(outcome.chain >= 2 ? `CHAIN ${outcome.chain}  ×${outcome.chainMultiplier.toFixed(1)}` : 'SOLVED');
    } else if (!outcome.solved) {
      // The drop is where the game teaches. Show the working, always.
      const said = outcome.submitted !== null ? `You said ${outcome.submitted}. ` : 'Time. ';
      this.banner(`${said}${outcome.explain ?? ''}`, 2100);
    }

    this.lastLogLength = this.battle.state.log.length;
    this.battle.submit(toBattleCommand(outcome, this.pendingSlot));
    this.flushLog();
    this.refreshHud();

    this.time.delayedCall(outcome.solved ? 700 : 2000, () => this.afterTurn());
  }

  private afterTurn(): void {
    switch (this.battle.state.phase) {
      case 'awaiting-command':
        this.enterChoosing();
        break;
      case 'finish-window':
        this.enterFinish();
        break;
      case 'lost':
        this.onLoss();
        break;
      case 'fled':
        this.banner('You broke away.');
        this.time.delayedCall(900, () => this.close());
        break;
      default:
        this.close();
    }
  }

  private flushLog(): void {
    const fresh = this.battle.state.log.slice(this.lastLogLength);
    if (fresh.length === 0) return;
    this.logText.setText(fresh.map((l) => l.text).join('  '));
    this.lastLogLength = this.battle.state.log.length;
  }

  /* --------------------------------------------------------- Finish mode */

  /**
   * The Finish window.
   *
   * The deck reverts to the exploration controls — joystick, dash, action — exactly as the
   * Finish reference shows. Tap the spear to Sever; hold it to spend a talisman and Bind. See
   * DESIGN.md [A-3].
   */
  private enterFinish(): void {
    this.phase = 'finish';
    this.moveLayer.removeAll(true);
    this.moveGfx.clear();
    this.deck.setMode('finish');
    this.pushCamera(CAMERA.finishZoom);

    const canBind = this.init_.kind === 'wild' && this.talismanInBag() !== null;
    this.banner(canBind ? 'FINISH  ·  hold to BIND' : 'FINISH');
    this.playFinishFlourish();
  }

  private onFinishTap(): void {
    if (this.phase !== 'finish') return;
    this.phase = 'resolving';
    this.lastLogLength = this.battle.state.log.length;
    this.battle.submit({ kind: 'sever' });
    this.flushLog();
    this.onVictory();
  }

  private onFinishHold(): void {
    if (this.phase !== 'finish') return;
    const talisman = this.talismanInBag();
    if (!talisman) {
      this.banner('No talismans left.');
      return;
    }
    this.phase = 'resolving';
    this.state.bag.talismans[talisman] -= 1;

    // A chain held at the moment the spirit fell is worth something after the fight is won.
    const chainBonus = 1 + Math.min(0.5, this.battle.state.chainBest * 0.04);

    this.lastLogLength = this.battle.state.log.length;
    this.battle.submit({ kind: 'bind', talisman, chainBonus });
    this.flushLog();

    const result = this.battle.state.captureResult;
    this.playShakes(result?.shakes ?? 0, () => {
      if (this.battle.state.phase === 'bound') {
        const bound = this.battle.state.foe.instance;
        recordBound(this.state, bound.species);
        const where = addToParty(this.state, bound);
        this.banner(
          where === 'party'
            ? `${species(bound.species).name.toUpperCase()} is bound.`
            : `${species(bound.species).name.toUpperCase()} is bound — the Circle is full.`,
          1600,
        );
        this.time.delayedCall(1500, () => this.close());
      } else {
        this.banner('The talisman tore.', 1400);
        this.time.delayedCall(1300, () => this.onVictory());
      }
    });
  }

  private talismanInBag(): TalismanKind | null {
    const order: TalismanKind[] = ['ultra', 'great', 'basic'];
    return order.find((k) => this.state.bag.talismans[k] > 0) ?? null;
  }

  /** Four shakes, one per passed roll — the near-miss reads as a near-miss. */
  private playShakes(shakes: number, done: () => void): void {
    const marker = this.add
      .text(LOGICAL_WIDTH / 2, WORLD_HEIGHT * 0.55, '○ ○ ○ ○', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '26px',
        color: '#eadbc6',
        stroke: '#0a1018',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay);

    let shown = 0;
    const tick = (): void => {
      shown += 1;
      marker.setText(
        Array.from({ length: 4 }, (_, i) => (i < Math.min(shown, shakes) ? '●' : '○')).join(' '),
      );
      this.cameras.main.shake(120, 0.004);
      if (shown >= 4) {
        this.time.delayedCall(450, () => {
          marker.destroy();
          done();
        });
        return;
      }
      this.time.delayedCall(420, tick);
    };
    this.time.delayedCall(300, tick);
  }

  /** The spear arc from the Finish reference, drawn over the world. */
  private playFinishFlourish(): void {
    const cam = this.cameras.main;
    const g = this.add.graphics().setScrollFactor(0).setDepth(DEPTH.overlay - 1);
    const cx = LOGICAL_WIDTH * 0.5;
    const cy = WORLD_HEIGHT * 0.5;

    let t = 0;
    const timer = this.time.addEvent({
      delay: 16,
      repeat: 40,
      callback: () => {
        t += 0.025;
        g.clear();
        g.lineStyle(5 * (1 - t), PALETTE.cyan, 1 - t);
        g.beginPath();
        g.arc(cx, cy, 60 + t * 120, -2.2 + t * 1.4, -0.4 + t * 1.4);
        g.strokePath();
        if (t >= 1) {
          g.destroy();
          timer.remove();
        }
      },
    });
    cam.shake(180, 0.006);
  }

  /* --------------------------------------------------------- conclusions */

  private onVictory(): void {
    const xp = this.battle.state.xpPending;
    const shrine = this.init_.shrine;

    if (shrine && !this.state.flags.sigils.includes(shrine.sigil)) {
      this.state.flags.sigils.push(shrine.sigil);
      this.state.flags.sigils.sort((a, b) => a - b);
      this.banner(`SIGIL ${shrine.sigil}. ${shrine.keeper} stamps the book.`, 2400);
      this.time.delayedCall(2300, () => this.close());
      return;
    }

    this.banner(xp > 0 ? `+${xp} resonance` : 'The spirit settles.', 1400);
    this.time.delayedCall(1300, () => this.close());
  }

  private onLoss(): void {
    const loss = Math.floor(this.state.money / 2);
    this.state.money -= loss;
    this.banner(`You black out. −${loss} RM.`, 2200);
    this.time.delayedCall(2100, () => {
      for (const s of this.state.party) {
        s.currentHp = Math.max(1, Math.floor(maxHpOf(s) * 0.5));
        s.status = 'none';
      }
      this.close();
    });
  }

  private flee(): void {
    this.phase = 'resolving';
    this.moveLayer.removeAll(true);
    this.moveGfx.clear();
    this.lastLogLength = this.battle.state.log.length;
    this.battle.submit({ kind: 'flee' });
    this.flushLog();
    this.refreshHud();
    this.time.delayedCall(800, () => this.afterTurn());
  }

  private close(): void {
    if (this.phase === 'closing') return;
    this.phase = 'closing';
    this.battle?.commit();
    this.visualLayer?.destroy(true);
    this.world.onBattleEnd();
    this.scene.stop();
  }

  /* --------------------------------------------------------------- misc */

  private pushCamera(zoom: number): void {
    const cam = this.scene.get('World').cameras.main;
    cam.zoomTo(zoom, CAMERA.pushMs, 'Sine.easeInOut');
  }

  private banner(text: string, holdMs = 1100): void {
    this.bannerText.setText(text).setAlpha(1).setScale(0.9);
    this.tweens.killTweensOf(this.bannerText);
    this.tweens.add({ targets: this.bannerText, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.bannerText, alpha: 0, delay: holdMs, duration: 320 });
  }

  override update(): void {
    if (this.phase !== 'question') return;
    const elapsed = this.time.now - this.questionStartedAt;
    const remaining = 1 - elapsed / this.timeLimitMs;
    this.deck.setTimer(remaining);
    if (remaining <= 0) {
      this.resolveOutcome(this.session.timeout());
    }
  }
}

/** Re-exported so the keypad geometry stays discoverable from the battle side. */
export { KEYPAD };
