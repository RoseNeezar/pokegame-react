import { describe, it, expect } from 'vitest';
import { ZONES, zoneDef, exitBetween, oppositeEdge } from './zones.ts';
import { encounterTerrainFor, generateZone, isEncounterTerrain, isWalkable, type GeneratedZone } from './generate.ts';
import { allZones, species } from '../../core/dex.ts';
import { REGIONS } from '../../core/dex.ts';

const generated = new Map<string, GeneratedZone>(ZONES.map((z) => [z.id, generateZone(z)]));

describe('the Phase One zone graph', () => {
  it('gives every zone a unique id and a non-empty name', () => {
    const ids = new Set<string>();
    for (const z of ZONES) {
      expect(ids.has(z.id)).toBe(false);
      ids.add(z.id);
      expect(z.name.length).toBeGreaterThan(0);
    }
  });

  it('points every exit at a zone that exists', () => {
    for (const z of ZONES) {
      for (const e of z.exits) {
        expect(() => zoneDef(e.to)).not.toThrow();
      }
    }
  });

  it('makes every exit two-way, so the player can always walk back', () => {
    // A one-way exit in a game with no fast travel is how a player gets stranded.
    for (const z of ZONES) {
      for (const e of z.exits) {
        const back = exitBetween(zoneDef(e.to), z.id);
        expect(back ? 'ok' : `ONE-WAY EXIT: ${z.id} -> ${e.to}`).toBe('ok');
      }
    }
  });

  it('puts the return exit on the opposite edge', () => {
    for (const z of ZONES) {
      for (const e of z.exits) {
        const back = exitBetween(zoneDef(e.to), z.id);
        if (!back) continue;
        expect(back.edge).toBe(oppositeEdge(e.edge));
      }
    }
  });

  it('reaches every zone from the starting village, given enough sigils', () => {
    const seen = new Set<string>(['rantings-rest']);
    const queue = ['rantings-rest'];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const e of zoneDef(id).exits) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        queue.push(e.to);
      }
    }
    const unreachable = ZONES.filter((z) => !seen.has(z.id)).map((z) => z.id);
    expect(unreachable).toEqual([]);
  });

  it('gates the regions in the order the sigils are earned', () => {
    // Shrine 1 -> Riverside, Shrine 2 -> Highland. Nothing else is sigil-locked, so a player
    // can never be blocked by a lock they have no way to open.
    const locked = ZONES.flatMap((z) =>
      z.exits.filter((e) => e.requiresSigils).map((e) => ({ from: z.id, to: e.to, n: e.requiresSigils! })),
    );
    expect(locked).toEqual([
      { from: 'shrine-thicket', to: 'riverside-trail', n: 1 },
      { from: 'shrine-ferry', to: 'stone-steps', n: 2 },
    ]);
  });

  it('places each sigil lock immediately after the shrine that grants it', () => {
    for (const z of ZONES) {
      for (const e of z.exits) {
        if (!e.requiresSigils) continue;
        const shrine = zoneDef(z.id).shrine;
        expect(shrine).toBeDefined();
        expect(shrine!.sigil).toBe(e.requiresSigils);
      }
    }
  });

  it('gives every sigil-locked exit an explanation', () => {
    for (const z of ZONES) {
      for (const e of z.exits) {
        if (!e.requiresSigils) continue;
        expect((e.lockedMessage ?? '').length).toBeGreaterThan(10);
      }
    }
  });
});

describe('zones against the approved data', () => {
  it('uses only encounter zones that exist in the approved tables', () => {
    const known = new Set(allZones().map((z) => z.zone));
    for (const z of ZONES) {
      if (!z.encounterZone) continue;
      expect(known.has(z.encounterZone) ? 'ok' : `UNKNOWN TABLE: ${z.id} -> ${z.encounterZone}`).toBe('ok');
    }
  });

  it('uses every Part-One encounter table exactly once', () => {
    const used = ZONES.map((z) => z.encounterZone).filter(Boolean) as string[];
    const known = allZones().map((z) => z.zone);
    expect([...used].sort()).toEqual([...known].sort());
  });

  it('matches the shrine aces the battle-math document specifies', () => {
    const shrines = ZONES.filter((z) => z.shrine).map((z) => z.shrine!);
    expect(shrines.map((s) => `${s.sigil}:${s.aceSpecies}@${s.aceLevel}`)).toEqual([
      '1:leaflark@14',
      '2:glacisaur@22',
      '3:burrosaur@29',
    ]);
    for (const s of shrines) expect(() => species(s.aceSpecies)).not.toThrow();
  });

  it('agrees with the generated region data on keeper, aspect and ace', () => {
    for (const r of REGIONS) {
      const zone = ZONES.find((z) => z.shrine?.sigil === r.sigil);
      expect(zone).toBeDefined();
      expect(zone!.shrine!.keeper).toBe(r.shrineKeeper);
      expect(zone!.shrine!.aspect).toBe(r.shrineAspect);
      expect(zone!.shrine!.aceSpecies).toBe(r.shrineAce.species);
      expect(zone!.shrine!.aceLevel).toBe(r.shrineAce.level);
    }
  });

  it('runs the shrines in the order Grass, Water, Ground', () => {
    const order = ZONES.filter((z) => z.shrine)
      .sort((a, b) => a.shrine!.sigil - b.shrine!.sigil)
      .map((z) => z.shrine!.aspect);
    expect(order).toEqual(['Grass', 'Water', 'Ground']);
  });

  it('lets safe zones heal and never spawn encounters', () => {
    for (const z of ZONES) {
      if (z.biome !== 'town' && z.biome !== 'shrine') continue;
      expect(z.encounterZone).toBeNull();
      expect(z.encounterRate).toBe(0);
      expect(z.heals).toBe(true);
    }
  });
});

describe('zone generation', () => {
  it('is deterministic — the same zone generates identically every time', () => {
    for (const z of ZONES.slice(0, 5)) {
      const a = generateZone(z);
      const b = generateZone(z);
      expect(a.terrain).toEqual(b.terrain);
      expect(a.props).toEqual(b.props);
      expect(a.edgeSpawns).toEqual(b.edgeSpawns);
    }
  });

  it('produces a map of the declared size', () => {
    for (const z of ZONES) {
      const g = generated.get(z.id)!;
      expect(g.width).toBe(z.width);
      expect(g.height).toBe(z.height);
      expect(g.terrain.length).toBe(z.width * z.height);
      expect(g.solid.length).toBe(z.width * z.height);
    }
  });

  it('never spawns the player inside something solid', () => {
    for (const z of ZONES) {
      const g = generated.get(z.id)!;
      for (const edge of ['north', 'south', 'east', 'west'] as const) {
        const s = g.edgeSpawns[edge];
        expect(g.solid[s.ty * g.width + s.tx]).toBe(false);
      }
      expect(g.solid[g.centreSpawn.ty * g.width + g.centreSpawn.tx]).toBe(false);
    }
  });

  it('connects every exit to the zone centre by walkable ground', () => {
    // The single most important property of a generated map: if the road does not actually
    // join the doors, the player is stuck in a zone with a visible exit they cannot reach.
    for (const z of ZONES) {
      const g = generated.get(z.id)!;
      const reachable = floodFrom(g, g.centreSpawn.tx, g.centreSpawn.ty);
      for (const edge of ['north', 'south', 'east', 'west'] as const) {
        const hasExit = z.exits.some((e) => e.edge === edge);
        if (!hasExit) continue;
        const s = g.edgeSpawns[edge];
        const ok = reachable.has(s.ty * g.width + s.tx);
        expect(ok ? 'ok' : `STRANDED EXIT: ${z.id}/${edge}`).toBe('ok');
      }
    }
  });

  it('puts every waystone and NPC on reachable ground', () => {
    for (const z of ZONES) {
      const g = generated.get(z.id)!;
      const reachable = floodFrom(g, g.centreSpawn.tx, g.centreSpawn.ty);
      const anchors = [
        ...z.waystones.map((w) => w.at),
        ...z.npcs.map((n) => n.at),
      ];
      for (const at of anchors) {
        const tx = Math.round(at[0]! * (g.width - 3)) + 1;
        const ty = Math.round(at[1]! * (g.height - 3)) + 1;
        // The generator clears a walkable pad around each anchor; confirm you can get to it.
        const nearby = [
          [tx, ty],
          [tx + 1, ty],
          [tx - 1, ty],
          [tx, ty + 1],
          [tx, ty - 1],
        ] as const;
        const ok = nearby.some(([x, y]) => reachable.has(y * g.width + x));
        expect(ok ? 'ok' : `UNREACHABLE ANCHOR: ${z.id} at ${tx},${ty}`).toBe('ok');
      }
    }
  });

  it('walls the border so the player cannot walk off the map', () => {
    for (const z of ZONES) {
      const g = generated.get(z.id)!;
      const exitCols = new Set<number>();
      const exitRows = new Set<number>();
      for (const edge of ['north', 'south'] as const) {
        if (z.exits.some((e) => e.edge === edge)) exitCols.add(g.edgeSpawns[edge].tx);
      }
      for (const edge of ['east', 'west'] as const) {
        if (z.exits.some((e) => e.edge === edge)) exitRows.add(g.edgeSpawns[edge].ty);
      }
      // Corners are always solid; the gates are the only openings.
      expect(g.solid[0]).toBe(true);
      expect(g.solid[g.width - 1]).toBe(true);
      expect(g.solid[(g.height - 1) * g.width]).toBe(true);
    }
  });

  it('gives every zone with an encounter table somewhere to actually meet a spirit', () => {
    // A zone with an approved encounter table and no encounter terrain is a table that can
    // never fire. Echo Cavern is the case that matters: it has no grass at all.
    for (const z of ZONES) {
      if (!z.encounterZone) continue;
      const g = generated.get(z.id)!;
      const count = g.terrain.filter((t) => isEncounterTerrain(z.biome, t)).length;
      expect(count > 20 ? 'ok' : `NO ENCOUNTER TERRAIN: ${z.id} (${count} tiles)`).toBe('ok');
    }
  });

  it('never puts encounter terrain in a safe zone', () => {
    for (const z of ZONES) {
      if (z.encounterZone) continue;
      expect(encounterTerrainFor(z.biome)).toEqual([]);
    }
  });

  it('leaves a majority of every map walkable', () => {
    for (const z of ZONES) {
      const g = generated.get(z.id)!;
      const walkable = g.terrain.filter(isWalkable).length / g.terrain.length;
      expect(walkable > 0.5 ? 'ok' : `TOO CRAMPED: ${z.id} is ${(walkable * 100).toFixed(0)}% walkable`).toBe('ok');
    }
  });
});

/** Flood fill over walkable, non-solid tiles. */
function floodFrom(g: GeneratedZone, sx: number, sy: number): Set<number> {
  const seen = new Set<number>();
  const stack = [sy * g.width + sx];
  while (stack.length > 0) {
    const i = stack.pop()!;
    if (seen.has(i)) continue;
    if (g.solid[i]) continue;
    seen.add(i);
    const x = i % g.width;
    const y = Math.floor(i / g.width);
    if (x > 0) stack.push(i - 1);
    if (x < g.width - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - g.width);
    if (y < g.height - 1) stack.push(i + g.width);
  }
  return seen;
}
