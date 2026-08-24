/**
 * Browser smoke verification.
 *
 * Drives the *real production build* in Chromium — not a mock, not a unit test double — and
 * proves the three binding modes actually render: exploration, math combat, and Finish. It
 * screenshots each one so the output can be compared against `reference/visual` by eye, and it
 * fails on any console error or unhandled rejection, which is the cheapest possible guard
 * against a scene that throws on entry.
 *
 *   npm run build && npm run smoke
 */
import { chromium, type ConsoleMessage, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYPAD } from '../../src/game/layout.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'verify-output');
const PORT = 4188;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

/** A static server over dist/, so the harness tests exactly what would be deployed. */
function serve(): Promise<() => Promise<void>> {
  const server = createServer(async (req, res) => {
    try {
      const url = (req.url ?? '/').split('?')[0]!;
      const rel = url === '/' ? 'index.html' : decodeURIComponent(url.replace(/^\//, ''));
      if (rel.includes('..')) {
        res.statusCode = 403;
        res.end();
        return;
      }
      const file = join(DIST, rel);
      const body = await readFile(file);
      res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  return new Promise((ok) => {
    server.listen(PORT, '127.0.0.1', () =>
      ok(() => new Promise<void>((done) => server.close(() => done()))),
    );
  });
}

interface Problem {
  readonly where: string;
  readonly detail: string;
}

const problems: Problem[] = [];
const steps: string[] = [];

function step(text: string): void {
  steps.push(text);
  console.log(`  · ${text}`);
}

/** Reads a fact out of the running game rather than guessing from pixels. */
async function probe<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(fn) as Promise<T>;
}

async function activeScenes(page: Page): Promise<string[]> {
  return probe<string[]>(
    page,
    `window.__SOJUTSU__.scene.getScenes(true).map(s => s.scene.key)`,
  );
}

/** Polls a boolean expression inside the page until it is true or the deadline passes. */
async function waitFor(page: Page, expr: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe<boolean>(page, `!!(${expr})`)) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function waitForScene(page: Page, key: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await activeScenes(page)).includes(key)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  step(`captured ${name}.png`);
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('✗ dist/ is missing. Run "npm run build" first.');
    process.exitCode = 1;
    return;
  }
  await mkdir(OUT, { recursive: true });

  const stop = await serve();
  const browser = await chromium.launch({ executablePath: findChromium() });

  // A real phone viewport — this game is portrait-only and that is the shape it must work in.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') problems.push({ where: 'console', detail: msg.text() });
  });
  page.on('pageerror', (err) => problems.push({ where: 'pageerror', detail: err.message }));

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

    if (!(await waitForScene(page, 'Title'))) {
      problems.push({ where: 'boot', detail: 'Title scene never became active' });
    } else {
      step('booted to Title');
      await page.waitForTimeout(600);
      await shot(page, '01-title');
    }

    // Missing atlases are reported by Boot into the registry; surface them as a real finding.
    const missing = await probe<string[]>(page, `window.__SOJUTSU__.registry.get('missingAssets') || []`);
    if (missing.length > 0) {
      problems.push({ where: 'assets', detail: `atlases failed to load: ${missing.join(', ')}` });
    } else {
      step('all atlases loaded');
    }

    /* ---------------------------------------------------- starter choice */

    await tapText(page, 'BEGIN');
    await page.waitForTimeout(700);
    await shot(page, '02-starter-choice');

    // Pick the first starter card. Cards are laid out from y≈160 in logical space.
    await tapLogical(page, 270, 275);
    await page.waitForTimeout(2800);

    if (!(await waitForScene(page, 'World'))) {
      problems.push({ where: 'world', detail: 'World scene never became active after starter choice' });
    } else {
      step('entered the World');
    }
    await page.waitForTimeout(900);
    await shot(page, '03-exploration');

    /* -------------------------------------------------------- exploration */

    const worldFacts = await probe<{ zone: string; party: number; deckMode: string }>(
      page,
      `(() => {
         const g = window.__SOJUTSU__;
         const w = g.scene.getScene('World');
         const s = g.registry.get('state');
         return { zone: s.zone, party: s.party.length, deckMode: g.registry.get('deck').getMode() };
       })()`,
    );
    step(`zone=${worldFacts.zone} party=${worldFacts.party} deck=${worldFacts.deckMode}`);
    if (worldFacts.party !== 1) {
      problems.push({ where: 'starter', detail: `expected 1 spirit in the party, got ${worldFacts.party}` });
    }
    if (worldFacts.deckMode !== 'explore') {
      problems.push({ where: 'deck', detail: `expected explore deck, got ${worldFacts.deckMode}` });
    }

    // Drag the joystick and confirm the player actually moves.
    const before = await probe<{ x: number; y: number }>(
      page,
      `(() => { const a = window.__SOJUTSU__.scene.getScene('World').getPlayerActor(); return { x: a.x, y: a.y }; })()`,
    );
    await dragLogical(page, 122, 850, 122, 760, 900);
    const after = await probe<{ x: number; y: number }>(
      page,
      `(() => { const a = window.__SOJUTSU__.scene.getScene('World').getPlayerActor(); return { x: a.x, y: a.y }; })()`,
    );
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    if (moved < 4) {
      problems.push({ where: 'movement', detail: `joystick drag moved the player only ${moved.toFixed(1)}px` });
    } else {
      step(`joystick moved the player ${moved.toFixed(0)}px`);
    }
    await shot(page, '04-exploration-moved');

    /* -------------------------------------------------------- math combat */

    // Force an encounter rather than waiting on RNG — the harness is testing the mode, not luck.
    await probe(
      page,
      `(() => {
         const w = window.__SOJUTSU__.scene.getScene('World');
         w.startWildBattle();
         return true;
       })()`,
    );
    if (!(await waitForScene(page, 'Battle'))) {
      problems.push({ where: 'battle', detail: 'Battle scene never became active' });
    } else {
      step('battle started in-world');
    }
    await page.waitForTimeout(1400);
    await shot(page, '05-battle-move-select');

    const deckInBattle = await probe<string>(page, `window.__SOJUTSU__.registry.get('deck').getMode()`);
    if (deckInBattle !== 'math') {
      problems.push({ where: 'deck', detail: `battle deck should be "math", got "${deckInBattle}"` });
    }

    // Pick the first move; the question strip and keypad should appear.
    await waitFor(
      page,
      `window.__SOJUTSU__.scene.getScene('Battle').phase === 'choosing'`,
      8000,
    );
    await tapLogical(page, 140, 800);
    await waitFor(page, `window.__SOJUTSU__.scene.getScene('Battle').phase === 'question'`, 5000);
    await page.waitForTimeout(350);
    await shot(page, '06-math-combat');

    const question = await probe<{ prompt: string; answer: number } | null>(
      page,
      `(() => {
         const b = window.__SOJUTSU__.scene.getScene('Battle');
         const q = b && b.session ? b.session.question : null;
         return q ? { prompt: q.prompt, answer: q.answer } : null;
       })()`,
    );
    if (!question) {
      problems.push({ where: 'math', detail: 'no question was posed after choosing a move' });
    } else {
      step(`question posed: "${question.prompt}" (answer ${question.answer})`);
    }

    /* ------------------------------------------------------------- finish */

    // Answer correctly via the on-screen keypad, then drive the fight to the Finish window.
    if (question) {
      const chainBefore = await probe<number>(
        page,
        `window.__SOJUTSU__.scene.getScene('Battle').battle.state.chain`,
      );
      await typeAnswer(page, question.answer);
      await waitFor(
        page,
        `window.__SOJUTSU__.scene.getScene('Battle').phase !== 'question'`,
        6000,
      );
      const chainAfter = await probe<number>(
        page,
        `window.__SOJUTSU__.scene.getScene('Battle').battle.state.chain`,
      );
      if (chainAfter <= chainBefore) {
        problems.push({
          where: 'math',
          detail: `a correct answer did not advance the chain (${chainBefore} -> ${chainAfter})`,
        });
      } else {
        step(`correct answer advanced the chain to ${chainAfter}`);
      }
      await page.waitForTimeout(900);
      await shot(page, '07-after-solve');
    }

    // Drop the foe so the Finish window opens deterministically.
    await probe(
      page,
      `(() => {
         const b = window.__SOJUTSU__.scene.getScene('Battle');
         b.battle.state.foe.instance.currentHp = 1;
         return true;
       })()`,
    );

    const reachedFinish = await driveToFinish(page);
    if (!reachedFinish) {
      const why = await probe<unknown>(
        page,
        `(() => {
           const b = window.__SOJUTSU__.scene.getScene('Battle');
           if (!b) return { battleScene: 'stopped' };
           return {
             ui: b.phase,
             engine: b.battle ? b.battle.state.phase : 'none',
             foeHp: b.battle ? b.battle.state.foe.instance.currentHp : -1,
             allyHp: b.battle ? b.battle.state.ally.instance.currentHp : -1,
             log: b.battle ? b.battle.state.log.slice(-6).map((l) => l.text) : [],
           };
         })()`,
      );
      problems.push({
        where: 'finish',
        detail: `never reached the Finish window — ${JSON.stringify(why)}`,
      });
    } else {
      step('reached the Finish window');
      // The deck morphs on the overlay's own timeline, not the engine's, so wait for the
      // presentation to catch up rather than asserting against a frame that has not run yet.
      const deckSwitched = await waitFor(
        page,
        `window.__SOJUTSU__.registry.get('deck').getMode() === 'finish'`,
        6000,
      );
      await page.waitForTimeout(500);
      await shot(page, '08-finish-mode');
      if (!deckSwitched) {
        problems.push({ where: 'finish', detail: 'deck never morphed to the Finish controls' });
      }

      const finishDeck = await probe<string>(page, `window.__SOJUTSU__.registry.get('deck').getMode()`);
      if (finishDeck !== 'finish') {
        problems.push({
          where: 'finish',
          detail: `Finish deck should revert to the exploration controls ("finish"), got "${finishDeck}"`,
        });
      } else {
        step('deck reverted to the exploration controls, as the Finish reference shows');
      }
    }

    /* --------------------------------------------------------------- menu */

    await probe(page, `(() => { const b = window.__SOJUTSU__.scene.getScene('Battle'); b.onFinishTap(); return true; })()`);
    // Wait for the battle overlay to actually close and hand control back to the world.
    const returned = await waitFor(
      page,
      `!window.__SOJUTSU__.scene.isActive('Battle') && window.__SOJUTSU__.scene.getScene('World').busy === false`,
      8000,
    );
    if (!returned) {
      problems.push({ where: 'battle', detail: 'the battle overlay never returned control to the world' });
    } else {
      step('battle closed and returned control to the world');
    }
    await probe(page, `(() => { window.__SOJUTSU__.scene.getScene('World').openMenu(); return true; })()`);
    if (await waitForScene(page, 'Menu', 4000)) {
      await page.waitForTimeout(500);
      await shot(page, '09-menu-party');
      await tapLogical(page, 405, 26); // RECORD tab
      await page.waitForTimeout(400);
      await shot(page, '10-menu-record');
      step('menu and report card render');
    } else {
      problems.push({ where: 'menu', detail: 'Menu scene never opened' });
    }

    /* -------------------------------------------------------- the shrine */

    // The single most important progression path in the game: the road past a shrine is
    // sigil-locked, the sigil opens it, and the curriculum ceiling rises with it.
    await probe(page, `(() => { window.__SOJUTSU__.scene.getScene('Menu').scene.stop(); return true; })()`);
    await page.waitForTimeout(300);

    await probe(
      page,
      `(() => {
         const g = window.__SOJUTSU__;
         g.scene.getScene('World').scene.restart({
           state: g.registry.get('state'),
           zone: 'shrine-thicket',
         });
         return true;
       })()`,
    );
    await waitFor(page, `window.__SOJUTSU__.registry.get('state').zone === 'shrine-thicket'`, 8000);
    await page.waitForTimeout(900);

    const gateLocked = `(() => {
       const w = window.__SOJUTSU__.scene.getScene('World');
       const exit = w.zone.exits.find((e) => e.requiresSigils);
       return !!exit && !w.canPass(exit);
     })()`;

    const sigilsBefore = await probe<number[]>(
      page,
      `window.__SOJUTSU__.registry.get('state').flags.sigils`,
    );
    const lockedBefore = await probe<boolean>(page, gateLocked);
    if (sigilsBefore.length !== 0 || !lockedBefore) {
      problems.push({
        where: 'shrine',
        detail: `the road past Shrine 1 should start locked (sigils=${JSON.stringify(sigilsBefore)}, locked=${lockedBefore})`,
      });
    } else {
      step('the road past Shrine 1 starts sigil-locked');
    }
    await shot(page, '14-shrine');

    await probe(
      page,
      `(() => { window.__SOJUTSU__.registry.get('state').flags.sigils.push(1); return true; })()`,
    );
    if (await probe<boolean>(page, gateLocked)) {
      problems.push({ where: 'shrine', detail: 'the road past Shrine 1 is still locked after Sigil 1' });
    } else {
      step('Sigil 1 opens the road to Riverside');
    }

    const ceiling = await probe<number>(
      page,
      `(() => {
         const n = window.__SOJUTSU__.registry.get('state').flags.sigils.length;
         return n === 0 ? 1 : n === 1 ? 2 : 3;
       })()`,
    );
    if (ceiling !== 2) {
      problems.push({ where: 'curriculum', detail: `expected the ceiling to rise to Tier 2, got ${ceiling}` });
    } else {
      step('the curriculum ceiling rose to Tier 2');
    }

    /* ------------------------------------------------------- other biomes */

    // The starting route is one biome out of eight. A town, a shrine and a cavern each use a
    // different terrain map, prop set and encounter rule, and each is a chance for a zone to
    // throw on entry — which the console listener would catch.
    for (const [zoneId, shotName] of [
      ['rantings-rest', '11-town'],
      ['shrine-thicket', '12-shrine'],
      ['echo-cavern', '13-cavern'],
    ] as const) {
      await probe(
        page,
        `(() => {
           const g = window.__SOJUTSU__;
           g.scene.getScene('World').scene.restart({
             state: g.registry.get('state'),
             zone: ${JSON.stringify(zoneId)},
           });
           return true;
         })()`,
      );
      const arrived = await waitFor(
        page,
        `window.__SOJUTSU__.registry.get('state').zone === ${JSON.stringify(zoneId)}` +
          ` && window.__SOJUTSU__.scene.isActive('World')`,
        8000,
      );
      if (!arrived) {
        problems.push({ where: 'zones', detail: `could not enter ${zoneId}` });
        continue;
      }
      await page.waitForTimeout(1200);
      await shot(page, shotName);
      step(`rendered ${zoneId}`);
    }
  } finally {
    await context.close();
    await browser.close();
    await stop();
  }

  await writeFile(
    join(OUT, 'report.json'),
    `${JSON.stringify({ steps, problems, at: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );

  console.log('');
  if (problems.length === 0) {
    console.log(`✓ smoke passed — ${steps.length} checks, screenshots in verify-output/`);
    return;
  }
  console.error(`✗ smoke found ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  • [${p.where}] ${p.detail}`);
  process.exitCode = 1;
}

/* --------------------------------------------------------------- helpers */

/**
 * Locates the pre-installed Chromium.
 *
 * The image ships a pinned Chromium build under PLAYWRIGHT_BROWSERS_PATH, and the installed
 * @playwright/test may expect a different build number. Rather than downloading a second
 * browser (the image explicitly forbids `playwright install`), point launch() at whatever real
 * binary is on disk.
 */
function findChromium(): string | undefined {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const candidates: string[] = [];
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith('chromium')) continue;
    candidates.push(
      join(base, entry, 'chrome-linux', 'chrome'),
      join(base, entry, 'chrome-linux', 'headless_shell'),
    );
  }
  // Prefer full Chromium over the headless shell — the game needs WebGL.
  candidates.sort((a, b) => (a.endsWith('chrome') ? -1 : 1) - (b.endsWith('chrome') ? -1 : 1));
  return candidates.find((c) => existsSync(c));
}

/**
 * Converts logical canvas coordinates (540 × 1170) to page coordinates.
 *
 * The FIT scaler letterboxes, so the canvas is not the viewport; the harness has to ask the
 * running game where the canvas actually is rather than assuming.
 */
async function toPage(page: Page, lx: number, ly: number): Promise<{ x: number; y: number }> {
  return probe<{ x: number; y: number }>(
    page,
    `(() => {
       const c = document.querySelector('#game canvas');
       const r = c.getBoundingClientRect();
       const g = window.__SOJUTSU__;
       return {
         x: r.left + (${lx} / g.scale.width) * r.width,
         y: r.top + (${ly} / g.scale.height) * r.height,
       };
     })()`,
  );
}

async function tapLogical(page: Page, lx: number, ly: number): Promise<void> {
  const p = await toPage(page, lx, ly);
  await page.mouse.click(p.x, p.y);
}

async function dragLogical(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  holdMs: number,
): Promise<void> {
  const a = await toPage(page, fromX, fromY);
  const b = await toPage(page, toX, toY);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** Finds a text object by its content and taps its centre. */
async function tapText(page: Page, needle: string): Promise<void> {
  const pos = await probe<{ x: number; y: number } | null>(
    page,
    `(() => {
       for (const scene of window.__SOJUTSU__.scene.getScenes(true)) {
         for (const o of scene.children.list) {
           if (o.type === 'Text' && typeof o.text === 'string' && o.text.includes(${JSON.stringify(needle)})) {
             return { x: o.x, y: o.y };
           }
         }
         const stack = [...scene.children.list];
         while (stack.length) {
           const o = stack.pop();
           if (o.list) stack.push(...o.list);
           if (o.type === 'Text' && typeof o.text === 'string' && o.text.includes(${JSON.stringify(needle)})) {
             return { x: o.x, y: o.y };
           }
         }
       }
       return null;
     })()`,
  );
  if (!pos) {
    problems.push({ where: 'ui', detail: `could not find a button labelled "${needle}"` });
    return;
  }
  await tapLogical(page, pos.x, pos.y);
}

/**
 * Types a number on the in-game keypad — the same taps a player would make.
 *
 * Key centres are computed from the game's own layout constants rather than hardcoded. They
 * were hardcoded once, drifted by a row, and the harness spent a whole run reporting that
 * questions were being answered while every tap missed the pad and the timer ran out instead.
 * A verification harness that cannot fail loudly is worse than none.
 */
function keyCentre(row: number, col: number): { x: number; y: number } {
  return {
    x: KEYPAD.origin.x + col * (KEYPAD.keyWidth + KEYPAD.gapX) + KEYPAD.keyWidth / 2,
    y: KEYPAD.origin.y + row * (KEYPAD.keyHeight + KEYPAD.gapY) + KEYPAD.keyHeight / 2,
  };
}

/** Same order as ControlDeck.KEYS: 1-9, then backspace, 0, OK. */
const KEY_POSITION: Record<string, { x: number; y: number }> = {
  '1': keyCentre(0, 0),
  '2': keyCentre(0, 1),
  '3': keyCentre(0, 2),
  '4': keyCentre(1, 0),
  '5': keyCentre(1, 1),
  '6': keyCentre(1, 2),
  '7': keyCentre(2, 0),
  '8': keyCentre(2, 1),
  '9': keyCentre(2, 2),
  '\u232b': keyCentre(3, 0),
  '0': keyCentre(3, 1),
  OK: keyCentre(3, 2),
};

async function typeAnswer(page: Page, answer: number): Promise<void> {
  for (const d of String(answer).split('')) {
    const p = KEY_POSITION[d];
    if (!p) continue;
    await tapLogical(page, p.x, p.y);
    await page.waitForTimeout(80);
  }
  const ok = KEY_POSITION['OK']!;
  await tapLogical(page, ok.x, ok.y);
}

/**
 * Keeps taking turns until the battle reaches the Finish window.
 *
 * The engine and the presentation run on different clocks: the core battle can be back at
 * `awaiting-command` while the overlay is still playing the banner from the last turn. Tapping
 * during that gap does nothing and silently burns an attempt, so every step waits for the
 * *overlay* to say it is ready rather than for the engine.
 */
async function driveToFinish(page: Page): Promise<boolean> {
  const overlayPhase = `(() => { const b = window.__SOJUTSU__.scene.getScene('Battle'); return b ? b.phase : 'gone'; })()`;
  const enginePhase = `(() => { const b = window.__SOJUTSU__.scene.getScene('Battle'); return b && b.battle ? b.battle.state.phase : 'gone'; })()`;

  for (let i = 0; i < 16; i++) {
    if (await waitFor(page, `${overlayPhase} === 'finish'`, 250)) return true;

    const phase = await probe<string>(page, enginePhase);
    if (phase === 'gone' || phase === 'lost' || phase === 'won') return false;

    // Wait for the move list to actually be on screen before tapping it.
    if (!(await waitFor(page, `${overlayPhase} === 'choosing'`, 6000))) {
      if (await waitFor(page, `${overlayPhase} === 'finish'`, 3000)) return true;
      continue;
    }

    await tapLogical(page, 140, 800);
    if (!(await waitFor(page, `${overlayPhase} === 'question'`, 4000))) continue;

    const q = await probe<{ answer: number } | null>(
      page,
      `(() => {
         const b = window.__SOJUTSU__.scene.getScene('Battle');
         const q = b && b.session ? b.session.question : null;
         return q ? { answer: q.answer } : null;
       })()`,
    );
    if (q) await typeAnswer(page, q.answer);
    await waitFor(page, `${overlayPhase} !== 'question'`, 5000);
  }
  return false;
}

void main();
