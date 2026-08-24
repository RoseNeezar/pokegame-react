/**
 * PixelLab REST client: content-addressed cache, bounded concurrency, backoff.
 *
 * The API is quota-based, so the design constraint is not throughput — it is *never spending a
 * generation twice*. Three things enforce that:
 *
 *  1. **The cache is keyed by the request, not by the filename.** A SHA-256 of the exact JSON
 *     body means an identical prompt at an identical size is a disk read, whatever file it is
 *     destined for. Rename an asset, re-run, spend nothing. Change one word of a prompt and you
 *     get a new key — which is the point: the prompt *is* the source, so editing it should cost
 *     a generation and nothing else should.
 *  2. **The cache lives outside the repo's output.** `tools/.cache/` is gitignored, so a wiped
 *     cache costs quota but never corrupts what ships; `assets/source/generated/` is committed,
 *     so in practice a fresh clone regenerates nothing at all.
 *  3. **Concurrency is capped and 429/5xx retries back off.** A generation takes ~15 s; four in
 *     flight is enough to keep the wall clock sane without tripping the rate limiter.
 *
 * The API key is read from `.env.local` (gitignored) or the environment, is never logged, and is
 * never placed in a URL — it goes in the `Authorization` header only, so it cannot leak into a
 * proxy access log or a cache filename.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface PixelLabConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
}

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface GenerateRequest {
  readonly description: string;
  readonly image_size: ImageSize;
}

const DEFAULT_BASE_URL = 'https://api.pixellab.ai/v1';

/**
 * Reads `.env.local` without a dotenv dependency. Returns null when no key is configured, which
 * is the signal for the generator to skip cleanly rather than fail — an offline contributor must
 * still be able to run the rest of the pipeline.
 */
export function loadPixelLabConfig(repoRoot: string): PixelLabConfig | null {
  const fromEnv = process.env.PIXELLAB_API_KEY;
  const env = readEnvFile(path.join(repoRoot, '.env.local'));
  const apiKey = fromEnv ?? env.PIXELLAB_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (process.env.PIXELLAB_BASE_URL ?? env.PIXELLAB_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

/** Content address of a request. Derived from the body alone — never from the key. */
export function requestKey(endpoint: string, body: GenerateRequest): string {
  return createHash('sha256').update(`${endpoint}\n${JSON.stringify(body)}`).digest('hex');
}

export interface GenerateResult {
  readonly png: Buffer;
  readonly cached: boolean;
}

export interface ClientStats {
  /** Requests actually sent to the API — i.e. quota spent. */
  generations: number;
  cacheHits: number;
  retries: number;
}

export class PixelLabClient {
  readonly stats: ClientStats = { generations: 0, cacheHits: 0, retries: 0 };

  constructor(
    private readonly config: PixelLabConfig,
    private readonly cacheDir: string,
  ) {
    mkdirSync(this.cacheDir, { recursive: true });
  }

  /** Cache-first generation. The cache is consulted before any network work is even considered. */
  async generate(body: GenerateRequest): Promise<GenerateResult> {
    const endpoint = '/generate-image-pixflux';
    const key = requestKey(endpoint, body);
    const cached = path.join(this.cacheDir, `${key}.png`);
    if (existsSync(cached)) {
      this.stats.cacheHits++;
      return { png: await readFile(cached), cached: true };
    }

    const png = await this.post(endpoint, body);
    writeFileSync(cached, png);
    // The sidecar records what produced the blob so a stale cache is auditable by hand.
    writeFileSync(
      path.join(this.cacheDir, `${key}.json`),
      `${JSON.stringify({ endpoint, body }, null, 2)}\n`,
      'utf8',
    );
    this.stats.generations++;
    return { png, cached: false };
  }

  private async post(endpoint: string, body: GenerateRequest): Promise<Buffer> {
    const url = `${this.config.baseUrl}${endpoint}`;
    let delay = 2000;
    let lastError = '';

    for (let attempt = 0; attempt < 5; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (error) {
        lastError = `network error: ${(error as Error).message}`;
        this.stats.retries++;
        await sleep(delay);
        delay *= 2;
        continue;
      }

      if (response.ok) {
        const json = (await response.json()) as { image?: { base64?: string } };
        const base64 = json.image?.base64;
        if (!base64) throw new Error('PixelLab returned no image payload');
        return Buffer.from(base64, 'base64');
      }

      // 4xx other than 429 will never succeed on retry — fail fast so a bad prompt is obvious.
      if (response.status !== 429 && response.status < 500) {
        const text = await response.text();
        throw new Error(`PixelLab ${response.status}: ${text.slice(0, 400)}`);
      }

      lastError = `HTTP ${response.status}`;
      const retryAfter = Number(response.headers.get('retry-after'));
      this.stats.retries++;
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
      delay *= 2;
    }

    throw new Error(`PixelLab request failed after 5 attempts (${lastError})`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving result order.
 *
 * Written by hand rather than pulled in: it is fifteen lines, and the alternative is a runtime
 * dependency in a build step that already has exactly one.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });

  await Promise.all(runners);
  return results;
}
