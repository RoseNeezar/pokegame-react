import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The layering rule for `src/math`, enforced rather than promised.
 *
 * DESIGN.md §2.1 states that `src/core` and `src/math` never import Phaser, and says the rule is
 * held up by a unit test "so the rule cannot rot". No such test existed, which meant the three
 * properties the whole math layer is justified by — pure, seedable, replayable — were
 * conventions a single careless import could end, silently and without a failing build.
 *
 * Three invariants are checked here, each of which something in this layer's own documentation
 * already claims out loud:
 *
 * 1. **No Phaser, and no reaching down into the rendering layers.** `src/math` may import from
 *    `src/core`, from itself, and from the generated data. A question generator that touched a
 *    scene would make a rendering bug capable of being an arithmetic bug.
 * 2. **No `Math.random`.** DESIGN.md §8: every draw goes through the seeded `Rng`, which is what
 *    makes a battle replay from `(seed, inputs)` down to which question was asked. One
 *    `Math.random` in a template would break replay without breaking any other test.
 * 3. **No clock.** `session.ts` promises "the session computes the window and the caller reports
 *    elapsed time". A `Date.now()` here would make the layer untestable and would let a paused
 *    game drop a chain.
 *
 * The scan is textual on purpose: it needs no build step, and it fails on the import being
 * *written*, not on it being reached at runtime.
 */

const MATH_DIR = new URL('.', import.meta.url).pathname;
const SELF = 'purity.test.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

const FILES = sourceFiles(MATH_DIR);

/** Every module specifier the file imports or re-exports, in source order. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (m[1] !== undefined) found.push(m[1]);
  }
  return found;
}

/** Which layer a specifier resolves into, from the point of view of `src/math`. */
function layerOf(specifier: string): string {
  if (specifier.startsWith('.')) {
    const m = /\.\.\/(?:\.\.\/)*([a-z]+)\//.exec(specifier);
    return m?.[1] ?? 'math';
  }
  return `package:${specifier}`;
}

const ALLOWED_LAYERS = new Set(['math', 'core', 'data', 'package:vitest', 'package:node:fs', 'package:node:path']);

describe('src/math purity (DESIGN.md §2.1 and §8)', () => {
  it('scans every file in the layer', () => {
    // Guards the guard: a broken walk would make every test below vacuously true.
    expect(FILES.length).toBeGreaterThanOrEqual(12);
    const names = FILES.map((f) => relative(MATH_DIR, f));
    expect(names).toContain('chain.ts');
    expect(names).toContain('question.ts');
    expect(names).toContain('session.ts');
    expect(names).toContain(join('curriculum', 'index.ts'));
  });

  it('never imports phaser, and never reaches into the rendering layers', () => {
    const offences: string[] = [];
    for (const file of FILES) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        const layer = layerOf(specifier);
        if (!ALLOWED_LAYERS.has(layer)) {
          offences.push(`${relative(MATH_DIR, file)} imports ${specifier} (${layer})`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('draws every random number from the seeded Rng, never Math.random', () => {
    const offences: string[] = [];
    for (const file of FILES) {
      // This file names the forbidden call in order to forbid it, so it excludes itself.
      if (file.endsWith(SELF)) continue;
      const source = readFileSync(file, 'utf8').replace(/`[^`]*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      if (/\bMath\s*\.\s*random\b/.test(source)) offences.push(relative(MATH_DIR, file));
    }
    expect(offences).toEqual([]);
  });

  it('reads no clock — the caller reports elapsed time', () => {
    const offences: string[] = [];
    for (const file of FILES) {
      if (file.endsWith(SELF)) continue;
      const source = readFileSync(file, 'utf8').replace(/`[^`]*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      if (/\bDate\s*\.\s*now\b|\bperformance\s*\.\s*now\b|\bnew\s+Date\b/.test(source)) {
        offences.push(relative(MATH_DIR, file));
      }
    }
    expect(offences).toEqual([]);
  });
});
