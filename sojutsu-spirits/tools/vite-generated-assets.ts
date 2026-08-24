/**
 * Serves and ships `assets/generated/`.
 *
 * The atlases are build *output* of `npm run assets`, not source, so they do not belong in
 * `public/` where they would be indistinguishable from hand-authored files. This plugin keeps
 * them where the pipeline writes them and makes them available at the same URL in both dev and
 * production: `assets/generated/<atlas>.png`.
 *
 * It also fails the production build loudly if the atlases are missing, because a build that
 * silently ships a game with no art is worse than a build that stops.
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const URL_PREFIX = '/assets/generated/';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.webp': 'image/webp',
};

export function generatedAssets(rootDir: string): Plugin {
  const sourceDir = resolve(rootDir, 'assets/generated');

  return {
    name: 'sojutsu:generated-assets',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(URL_PREFIX)) return next();

        // Reject anything that tries to climb out of the asset directory.
        const rel = decodeURIComponent(url.slice(URL_PREFIX.length));
        if (rel.includes('..')) {
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }

        const file = join(sourceDir, rel);
        if (!existsSync(file) || !statSync(file).isFile()) return next();

        res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },

    closeBundle() {
      if (!existsSync(sourceDir)) {
        this.error(
          'assets/generated is missing. Run "npm run assets" before building — the game ' +
            'cannot ship without its atlases.',
        );
        return;
      }

      const outDir = resolve(rootDir, 'dist/assets/generated');
      mkdirSync(outDir, { recursive: true });

      let copied = 0;
      for (const name of readdirSync(sourceDir)) {
        const from = join(sourceDir, name);
        if (!statSync(from).isFile()) continue;
        copyFileSync(from, join(outDir, name));
        copied += 1;
      }

      if (copied === 0) {
        this.error('assets/generated is empty. Run "npm run assets".');
        return;
      }
      this.info?.(`sojutsu: shipped ${copied} generated asset file(s)`);
    },
  };
}
