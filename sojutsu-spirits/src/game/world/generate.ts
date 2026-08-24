/**
 * Deterministic zone terrain generation.
 *
 * The research bundle's recommended production path is a hand-authored "hero plate" per map
 * with authored Tiled metadata layers. That is the right shipping answer and this generator is
 * built to be replaced by it: it produces exactly the layer set that document specifies —
 * ground, lower props, animated water, overhead, collision, spawns, triggers — so a hand-made
 * plate can be dropped in behind the same interface without the scene changing at all.
 *
 * Until those plates exist, this composes them from the authored tile set, per zone, from a
 * fixed seed. Same seed, same map, every time: the world is stable across sessions and across
 * saves, which is the property that actually matters for a zone the player will walk twice.
 */
import { Rng } from '../../core/rng.ts';
import type { Biome, ZoneDef } from './zones.ts';

/** What a tile is, for gameplay purposes. Rendering picks a frame from this plus the biome. */
export type Terrain =
  | 'ground' // walkable, plain
  | 'path' // walkable, the road
  | 'grass' // walkable, tall grass — spirits are encountered here
  | 'water' // blocked, animated
  | 'shallow' // walkable, animated, slows you
  | 'rock' // blocked
  | 'wall' // blocked
  | 'floor'; // walkable interior / shrine stone

export interface PropInstance {
  /** Tile coordinates. */
  readonly tx: number;
  readonly ty: number;
  readonly kind: PropKind;
  /** True when the prop's upper half belongs on the overhead layer. */
  readonly overhead: boolean;
  /** Blocks movement at its base. */
  readonly solid: boolean;
  readonly variant: number;
}

export type PropKind =
  | 'tree'
  | 'bush'
  | 'rock'
  | 'reed'
  | 'lantern'
  | 'waystone'
  | 'torii'
  | 'house'
  | 'crate'
  | 'stump'
  | 'flower';

export interface GeneratedZone {
  readonly width: number;
  readonly height: number;
  readonly terrain: Terrain[];
  readonly props: PropInstance[];
  /** True where movement is blocked. Derived from terrain plus solid prop bases. */
  readonly solid: boolean[];
  /** Where the player stands when entering from each edge. */
  readonly edgeSpawns: Record<'north' | 'south' | 'east' | 'west', { tx: number; ty: number }>;
  /** Centre of the zone's walkable area — the default spawn. */
  readonly centreSpawn: { tx: number; ty: number };
}

const WALKABLE: ReadonlySet<Terrain> = new Set<Terrain>(['ground', 'path', 'grass', 'shallow', 'floor']);

export function isWalkable(t: Terrain): boolean {
  return WALKABLE.has(t);
}

/* ------------------------------------------------------------------ noise */

/**
 * Value noise on a seeded lattice.
 *
 * Perlin would be smoother, but value noise with a smoothstep is enough to break up terrain at
 * this scale and it is a dozen lines instead of eighty — and it goes through the same seeded Rng
 * the rest of the game uses, so the map is reproducible.
 */
function makeNoise(rng: Rng, size: number): (x: number, y: number) => number {
  const lattice: number[] = Array.from({ length: size * size }, () => rng.float());
  const at = (x: number, y: number): number =>
    lattice[((y % size) + size) % size * size + (((x % size) + size) % size)] ?? 0;
  const smooth = (t: number): number => t * t * (3 - 2 * t);

  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
  };
}

/* --------------------------------------------------------------- generation */

export function generateZone(zone: ZoneDef): GeneratedZone {
  const rng = new Rng(`zone:${zone.seed}`);
  const { width: w, height: h } = zone;
  const terrain: Terrain[] = new Array(w * h).fill('ground');
  const props: PropInstance[] = [];

  const idx = (x: number, y: number): number => y * w + x;
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h;
  const set = (x: number, y: number, t: Terrain): void => {
    if (inBounds(x, y)) terrain[idx(x, y)] = t;
  };
  const get = (x: number, y: number): Terrain => (inBounds(x, y) ? terrain[idx(x, y)]! : 'wall');

  const noise = makeNoise(rng, 16);
  const scale = 0.16;

  /* 1. Base terrain from the biome. */
  paintBase(zone.biome, terrain, w, h, noise, scale, rng);

  /* 2. The road. Every zone is connected by a path that actually joins its exits, so the
        player can always follow the road rather than hunting for the way out. */
  const nodes = exitNodes(zone, w, h);
  const hub = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  for (const n of nodes) carvePath(set, get, n, hub, rng);
  if (nodes.length === 0) carvePath(set, get, { x: 2, y: hub.y }, hub, rng);

  /* 3. A border of blocking terrain, punched through only at the exits. */
  for (let x = 0; x < w; x++) {
    for (const y of [0, h - 1]) set(x, y, borderTerrain(zone.biome));
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) set(x, y, borderTerrain(zone.biome));
  }
  for (const n of nodes) {
    // Punch a three-wide gate so the exit is unmissable.
    for (let d = -1; d <= 1; d++) {
      if (n.x === 0 || n.x === w - 1) set(n.x, n.y + d, 'path');
      else set(n.x + d, n.y, 'path');
    }
  }

  /* 4. Props. Trees and rocks avoid the road; the road is the promise that you can get through. */
  scatterProps(zone, terrain, props, w, h, rng, noise);

  /* 5. Waystones and the shrine torii are placed exactly where the zone data says. */
  for (const ws of zone.waystones) {
    const tx = Math.round(ws.at[0] * (w - 3)) + 1;
    const ty = Math.round(ws.at[1] * (h - 3)) + 1;
    clearArea(set, tx, ty, 1);
    props.push({ tx, ty, kind: 'waystone', overhead: false, solid: true, variant: 0 });
  }
  if (zone.shrine) {
    const tx = Math.floor(w / 2);
    const ty = Math.max(2, Math.floor(h * 0.18));
    clearArea(set, tx, ty, 2);
    props.push({ tx, ty, kind: 'torii', overhead: true, solid: false, variant: 0 });
  }
  for (const npc of zone.npcs) {
    const tx = Math.round(npc.at[0] * (w - 3)) + 1;
    const ty = Math.round(npc.at[1] * (h - 3)) + 1;
    clearArea(set, tx, ty, 1);
  }

  /* 6. Solidity, derived once so the scene never recomputes it. */
  const solid = terrain.map((t) => !isWalkable(t));
  for (const p of props) {
    if (p.solid && inBounds(p.tx, p.ty)) solid[idx(p.tx, p.ty)] = true;
  }

  const edgeSpawns = computeEdgeSpawns(zone, w, h, solid);
  const centreSpawn = nearestWalkable(hub.x, hub.y, w, h, solid);

  return { width: w, height: h, terrain, props, solid, edgeSpawns, centreSpawn };
}

/* --------------------------------------------------------------- base paint */

function paintBase(
  biome: Biome,
  terrain: Terrain[],
  w: number,
  h: number,
  noise: (x: number, y: number) => number,
  scale: number,
  rng: Rng,
): void {
  const riverX = Math.floor(w * (0.28 + rng.float() * 0.12));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = noise(x * scale, y * scale);
      const i = y * w + x;
      switch (biome) {
        case 'meadow':
          terrain[i] = n > 0.56 ? 'grass' : 'ground';
          break;
        case 'thicket':
          terrain[i] = n > 0.42 ? 'grass' : 'ground';
          break;
        case 'riverside': {
          // A river running roughly north-south, with a shallow margin either side.
          const drift = Math.sin(y * 0.18) * 3.2;
          const d = Math.abs(x - (riverX + drift));
          if (d < 2.2) terrain[i] = 'water';
          else if (d < 3.4) terrain[i] = 'shallow';
          else terrain[i] = n > 0.6 ? 'grass' : 'ground';
          break;
        }
        case 'shallows': {
          const d = Math.abs(x - w * 0.5) + Math.abs(y - h * 0.5) * 0.35;
          if (d < w * 0.16) terrain[i] = 'water';
          else if (d < w * 0.3) terrain[i] = 'shallow';
          else terrain[i] = n > 0.62 ? 'grass' : 'ground';
          break;
        }
        case 'highland':
          terrain[i] = n > 0.68 ? 'rock' : n > 0.5 ? 'grass' : 'ground';
          break;
        case 'cavern':
          terrain[i] = n > 0.52 ? 'floor' : n > 0.34 ? 'ground' : 'rock';
          break;
        case 'town':
          terrain[i] = n > 0.74 ? 'grass' : 'ground';
          break;
        case 'shrine':
          terrain[i] = n > 0.66 ? 'grass' : 'floor';
          break;
      }
    }
  }
}

function borderTerrain(biome: Biome): Terrain {
  return biome === 'cavern' || biome === 'highland' ? 'rock' : 'wall';
}

/* -------------------------------------------------------------- path carving */

interface Node {
  x: number;
  y: number;
}

function exitNodes(zone: ZoneDef, w: number, h: number): Node[] {
  return zone.exits.map((e) => {
    switch (e.edge) {
      case 'north':
        return { x: clamp(Math.round(e.at * (w - 1)), 2, w - 3), y: 0 };
      case 'south':
        return { x: clamp(Math.round(e.at * (w - 1)), 2, w - 3), y: h - 1 };
      case 'west':
        return { x: 0, y: clamp(Math.round(e.at * (h - 1)), 2, h - 3) };
      case 'east':
        return { x: w - 1, y: clamp(Math.round(e.at * (h - 1)), 2, h - 3) };
    }
  });
}

/** An L-shaped road with a little wobble, three tiles wide so it reads as a road. */
function carvePath(
  set: (x: number, y: number, t: Terrain) => void,
  get: (x: number, y: number) => Terrain,
  from: Node,
  to: Node,
  rng: Rng,
): void {
  const stamp = (x: number, y: number): void => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 1) continue;
        // A road crosses water on planks; it never simply deletes the river.
        if (get(x + dx, y + dy) === 'water') set(x + dx, y + dy, 'shallow');
        else set(x + dx, y + dy, 'path');
      }
    }
  };

  let x = from.x;
  let y = from.y;
  const bendAt = to.y + rng.int(-4, 4);

  while (y !== bendAt && Math.abs(y - bendAt) > 0) {
    stamp(x, y);
    y += Math.sign(bendAt - y);
    if (rng.chance(0.12)) x += rng.int(-1, 1);
  }
  while (x !== to.x) {
    stamp(x, y);
    x += Math.sign(to.x - x);
  }
  while (y !== to.y) {
    stamp(x, y);
    y += Math.sign(to.y - y);
  }
  stamp(to.x, to.y);
}

function clearArea(set: (x: number, y: number, t: Terrain) => void, cx: number, cy: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) set(cx + dx, cy + dy, 'path');
  }
}

/* ------------------------------------------------------------------- props */

function scatterProps(
  zone: ZoneDef,
  terrain: Terrain[],
  props: PropInstance[],
  w: number,
  h: number,
  rng: Rng,
  noise: (x: number, y: number) => number,
): void {
  const density = zone.biome === 'thicket' ? 0.1 : zone.biome === 'town' ? 0.03 : 0.06;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const t = terrain[y * w + x]!;
      if (t === 'path' || t === 'water' || t === 'wall') continue;
      if (!rng.chance(density)) continue;

      // Keep a one-tile skirt clear around the road so props never pinch it shut.
      if (nearPath(terrain, w, h, x, y)) continue;

      const kind = pickProp(zone.biome, t, noise(x * 0.3, y * 0.3), rng);
      if (!kind) continue;
      props.push({
        tx: x,
        ty: y,
        kind,
        overhead: kind === 'tree',
        solid: kind === 'tree' || kind === 'rock' || kind === 'house' || kind === 'crate',
        variant: rng.int(0, 2),
      });
    }
  }

  if (zone.biome === 'town') addTownBuildings(zone, terrain, props, w, h, rng);
}

function nearPath(terrain: Terrain[], w: number, h: number, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (terrain[ny * w + nx] === 'path') return true;
    }
  }
  return false;
}

function pickProp(biome: Biome, t: Terrain, n: number, rng: Rng): PropKind | null {
  if (t === 'shallow') return rng.chance(0.5) ? 'reed' : null;
  switch (biome) {
    case 'thicket':
      return n > 0.55 ? 'tree' : rng.chance(0.5) ? 'bush' : 'flower';
    case 'meadow':
      return n > 0.72 ? 'tree' : rng.chance(0.4) ? 'bush' : 'flower';
    case 'riverside':
      return n > 0.7 ? 'tree' : rng.chance(0.5) ? 'reed' : 'bush';
    case 'shallows':
      return rng.chance(0.6) ? 'reed' : 'rock';
    case 'highland':
      return n > 0.6 ? 'rock' : rng.chance(0.4) ? 'stump' : 'bush';
    case 'cavern':
      return rng.chance(0.7) ? 'rock' : 'lantern';
    case 'town':
      return rng.chance(0.5) ? 'crate' : 'lantern';
    case 'shrine':
      return rng.chance(0.5) ? 'lantern' : 'bush';
  }
}

/** Two shop buildings and a scatter of lanterns, placed off the road. */
function addTownBuildings(
  zone: ZoneDef,
  terrain: Terrain[],
  props: PropInstance[],
  w: number,
  h: number,
  rng: Rng,
): void {
  for (const npc of zone.npcs) {
    if (!/mender|provisioner/i.test(npc.id)) continue;
    const tx = clamp(Math.round(npc.at[0] * (w - 4)) + 1, 2, w - 3);
    const ty = clamp(Math.round(npc.at[1] * (h - 4)), 2, h - 4);
    props.push({ tx, ty, kind: 'house', overhead: true, solid: true, variant: rng.int(0, 1) });
    // The doorway tile in front of the building stays walkable.
    if (ty + 1 < h) terrain[(ty + 1) * w + tx] = 'path';
  }
}

/* ------------------------------------------------------------------ spawns */

function computeEdgeSpawns(
  zone: ZoneDef,
  w: number,
  h: number,
  solid: boolean[],
): GeneratedZone['edgeSpawns'] {
  const nodes = exitNodes(zone, w, h);
  const result = {
    north: { tx: Math.floor(w / 2), ty: 2 },
    south: { tx: Math.floor(w / 2), ty: h - 3 },
    east: { tx: w - 3, ty: Math.floor(h / 2) },
    west: { tx: 2, ty: Math.floor(h / 2) },
  };

  zone.exits.forEach((exit, i) => {
    const n = nodes[i];
    if (!n) return;
    // Step one tile inward from the gate so arriving never lands the player in the border.
    const inward =
      exit.edge === 'north'
        ? { tx: n.x, ty: 2 }
        : exit.edge === 'south'
          ? { tx: n.x, ty: h - 3 }
          : exit.edge === 'west'
            ? { tx: 2, ty: n.y }
            : { tx: w - 3, ty: n.y };
    result[exit.edge] = nearestWalkable(inward.tx, inward.ty, w, h, solid);
  });

  return result;
}

/** Spiral outward until a walkable tile is found — spawns must never land inside a rock. */
function nearestWalkable(
  tx: number,
  ty: number,
  w: number,
  h: number,
  solid: boolean[],
): { tx: number; ty: number } {
  for (let r = 0; r < Math.max(w, h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = tx + dx;
        const y = ty + dy;
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        if (!solid[y * w + x]) return { tx: x, ty: y };
      }
    }
  }
  return { tx: Math.floor(w / 2), ty: Math.floor(h / 2) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
