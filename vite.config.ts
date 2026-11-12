/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The published page's Content-Security-Policy. GitHub Pages can't send headers, so it goes in a
// meta tag. Everything the planner loads is its own (scripts, data, art, fonts, sounds): any other
// script, plugin, base URL or form target is refused, so injected markup can't reach outside.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'", // brotli-wasm compiles its WebAssembly (Mids codes)
  "style-src 'self' 'unsafe-inline'", // React style props
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** The CSP meta tag, in built pages only: the dev server injects inline scripts for hot reload. */
const cspMeta: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
};

// Served from https://hateborne.github.io/HatesCoHPlanner/ so every asset URL is under this base.
export default defineConfig({
  base: '/HatesCoHPlanner/',
  plugins: [react(), cspMeta],
  // brotli-wasm locates its .wasm relative to its own module; pre-bundling breaks that in dev.
  optimizeDeps: { exclude: ['brotli-wasm'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
