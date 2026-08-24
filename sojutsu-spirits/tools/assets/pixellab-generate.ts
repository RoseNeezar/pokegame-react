/**
 * `npm run assets:generate` — the PixelLab layer.
 *
 * Fills `assets/source/generated/`, a *committed* source tier that the atlas builder consumes.
 * Committing generated PNGs rather than regenerating them per build is what makes the art
 * reproducible: quota is spent once, by one person, and every later clone and CI run gets the
 * exact same pixels for free.
 *
 * Three properties this step is built around:
 *
 *  • **Idempotent.** A job whose output file already exists is skipped before the cache is even
 *    consulted. Re-running costs nothing, so it is safe to run after adding one prompt.
 *  • **Skippable.** No API key, no network, `--dry-run`: the step reports what it *would* do and
 *    exits 0. `npm run assets` then runs against whatever exists. Nothing downstream requires
 *    this step to have been run at all.
 *  • **Economical.** Requests are content-addressed in `tools/.cache/pixellab/` (see
 *    `pixellab-client.ts`), so an interrupted run resumes without re-spending, and a file deleted
 *    by hand comes back from cache rather than from quota.
 *
 * What it generates:
 *   a) the 24 line-Base species that ship as 64×64 five-colour placeholders (DESIGN.md §7.1),
 *      re-rendered at 256×256 from the catalogue's own blurb plus the species' aspects;
 *   b) terrain and props for the three Part-One regions;
 *   c) the pieces of control-deck furniture that read as objects rather than as geometry.
 *
 * Which species count as placeholders is decided by *measuring the source files*, not by a
 * hard-coded dex list — replace one of the 64×64 originals with real art and it silently drops
 * out of the set.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SpeciesDef } from '../../src/core/types.ts';
import { dexKey, generationJobs, PLACEHOLDER_SOURCE_EDGE, type GenerationJob } from './asset-plan.ts';
import { decodePng } from './pixel-ops.ts';
import { loadPixelLabConfig, mapWithConcurrency, PixelLabClient } from './pixellab-client.ts';

/**
 * Four in flight. A generation takes about fifteen seconds, so this turns a ~50-job run from
 * twelve minutes into three without pushing the account's rate limit.
 */
const CONCURRENCY = 4;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

export interface GenerateOptions {
  readonly repoRoot: string;
  readonly outDir?: string;
  readonly cacheDir?: string;
  /** Report the plan and exit without contacting the API. */
  readonly dryRun?: boolean;
  /** Restrict to jobs whose file path contains this substring. */
  readonly filter?: string;
}

export interface GenerateReport {
  readonly planned: readonly string[];
  readonly skipped: readonly string[];
  readonly written: readonly string[];
  readonly failed: ReadonlyArray<{ file: string; reason: string }>;
  readonly generations: number;
  readonly cacheHits: number;
}

/**
 * The species whose supplied dex plate is one of the 64×64 five-colour placeholders.
 *
 * Measured, not listed. `reference/` is the authority on what the shipped art actually is.
 */
export async function findPlaceholderSpecies(
  species: readonly SpeciesDef[],
  referenceDir: string,
): Promise<SpeciesDef[]> {
  const out: SpeciesDef[] = [];
  for (const s of species) {
    const file = path.join(referenceDir, 'monsterdex', 'dex', `${dexKey(s)}.png`);
    if (!existsSync(file)) {
      out.push(s);
      continue;
    }
    const img = await decodePng(await readFile(file));
    if (img.width <= PLACEHOLDER_SOURCE_EDGE && img.height <= PLACEHOLDER_SOURCE_EDGE) out.push(s);
  }
  return out;
}

export async function generateSourceArt(options: GenerateOptions): Promise<GenerateReport> {
  const repoRoot = options.repoRoot;
  const outDir = options.outDir ?? path.join(repoRoot, 'assets', 'source', 'generated');
  const cacheDir = options.cacheDir ?? path.join(repoRoot, 'tools', '.cache', 'pixellab');
  const referenceDir = path.join(repoRoot, 'reference');

  const species = JSON.parse(
    await readFile(path.join(repoRoot, 'src', 'data', 'generated', 'species.json'), 'utf8'),
  ) as SpeciesDef[];

  const regenerate = await findPlaceholderSpecies(species, referenceDir);
  let jobs = generationJobs(regenerate);
  if (options.filter) jobs = jobs.filter((j) => j.file.includes(options.filter!));

  const planned: GenerationJob[] = [];
  const skipped: string[] = [];
  for (const job of jobs) {
    if (existsSync(path.join(outDir, job.file))) skipped.push(job.file);
    else planned.push(job);
  }

  const config = loadPixelLabConfig(repoRoot);
  if (options.dryRun || !config) {
    return {
      planned: planned.map((j) => j.file),
      skipped,
      written: [],
      failed: config
        ? []
        : planned.map((j) => ({ file: j.file, reason: 'no PIXELLAB_API_KEY configured' })),
      generations: 0,
      cacheHits: 0,
    };
  }

  const client = new PixelLabClient(config, cacheDir);
  const written: string[] = [];
  const failed: Array<{ file: string; reason: string }> = [];

  await mapWithConcurrency(planned, CONCURRENCY, async (job) => {
    const target = path.join(outDir, job.file);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      const result = await client.generate({
        description: job.prompt,
        image_size: { width: job.width, height: job.height },
      });
      await writeFile(target, result.png);
      written.push(job.file);
      console.info(`${result.cached ? 'cache' : 'gen  '}  ${job.file}`);
    } catch (error) {
      const reason = (error as Error).message;
      failed.push({ file: job.file, reason });
      console.warn(`fail   ${job.file}: ${reason}`);
    }
  });

  return {
    planned: planned.map((j) => j.file),
    skipped,
    written: written.sort(),
    failed,
    generations: client.stats.generations,
    cacheHits: client.stats.cacheHits,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filterFlag = args.find((a) => a.startsWith('--only='));

  const report = await generateSourceArt({
    repoRoot: REPO_ROOT,
    dryRun,
    ...(filterFlag ? { filter: filterFlag.slice('--only='.length) } : {}),
  });

  console.info('');
  console.info(`planned ${report.planned.length}  skipped(existing) ${report.skipped.length}`);
  console.info(`written ${report.written.length}  generations spent ${report.generations}  cache hits ${report.cacheHits}`);
  if (report.failed.length > 0) {
    console.warn(`failed ${report.failed.length}:`);
    for (const f of report.failed) console.warn(`  ${f.file}: ${f.reason}`);
  }
  if (dryRun) console.info('(dry run — nothing was requested)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
