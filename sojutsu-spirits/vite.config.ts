import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { generatedAssets } from './tools/vite-generated-assets.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [generatedAssets(ROOT)],
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
