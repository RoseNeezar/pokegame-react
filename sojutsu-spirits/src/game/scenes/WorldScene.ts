/**
 * The world scene — exploration, and the stage every battle is fought on.
 *
 * This scene is never left. Combat runs as an overlay on top of it and the camera pushes in;
 * that continuity is the single most important structural decision in the game's presentation
 * and it comes straight from the three mode references, which are all the same viewport.
 */
import Phaser from 'phaser';
import {
  CAMERA,
  DECK_TOP,
  DEPTH,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  PALETTE,
  TILE,
  WORLD_HEIGHT,
} from '../layout.ts';
import { ControlDeck } from '../../ui/ControlDeck.ts';
import { Actor, Follower, vectorToFacing, type Facing } from '../world/Actor.ts';
import { generateZone, isEncounterTerrain, type GeneratedZone } from '../world/generate.ts';
import { ZoneRenderer } from '../world/ZoneRenderer.ts';
import { exitBetween, oppositeEdge, zoneDef, type ZoneDef, type ZoneExit } from '../world/zones.ts';
import { Rng } from '../../core/rng.ts';
import { createSpirit, rollEncounter, species } from '../../core/dex.ts';
import type { GameState } from '../state.ts';
import { activeSpirit, healParty, load, newGame, recordSeen, save } from '../state.ts';

/** Walk speed in world px/sec, and the dash multiplier. */
const WALK_SPEED = 92;
const DASH_MULTIPLIER = 1.75;

export class WorldScene extends Phaser.Scene {
  private state!: GameState;
  private deck!: ControlDeck;
  private zone!: ZoneDef;
  private generated!: GeneratedZone;
  private zoneRenderer!: ZoneRenderer;

  private player!: Actor;
  private companion: Actor | null = null;
  private follower: Follower | null = null;
  private npcs: Array<{ actor: Actor; id: string; script: string; name: string }> = [];

  private solidGroup!: Phaser.Physics.Arcade.StaticGroup;
  private rng = new Rng('world');
  private stepsSinceEncounter = 0;
  private encounterCooldown = 0;
  private busy = false;
  private zoneLabel!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;

  constructor() {
    super('World');
  }

  init(data: { state?: GameState; zone?: string; fromZone?: string }): void {
    this.state = data.state ?? this.registry.get('state') ?? load() ?? newGame();
    this.registry.set('state', this.state);
    if (data.zone) this.state.zone = data.zone;
    this.registry.set('fromZone', data.fromZone ?? null);
  }

  create(): void {
    this.rng = new Rng(`world:${this.state.zone}:${this.state.playedMs | 0}`);
    this.zone = zoneDef(this.state.zone);
    this.generated = generateZone(this.zone);

    this.buildWorld();
    this.buildActors();
    this.buildCamera();

    // Everything created up to this point is world content; everything after it is deck and
    // HUD. The split is snapshotted here so the two cameras can be told exactly what to
    // ignore — see splitCameras().
    const worldObjects = this.children.list.slice();

    this.buildDeck();
    this.buildWorldUi();
    this.splitCameras(worldObjects);

    if (this.zone.heals && this.state.party.length > 0) {
      healParty(this.state);
      this.flash('The Mendery sets everything right.');
    }

    // Autosave on entering a zone: the player never loses more than one zone of progress.
    save(this.state);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.zoneRenderer?.destroy());
  }

  /* -------------------------------------------------------------- world */

  private buildWorld(): void {
    this.zoneRenderer = new ZoneRenderer(this, this.zone, this.generated);
    this.zoneRenderer.build();

    this.physics.world.setBounds(0, 0, this.zoneRenderer.pixelWidth, this.zoneRenderer.pixelHeight);

    // One static body per solid tile, merged into horizontal runs so a 40 × 60 zone costs
    // dozens of bodies rather than a couple of thousand.
    this.solidGroup = this.physics.add.staticGroup();
    const { width, height, solid } = this.generated;
    for (let ty = 0; ty < height; ty++) {
      let runStart = -1;
      for (let tx = 0; tx <= width; tx++) {
        const isSolid = tx < width && solid[ty * width + tx];
        if (isSolid && runStart === -1) runStart = tx;
        if (!isSolid && runStart !== -1) {
          const runLen = tx - runStart;
          const body = this.add.rectangle(
            runStart * TILE + (runLen * TILE) / 2,
            ty * TILE + TILE / 2,
            runLen * TILE,
            TILE,
          );
          this.solidGroup.add(body);
          body.setVisible(false);
          runStart = -1;
        }
      }
    }
  }

  private buildActors(): void {
    const spawn = this.resolveSpawn();

    this.player = new Actor(this, {
      atlas: 'player',
      prefix: 'player',
      x: spawn.x,
      y: spawn.y,
      footWidth: 14,
      footHeight: 8,
      speed: WALK_SPEED,
    });
    this.player.face((this.state.facing as Facing) ?? 'south');
    this.physics.add.collider(this.player.sprite, this.solidGroup);

    // The bound spirit walks with you — the manga never shows the player alone.
    const lead = activeSpirit(this.state);
    if (lead) {
      this.companion = new Actor(this, {
        atlas: 'companion',
        prefix: 'companion',
        x: spawn.x - 18,
        y: spawn.y + 8,
        footWidth: 10,
        footHeight: 6,
        speed: WALK_SPEED * 1.35,
      });
      this.physics.add.collider(this.companion.sprite, this.solidGroup);
      this.follower = new Follower(this.companion, 18);
    }

    for (const npc of this.zone.npcs) {
      const tx = Math.round(npc.at[0] * (this.generated.width - 3)) + 1;
      const ty = Math.round(npc.at[1] * (this.generated.height - 3)) + 1;
      const actor = new Actor(this, {
        atlas: 'player',
        prefix: 'npc',
        x: tx * TILE + TILE / 2,
        y: ty * TILE + TILE,
        footWidth: 14,
        footHeight: 8,
        speed: 0,
      });
      actor.face('south');
      this.npcs.push({ actor, id: npc.id, script: npc.script, name: npc.name });
    }
  }

  /** Where the player stands: the matching edge when arriving, else the zone centre. */
  private resolveSpawn(): { x: number; y: number } {
    const from = this.registry.get('fromZone') as string | null;
    if (from) {
      const back = exitBetween(this.zone, from);
      if (back) {
        const tile = this.generated.edgeSpawns[back.edge];
        return { x: tile.tx * TILE + TILE / 2, y: tile.ty * TILE + TILE };
      }
      // Arrived from a zone this one has no exit back to: use the opposite edge of the door
      // we came through, which is where the player would physically emerge.
      const source = zoneDef(from);
      const forward = exitBetween(source, this.zone.id);
      if (forward) {
        const tile = this.generated.edgeSpawns[oppositeEdge(forward.edge)];
        return { x: tile.tx * TILE + TILE / 2, y: tile.ty * TILE + TILE };
      }
    }
    if (this.state.x > 0 && this.state.y > 0) return { x: this.state.x, y: this.state.y };
    const c = this.generated.centreSpawn;
    return { x: c.tx * TILE + TILE / 2, y: c.ty * TILE + TILE };
  }

  /**
   * Two cameras.
   *
   * The world camera is clipped to the top 62% of the screen, which is what puts the scene in
   * the frame the references show and what keeps the player centred in the *visible* area
   * rather than behind the deck. But a clipped camera also refuses to draw — or hit-test —
   * anything below it, so the control deck needs a second, full-screen camera of its own.
   *
   * Each camera is told to ignore the other's objects, so nothing is drawn twice.
   */
  private splitCameras(worldObjects: Phaser.GameObjects.GameObject[]): void {
    const uiObjects = this.children.list.filter((o) => !worldObjects.includes(o));

    this.uiCamera = this.cameras.add(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.setName('ui');

    this.cameras.main.ignore(uiObjects);
    this.uiCamera.ignore(worldObjects);
  }

  private buildCamera(): void {
    const cam = this.cameras.main;
    // The world occupies the top 62% of the screen; the deck owns the rest.
    cam.setViewport(0, 0, LOGICAL_WIDTH, WORLD_HEIGHT);
    cam.setBounds(0, 0, this.zoneRenderer.pixelWidth, this.zoneRenderer.pixelHeight);
    cam.setZoom(CAMERA.exploreZoom);
    cam.startFollow(this.player.sprite, true, CAMERA.lerp, CAMERA.lerp);
    cam.setRoundPixels(true);
  }

  private buildDeck(): void {
    this.deck = new ControlDeck(this);
    this.registry.set('deck', this.deck);

    this.deck.on('action', () => this.onAction());
    this.deck.on('backpack', () => this.openMenu());
  }

  private buildWorldUi(): void {
    this.zoneLabel = this.add
      .text(12, 10, this.zone.name.toUpperCase(), {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        color: '#f2ede2',
        backgroundColor: '#0a1018cc',
        padding: { x: 8, y: 5 },
      })
      .setScrollFactor(0)
      .setDepth(DEPTH.worldUi);

    this.tweens.add({
      targets: this.zoneLabel,
      alpha: 0,
      delay: 2600,
      duration: 700,
    });

    this.hintText = this.add
      .text(LOGICAL_WIDTH / 2, DECK_TOP - 30, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '13px',
        color: '#f2ede2',
        backgroundColor: '#0a1018dd',
        padding: { x: 10, y: 6 },
        align: 'center',
        wordWrap: { width: LOGICAL_WIDTH - 60 },
      })
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(DEPTH.worldUi)
      .setVisible(false);
  }

  /* ------------------------------------------------------------- update */

  override update(time: number, delta: number): void {
    this.zoneRenderer.update(time, delta);
    this.state.playedMs += delta;

    if (this.busy) {
      this.player.stop();
      return;
    }

    const v = this.deck.moveVector;
    const dashing = this.deck.dashHeld;
    this.player.move(v.x, v.y, dashing ? DASH_MULTIPLIER : 1);

    if (this.follower && this.companion) {
      this.follower.update(this.player.x, this.player.y, this.player.isMoving);
      this.companion.refreshDepth();
    }
    this.player.refreshDepth();
    for (const n of this.npcs) n.actor.refreshDepth();

    this.state.x = this.player.x;
    this.state.y = this.player.y;
    this.state.facing = this.player.facing;

    this.checkExits();
    this.checkEncounter(delta, dashing);
    this.updateHint();
  }

  /* ------------------------------------------------------------- exits */

  private checkExits(): void {
    const tx = Math.floor(this.player.x / TILE);
    const ty = Math.floor(this.player.y / TILE);
    const { width, height } = this.generated;

    for (const exit of this.zone.exits) {
      const onEdge =
        (exit.edge === 'north' && ty <= 0) ||
        (exit.edge === 'south' && ty >= height - 1) ||
        (exit.edge === 'west' && tx <= 0) ||
        (exit.edge === 'east' && tx >= width - 1);
      if (!onEdge) continue;

      if (!this.canPass(exit)) {
        this.showHint(exit.lockedMessage ?? 'The way is closed.');
        // Nudge the player back inside so they do not stick to the gate.
        this.player.placeAt(
          Phaser.Math.Clamp(this.player.x, TILE * 1.5, (width - 1.5) * TILE),
          Phaser.Math.Clamp(this.player.y, TILE * 2, (height - 1.5) * TILE),
        );
        return;
      }

      this.travelTo(exit.to);
      return;
    }
  }

  private canPass(exit: ZoneExit): boolean {
    if (exit.requiresSigils && this.state.flags.sigils.length < exit.requiresSigils) return false;
    // A waystone that gates this exit must be solved first.
    const gate = this.zone.waystones.find((w) => w.blocksExitTo === exit.to);
    if (gate && !this.state.flags.waystonesSolved.includes(gate.id)) return false;
    return true;
  }

  private travelTo(zoneId: string): void {
    this.busy = true;
    this.state.x = 0;
    this.state.y = 0;
    save(this.state);
    this.cameras.main.fadeOut(220, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ state: this.state, zone: zoneId, fromZone: this.zone.id });
    });
  }

  /* -------------------------------------------------------- encounters */

  /**
   * Wild encounters.
   *
   * Encounters trigger only in tall grass and only while moving, they respect a cooldown after
   * every battle, and dashing raises the rate — running through the thicket is louder. The rate
   * itself comes from the zone data, and *which* spirit appears comes entirely from the approved
   * encounter tables.
   */
  private checkEncounter(delta: number, dashing: boolean): void {
    if (this.encounterCooldown > 0) {
      this.encounterCooldown -= delta;
      return;
    }
    if (!this.zone.encounterZone || this.zone.encounterRate <= 0) return;
    if (!this.player.isMoving) return;
    if (this.state.party.length === 0 || !activeSpirit(this.state)) return;

    const tx = Math.floor(this.player.x / TILE);
    const ty = Math.floor(this.player.y / TILE);
    const t = this.generated.terrain[ty * this.generated.width + tx];
    if (!t || !isEncounterTerrain(this.zone.biome, t)) return;

    this.stepsSinceEncounter += delta / 1000;
    const rate = this.zone.encounterRate * (dashing ? 1.5 : 1);
    if (!this.rng.chance(rate * (delta / 1000) * 12)) return;

    this.stepsSinceEncounter = 0;
    this.encounterCooldown = 1800;
    this.startWildBattle();
  }

  private startWildBattle(): void {
    const zoneName = this.zone.encounterZone;
    if (!zoneName) return;
    const foe = rollEncounter(zoneName, this.rng);
    recordSeen(this.state, foe.species);

    this.busy = true;
    this.player.stop();
    this.companion?.stop();
    this.hideHint();

    this.scene.launch('Battle', {
      state: this.state,
      foe,
      kind: 'wild',
      worldPoint: { x: this.player.x, y: this.player.y },
    });
    this.scene.bringToTop('Battle');
  }

  /** Called by the battle overlay when it finishes. */
  onBattleEnd(): void {
    this.clearBattleFoe();
    this.busy = false;
    this.encounterCooldown = 2200;
    this.deck.setMode('explore');
    this.cameras.main.zoomTo(CAMERA.exploreZoom, CAMERA.pushMs, 'Sine.easeInOut');
    save(this.state);
  }

  /* ----------------------------------------------------------- the action */

  /**
   * The action button in the world.
   *
   * One button, context-resolved by proximity: talk to the nearest NPC, read a waystone, or —
   * with nothing in reach — a spear sweep through the grass, which is how the player flushes an
   * encounter deliberately rather than waiting for one.
   */
  private onAction(): void {
    if (this.busy) return;

    const npc = this.nearestNpc(38);
    if (npc) {
      this.talkTo(npc);
      return;
    }

    const waystone = this.nearestWaystone(46);
    if (waystone) {
      this.openWaystone(waystone.id, waystone.tier);
      return;
    }

    this.spearSweep();
  }

  private nearestNpc(radius: number): { id: string; script: string; name: string } | null {
    let best: { id: string; script: string; name: string } | null = null;
    let bestDist = radius;
    for (const n of this.npcs) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, n.actor.x, n.actor.y);
      if (d < bestDist) {
        bestDist = d;
        best = { id: n.id, script: n.script, name: n.name };
      }
    }
    return best;
  }

  private nearestWaystone(radius: number): { id: string; tier: 1 | 2 | 3 } | null {
    for (const w of this.zone.waystones) {
      const tx = Math.round(w.at[0] * (this.generated.width - 3)) + 1;
      const ty = Math.round(w.at[1] * (this.generated.height - 3)) + 1;
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        tx * TILE + TILE / 2,
        ty * TILE + TILE / 2,
      );
      if (d < radius) return { id: w.id, tier: w.tier };
    }
    return null;
  }

  private talkTo(npc: { id: string; script: string; name: string }): void {
    this.busy = true;
    this.player.stop();
    this.scene.launch('Dialogue', { state: this.state, script: npc.script, speaker: npc.name });
    this.scene.bringToTop('Dialogue');
  }

  private openWaystone(id: string, tier: 1 | 2 | 3): void {
    if (this.state.flags.waystonesSolved.includes(id)) {
      this.showHint('The waystone is already lit.');
      return;
    }
    this.busy = true;
    this.player.stop();
    this.scene.launch('Dialogue', {
      state: this.state,
      script: 'waystone',
      speaker: 'Waystone',
      waystone: { id, tier },
    });
    this.scene.bringToTop('Dialogue');
  }

  /** A visible sweep of the spear, and a chance to flush a spirit out of the grass. */
  private spearSweep(): void {
    const facing = this.player.facing;
    const dir = facingVector(facing);
    const arc = this.add
      .graphics()
      .setDepth(DEPTH.actors + this.player.y + 1);
    const cx = this.player.x + dir.x * 14;
    const cy = this.player.y - 12 + dir.y * 14;

    arc.lineStyle(3, PALETTE.cyan, 0.9);
    const base = Math.atan2(dir.y, dir.x);
    arc.beginPath();
    arc.arc(cx, cy, 22, base - 0.9, base + 0.9);
    arc.strokePath();

    this.tweens.add({
      targets: arc,
      alpha: 0,
      duration: 220,
      onComplete: () => arc.destroy(),
    });

    // Sweeping tall grass is the deliberate way to find a fight.
    const tx = Math.floor((this.player.x + dir.x * TILE) / TILE);
    const ty = Math.floor((this.player.y + dir.y * TILE) / TILE);
    const inRange =
      tx >= 0 && ty >= 0 && tx < this.generated.width && ty < this.generated.height;
    const t = inRange ? this.generated.terrain[ty * this.generated.width + tx] : undefined;
    if (
      t &&
      isEncounterTerrain(this.zone.biome, t) &&
      this.zone.encounterZone &&
      this.encounterCooldown <= 0 &&
      this.rng.chance(0.4)
    ) {
      this.startWildBattle();
    }
  }

  private openMenu(): void {
    if (this.busy) return;
    this.busy = true;
    this.player.stop();
    this.scene.launch('Menu', { state: this.state });
    this.scene.bringToTop('Menu');
  }

  /** Called by overlay scenes when they close. */
  resume(): void {
    this.busy = false;
    this.deck.setMode('explore');
    save(this.state);
  }

  /* -------------------------------------------------------------- hints */

  private updateHint(): void {
    const npc = this.nearestNpc(38);
    const ws = this.nearestWaystone(46);
    if (npc) this.showHint(`▲  Speak to ${npc.name}`);
    else if (ws && !this.state.flags.waystonesSolved.includes(ws.id)) this.showHint('▲  Read the waystone');
    else this.hideHint();
  }

  private hintShown = '';

  private showHint(text: string): void {
    if (this.hintShown === text) return;
    this.hintShown = text;
    this.hintText.setText(text).setVisible(true);
  }

  /** Hidden, not merely transparent: a Text with a background paints its padding even at 0 text. */
  private hideHint(): void {
    if (this.hintShown === '') return;
    this.hintShown = '';
    this.hintText.setVisible(false);
  }

  private flash(text: string): void {
    this.showHint(text);
    this.time.delayedCall(2200, () => this.hideHint());
  }

  /* ---------------------------------------------------------- accessors */

  /** The battle overlay needs these to stage the fight in the world. */
  getPlayerActor(): Actor {
    return this.player;
  }

  getCompanionActor(): Actor | null {
    return this.companion;
  }

  getDeck(): ControlDeck {
    return this.deck;
  }

  getState(): GameState {
    return this.state;
  }

  /* ------------------------------------------------------ battle staging */

  private foeSprite: Phaser.GameObjects.Image | null = null;
  private foeShadow: Phaser.GameObjects.Ellipse | null = null;

  /**
   * Puts the opposing spirit into the world for the fight.
   *
   * Combat in this game happens where you are standing, so the foe has to actually be there.
   * It is placed a short way in front of the player, on the ground, sorted by feet-Y like any
   * other actor, and it bobs so a still frame does not read as a decal.
   */
  spawnBattleFoe(speciesId: string): { x: number; y: number } {
    this.clearBattleFoe();

    const dir = facingVector(this.player.facing);
    const x = Phaser.Math.Clamp(
      this.player.x + dir.x * 72,
      TILE,
      this.zoneRenderer.pixelWidth - TILE,
    );
    const y = Phaser.Math.Clamp(
      this.player.y + dir.y * 72,
      TILE * 2,
      this.zoneRenderer.pixelHeight - TILE,
    );

    this.foeShadow = this.add
      .ellipse(x, y + 2, 26, 10, 0x000000, 0.35)
      .setDepth(DEPTH.actors + y - 1);

    const s = species(speciesId);
    const frame = `spirit/${String(s.dexNo).padStart(3, '0')}-${s.id}`;
    if (this.textures.exists('spirits') && this.textures.get('spirits').has(frame)) {
      this.foeSprite = this.add
        .image(x, y, 'spirits', frame)
        .setOrigin(0.5, 1)
        .setScale(1.4)
        .setDepth(DEPTH.actors + y);
    } else {
      this.foeSprite = this.add
        .image(x, y, '__WHITE')
        .setOrigin(0.5, 1)
        .setDisplaySize(26, 30)
        .setTint(0xd9503f)
        .setDepth(DEPTH.actors + y);
    }

    // The world camera owns this; the UI camera must not draw it a second time.
    this.uiCamera?.ignore([this.foeSprite, this.foeShadow]);

    this.tweens.add({
      targets: this.foeSprite,
      y: y - 4,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Both the player and the bound spirit turn to face it.
    const toFoe = vectorToFacing(x - this.player.x, y - this.player.y, this.player.facing);
    this.player.face(toFoe);
    this.companion?.face(toFoe);

    return { x, y };
  }

  clearBattleFoe(): void {
    if (this.foeSprite) this.tweens.killTweensOf(this.foeSprite);
    this.foeSprite?.destroy();
    this.foeShadow?.destroy();
    this.foeSprite = null;
    this.foeShadow = null;
  }

  /** Where the foe is standing, for effects that need to land on it. */
  getFoePoint(): { x: number; y: number } | null {
    return this.foeSprite ? { x: this.foeSprite.x, y: this.foeSprite.y } : null;
  }

  /** Plays the foe's defeat: it drops and fades. */
  foeFaints(): void {
    if (!this.foeSprite) return;
    this.tweens.killTweensOf(this.foeSprite);
    this.tweens.add({
      targets: [this.foeSprite, this.foeShadow].filter(Boolean),
      alpha: 0.35,
      angle: 14,
      duration: 320,
      ease: 'Quad.easeOut',
    });
  }

  /** Spawns a shrine ace where the keeper stands, for a scripted shrine battle. */
  startShrineBattle(): void {
    if (!this.zone.shrine) return;
    const rng = new Rng(`shrine:${this.zone.id}`);
    const ace = createSpirit(this.zone.shrine.aceSpecies, this.zone.shrine.aceLevel, rng);
    recordSeen(this.state, ace.species);
    this.busy = true;
    this.scene.launch('Battle', {
      state: this.state,
      foe: ace,
      kind: 'shrine',
      shrine: this.zone.shrine,
      worldPoint: { x: this.player.x, y: this.player.y },
    });
    this.scene.bringToTop('Battle');
  }

  /** Species name lookup, so overlays do not each import the dex. */
  speciesName(id: string): string {
    return species(id).name;
  }
}

function facingVector(f: Facing): { x: number; y: number } {
  const map: Record<Facing, [number, number]> = {
    north: [0, -1],
    'north-east': [0.7, -0.7],
    east: [1, 0],
    'south-east': [0.7, 0.7],
    south: [0, 1],
    'south-west': [-0.7, 0.7],
    west: [-1, 0],
    'north-west': [-0.7, -0.7],
  };
  const [x, y] = map[f];
  return { x, y };
}

export { vectorToFacing };
