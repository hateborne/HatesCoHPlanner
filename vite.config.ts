/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { notFoundRedirect, PAGES_BASE, SERVERS } from './src/data/servers.ts';
import { VERSION } from './scripts/release-version.mjs';

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
 * A build for another base than GitHub Pages' (HCP_BASE) also sends a link made at the GitHub Pages
 * address to the same page under its own base, so the link opens with only its host changed.
 *
 * @param base The site base ("/HatesCoHPlanner/").
 * @return The page's HTML.
 */
function notFoundHtml(base: string): string {
  const paths = SERVERS.map((s) => s.path);
  const fn = notFoundRedirect.toString();
  const was = base === PAGES_BASE ? '' : `,${JSON.stringify(PAGES_BASE)}`;
  const script = `(function(){var to=(${fn})(location.pathname,${JSON.stringify(base)},${JSON.stringify(paths)}${was});if(to)location.replace(to+location.search+location.hash);})();`;
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
      // a build for another base: a link made at the GitHub Pages address lands on its page here
      if (base !== PAGES_BASE && (run(`${PAGES_BASE}${own}/`, base, [own], PAGES_BASE) !== `${base}${own}/` || run(PAGES_BASE, base, [own], PAGES_BASE) !== base)) {
        return this.error('the 404 page does not send a GitHub Pages link to this base');
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
  "media-src 'self' blob:", // interface sounds fetched ahead of their first play are played from memory (ui/sound.ts)
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

/**
 * The release this build shows: the deploy sets HCP_VERSION ("1.2.0", picked by
 * scripts/release-version.mjs) and HCP_COMMIT (the commit's sha); local, test and pull request
 * builds have neither and show "dev". A malformed value stops the build, as the version is shown on
 * every screen and src/version.ts takes it as given.
 *
 * @return The version ("dev" when unset) and the commit's first 7 characters ("" when unset).
 */
function release(): { version: string; commit: string } {
  const version = process.env.HCP_VERSION || 'dev';
  if (version !== 'dev' && !VERSION.test(version)) {
    throw new Error(`HCP_VERSION must be a version like 1.2.0, not ${JSON.stringify(version)}`);
  }
  const commit = process.env.HCP_COMMIT || '';
  if (commit && !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`HCP_COMMIT must be a full commit sha, not ${JSON.stringify(commit)}`);
  return { version, commit: commit.slice(0, 7) };
}

const RELEASE = release();

/**
 * The interface sounds the site carries: every sound file but the menu music, which loads only when
 * Music is on. The page fetches them all when Sound is on (ui/sound.ts loadSounds), so it needs their
 * names; read from the folder here, the list can't fall out of step with the files.
 *
 * @return Their file names without the extension, sorted.
 */
function uiSounds(): string[] {
  return readdirSync(new URL('./public/assets/sounds', import.meta.url))
    .filter((f) => f.endsWith('.ogg') && !f.includes('menumusic'))
    .map((f) => f.slice(0, -'.ogg'.length))
    .sort();
}

/**
 * The path the site is served under: GitHub Pages' "/HatesCoHPlanner/", unless HCP_BASE names
 * another (the deploy's second build, for the site's own domain, sets "/": docs/hosting.md).
 *
 * Every address the planner makes or reads comes from it (import.meta.env.BASE_URL), so a
 * malformed value stops the build.
 *
 * @return The base, starting and ending with "/".
 */
function siteBase(): string {
  const base = process.env.HCP_BASE || PAGES_BASE;
  if (!/^\/([A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error(`HCP_BASE must be a path like / or /Planner/, not ${JSON.stringify(base)}`);
  return base;
}

// Served from https://hateborne.github.io/HatesCoHPlanner/ (every asset URL is under that base),
// or from the root of the site's own domain when HCP_BASE says so.
export default defineConfig({
  base: siteBase(),
  plugins: [react(), cspMeta, serverPages(), notFoundPage()],
  // the release shown in the footer (src/version.ts)
  // whether the unfinished set finder shows in this build (src/ui/flags.ts): HCP_SET_FINDER=1
  // and whether the site this build is for has brotli copies of its data files, which the GitHub
  // Pages deploy makes (src/data/packed.ts): HCP_BROTLI=1
  define: {
    __HCP_VERSION__: JSON.stringify(RELEASE.version),
    __HCP_COMMIT__: JSON.stringify(RELEASE.commit),
    __HCP_SET_FINDER__: JSON.stringify(process.env.HCP_SET_FINDER === '1'),
    __HCP_BROTLI__: JSON.stringify(process.env.HCP_BROTLI === '1'),
    // the interface sounds' names, for fetching them when Sound is on (src/ui/sound.ts)
    __HCP_UI_SOUNDS__: JSON.stringify(uiSounds()),
  },
  // brotli-wasm locates its .wasm relative to its own module; pre-bundling breaks that in dev.
  optimizeDeps: { exclude: ['brotli-wasm'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
