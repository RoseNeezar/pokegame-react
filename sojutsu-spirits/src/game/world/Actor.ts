/**
 * A world actor: the player, the companion spirit, an NPC or a roaming spirit.
 *
 * Two things here are load-bearing for the Eastward look the research bundle specifies:
 *
 *  • **Feet-biased collision.** The collision box is a short, wide rectangle at the actor's
 *    feet, not its silhouette. Heads, cloaks, ears and the spear across the back overlap
 *    scenery freely; only ground contact is solid. Without this, a top-down scene with tall
 *    props feels like walking through a maze of invisible walls.
 *  • **Feet-Y depth sorting.** Depth is the feet Y, so an actor walks behind a tree base and in
 *    front of the tree it has passed. The overhead layer handles canopies separately.
 */
import Phaser from 'phaser';
import { DEPTH } from '../layout.ts';

export type Facing = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west';

export const FACINGS: readonly Facing[] = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
];

/** Converts a movement vector to one of the eight compass facings. */
export function vectorToFacing(dx: number, dy: number, fallback: Facing = 'south'): Facing {
  if (dx === 0 && dy === 0) return fallback;
  // Screen space: +y is down, so north is -y. Offset by half a sector so the boundaries
  // land between facings rather than on them.
  const angle = Math.atan2(dy, dx);
  const index = Math.round((angle * 4) / Math.PI + 8) % 8;
  const order: Facing[] = [
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
    'north',
    'north-east',
  ];
  return order[index] ?? fallback;
}

/** The three walk cycles the character packs ship; the rest are mirrored or reused. */
type WalkKey = 'north' | 'south' | 'east';

function walkKeyFor(facing: Facing): { key: WalkKey; flip: boolean } {
  switch (facing) {
    case 'north':
      return { key: 'north', flip: false };
    case 'north-east':
      return { key: 'east', flip: false };
    case 'east':
      return { key: 'east', flip: false };
    case 'south-east':
      return { key: 'east', flip: false };
    case 'south':
      return { key: 'south', flip: false };
    case 'south-west':
      return { key: 'east', flip: true };
    case 'west':
      return { key: 'east', flip: true };
    case 'north-west':
      return { key: 'east', flip: true };
  }
}

export interface ActorConfig {
  readonly atlas: string;
  /** Frame prefix inside the atlas, e.g. "player" or "companion". */
  readonly prefix: string;
  readonly x: number;
  readonly y: number;
  /** Feet box, in world pixels. */
  readonly footWidth: number;
  readonly footHeight: number;
  readonly speed: number;
  readonly scale?: number;
}

export class Actor {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly body: Phaser.Physics.Arcade.Body;
  facing: Facing = 'south';
  private readonly cfg: ActorConfig;
  private readonly scene: Phaser.Scene;
  private moving = false;
  private hasAnims: boolean;

  constructor(scene: Phaser.Scene, cfg: ActorConfig) {
    this.scene = scene;
    this.cfg = cfg;

    const startFrame = `${cfg.prefix}/idle-south`;
    const hasFrame = scene.textures.exists(cfg.atlas) && scene.textures.get(cfg.atlas).has(startFrame);

    this.sprite = scene.physics.add
      .sprite(cfg.x, cfg.y, cfg.atlas, hasFrame ? startFrame : undefined)
      .setOrigin(0.5, 1) // origin at the feet: position IS ground contact
      .setScale(cfg.scale ?? 1);

    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    // Feet-biased box, anchored to the bottom-centre of the frame.
    const fw = cfg.footWidth;
    const fh = cfg.footHeight;
    this.body.setSize(fw, fh);
    this.body.setOffset((this.sprite.width - fw) / 2, this.sprite.height - fh);
    this.body.setCollideWorldBounds(true);

    this.hasAnims = hasFrame;
    if (hasFrame) this.ensureAnimations();
    this.applyIdle();
  }

  /** Builds the eight idle frames and three walk cycles once per atlas prefix. */
  private ensureAnimations(): void {
    const { atlas, prefix } = this.cfg;
    const tex = this.scene.textures.get(atlas);

    for (const dir of ['north', 'south', 'east'] as WalkKey[]) {
      const key = `${prefix}-walk-${dir}`;
      if (this.scene.anims.exists(key)) continue;

      const frames: Phaser.Types.Animations.AnimationFrame[] = [];
      for (let i = 0; i < 8; i++) {
        const name = `${prefix}/walk-${dir}-${i}`;
        if (!tex.has(name)) break;
        frames.push({ key: atlas, frame: name });
      }
      if (frames.length === 0) continue;
      this.scene.anims.create({ key, frames, frameRate: 9, repeat: -1 });
    }
  }

  private idleFrame(): string {
    return `${this.cfg.prefix}/idle-${this.facing}`;
  }

  private applyIdle(): void {
    this.sprite.anims.stop();
    const frame = this.idleFrame();
    if (this.hasAnims && this.scene.textures.get(this.cfg.atlas).has(frame)) {
      this.sprite.setFrame(frame);
      this.sprite.setFlipX(false);
    }
  }

  /** Drives the actor from a normalised −1..1 vector. */
  move(dx: number, dy: number, speedScale = 1): void {
    const mag = Math.hypot(dx, dy);
    if (mag < 0.01) {
      this.body.setVelocity(0, 0);
      if (this.moving) {
        this.moving = false;
        this.applyIdle();
      }
      return;
    }

    const speed = this.cfg.speed * speedScale;
    this.body.setVelocity((dx / mag) * speed * Math.min(1, mag), (dy / mag) * speed * Math.min(1, mag));

    const next = vectorToFacing(dx, dy, this.facing);
    const changed = next !== this.facing;
    this.facing = next;

    if (!this.moving || changed) {
      this.moving = true;
      this.playWalk();
    }
  }

  private playWalk(): void {
    if (!this.hasAnims) return;
    const { key, flip } = walkKeyFor(this.facing);
    const animKey = `${this.cfg.prefix}-walk-${key}`;
    this.sprite.setFlipX(flip);
    if (this.scene.anims.exists(animKey)) {
      this.sprite.anims.play(animKey, true);
    } else {
      this.applyIdle();
    }
  }

  /** Teleports without touching velocity — used by exits and cutscenes. */
  placeAt(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.body.reset(x, y);
  }

  face(facing: Facing): void {
    this.facing = facing;
    if (!this.moving) this.applyIdle();
  }

  stop(): void {
    this.body.setVelocity(0, 0);
    this.moving = false;
    this.applyIdle();
  }

  /** Feet-Y depth sort, refreshed every frame by the scene. */
  refreshDepth(): void {
    this.sprite.setDepth(DEPTH.actors + this.sprite.y);
  }

  get x(): number {
    return this.sprite.x;
  }

  get y(): number {
    return this.sprite.y;
  }

  get isMoving(): boolean {
    return this.moving;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

/**
 * A companion that trails the player along their own recent path.
 *
 * It follows the trail rather than steering toward the player: a pet that steers cuts corners,
 * clips scenery and shoves the player in doorways. Replaying the player's own positions means
 * it walks exactly where the player already proved was walkable.
 */
export class Follower {
  readonly actor: Actor;
  private readonly trail: Array<{ x: number; y: number }> = [];
  private readonly gap: number;

  constructor(actor: Actor, gap = 22) {
    this.actor = actor;
    this.gap = gap;
  }

  /** Push the leader's position each frame, then walk the tail toward the delayed sample. */
  update(leaderX: number, leaderY: number, leaderMoving: boolean): void {
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(leaderX - last.x, leaderY - last.y) > 3) {
      this.trail.push({ x: leaderX, y: leaderY });
    }
    if (this.trail.length > 90) this.trail.shift();

    const target = this.trail[Math.max(0, this.trail.length - Math.round(this.gap))];
    if (!target) return;

    const dx = target.x - this.actor.x;
    const dy = target.y - this.actor.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 6 || !leaderMoving) {
      this.actor.move(0, 0);
      return;
    }
    this.actor.move(dx / dist, dy / dist, Math.min(1.35, dist / 26));
  }

  reset(x: number, y: number): void {
    this.trail.length = 0;
    this.actor.placeAt(x, y);
  }
}
