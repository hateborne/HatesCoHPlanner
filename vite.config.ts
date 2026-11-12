/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SERVERS } from './src/data/servers.ts';

/**
 * Give each game server's address (/HatesCoHPlanner/Homecoming/) a page of its own: a copy of the
 * built index.html, so GitHub Pages serves it (the dev and preview servers already answer any path
 * under the base with index.html). The page reads its server from the address (serverFromPath).
 */
function serverPages(): Plugin {
  return {
    name: 'server-pages',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const page = bundle['index.html'];
      if (!page || page.type !== 'asset') return this.error('index.html is missing from the build');
      for (const s of SERVERS) this.emitFile({ type: 'asset', fileName: `${s.path}/index.html`, source: page.source });
    },
  };
}

// Served from https://hateborne.github.io/HatesCoHPlanner/ so every asset URL is under this base.
export default defineConfig({
  base: '/HatesCoHPlanner/',
  plugins: [react(), serverPages()],
  // brotli-wasm locates its .wasm relative to its own module; pre-bundling breaks that in dev.
  optimizeDeps: { exclude: ['brotli-wasm'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
