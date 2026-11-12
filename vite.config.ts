/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { notFoundRedirect, SERVERS } from './src/data/servers.ts';

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

/**
 * The site's 404 page (GitHub Pages serves 404.html for any address it has no file for). A server
 * address in another case or with more after it ("/HatesCoHPlanner/homecoming/") goes on to that
 * server's page with its query and #b= code; anything else gets a short "not found" page with a
 * link to the planner. The redirect is notFoundRedirect itself, written in inline and allowed by its
 * hash alone (the page's own Content-Security-Policy).
 *
 * @param base The site base ("/HatesCoHPlanner/").
 * @return The page's HTML.
 */
function notFoundHtml(base: string): string {
  const paths = SERVERS.map((s) => s.path);
  const fn = notFoundRedirect.toString();
  const script = `(function(){var to=(${fn})(location.pathname,${JSON.stringify(base)},${JSON.stringify(paths)});if(to)location.replace(to+location.search+location.hash);})();`;
  const hash = createHash('sha256').update(script).digest('base64');
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script>${script}</script>
    <link rel="icon" type="image/png" href="${base}favicon.png" />
    <title>Page not found - Hate's CoH Planner</title>
  </head>
  <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000314;color:#cfe8ff;font-family:Verdana,sans-serif;text-align:center">
    <div>
      <h1 style="color:#ffd200;font-size:28px">Page not found</h1>
      <p>This address isn't part of Hate's CoH Planner.</p>
      <p><a href="${base}" style="color:#4f94ff">Open the planner</a></p>
    </div>
  </body>
</html>
`;
}

/**
 * Write 404.html into the build, after checking that the redirect it carries runs on its own (as
 * the page runs it) and sends a known case variant to the right page.
 */
function notFoundPage(): Plugin {
  let base = '/';
  return {
    name: 'not-found-page',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    generateBundle() {
      const own = SERVERS[0]!.path;
      const run = new Function(`return (${notFoundRedirect.toString()})`)() as typeof notFoundRedirect;
      if (run(`${base}${own.toLowerCase()}/x`, base, [own]) !== `${base}${own}/` || run(`${base}${own}/`, base, [own]) !== null) {
        return this.error('the 404 page redirect does not run on its own');
      }
      this.emitFile({ type: 'asset', fileName: '404.html', source: notFoundHtml(base) });
    },
  };
}

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
  plugins: [react(), cspMeta, serverPages(), notFoundPage()],
  // brotli-wasm locates its .wasm relative to its own module; pre-bundling breaks that in dev.
  optimizeDeps: { exclude: ['brotli-wasm'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
