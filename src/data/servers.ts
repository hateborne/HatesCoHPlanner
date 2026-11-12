/**
 * Game servers (shards) the planner carries data for. Each keeps its own game versions, data
 * folder and logo, and names itself in the page's address (/HatesCoHPlanner/Homecoming/#b=...).
 *
 * Homecoming came first, so a build, saved build or link that names no server is Homecoming's: its
 * data stays in data/ (published version folders never move), and builds for it store no server.
 * Pure (no DOM, no import.meta): vite.config.ts reads the address paths from here too.
 */

/** One server the site carries. */
export interface GameServer {
  id: string; // the id builds store; never renamed or reused (old builds name it)
  label: string; // shown name ("Homecoming")
  path: string; // the address segment, as written in links ("Homecoming"); read in any case
  data: string; // its data folder under the site base: versions.json and one folder per game version
  logo: string; // its logo under the site base (public/servers/)
  midsDb: string; // the name Mids gives its database (BuiltWith.Database)
}

/** The server new visitors start on (the most played), and the one builds without a server belong to. */
export const DEFAULT_SERVER = 'homecoming';

/**
 * Every server the site carries, the default first. Rebirth's logo is ready
 * (public/servers/rebirth.webp); it gets an entry here once its data is exported (to data/rebirth/).
 */
export const SERVERS: readonly GameServer[] = [
  { id: 'homecoming', label: 'Homecoming', path: 'Homecoming', data: 'data/', logo: 'servers/homecoming.webp', midsDb: 'Homecoming' },
];

/** @return The server with this id, or undefined when the site doesn't carry it. */
export function serverById(id: string | undefined): GameServer | undefined {
  return SERVERS.find((s) => s.id === id);
}

/** @return The default server. */
export function defaultServer(): GameServer {
  return serverById(DEFAULT_SERVER)!;
}

/** @return The server id a build belongs to (one that names none is Homecoming's). */
export function serverOf(b: { server?: string }): string {
  return typeof b.server === 'string' && b.server ? b.server : DEFAULT_SERVER;
}

/** @return The server whose address segment this is (any case), or undefined. */
function serverByPath(seg: string): GameServer | undefined {
  const s = seg.toLowerCase();
  return SERVERS.find((x) => x.path.toLowerCase() === s);
}

/**
 * What an address says about its server. Naming none (the site root, a link from before servers,
 * a bare code) means Homecoming; naming one the site doesn't carry must not: a build opened on
 * another server's data would be wrong without anything showing it.
 */
export interface NamedServer {
  server?: GameServer; // the server it names
  unknown?: string; // the segment in the server's place, when it names no server the site carries
}

/**
 * The server a page address names: the first path segment after the site base.
 *
 * @param pathname location.pathname ("/HatesCoHPlanner/Homecoming/").
 * @param base Site base URL (import.meta.env.BASE_URL, "/HatesCoHPlanner/").
 * @return The server; `unknown` for a segment that names none the site carries; neither when the
 *   address names no server (the site root or its index.html, an address on another site).
 */
export function serverFromPath(pathname: string, base: string): NamedServer {
  if (!pathname.startsWith(base)) return {};
  const raw = pathname.slice(base.length).split('/')[0] ?? '';
  let seg = raw;
  try {
    seg = decodeURIComponent(raw);
  } catch {
    /* a malformed %-escape: kept as it is (it names no server) */
  }
  if (!seg || seg.toLowerCase() === 'index.html') return {};
  const server = serverByPath(seg);
  return server ? { server } : { unknown: seg };
}

/**
 * The server a pasted share link names, read from the link's address like the page's own.
 *
 * @param text Pasted text holding a share link (or a bare #b= code).
 * @param base Site base URL (import.meta.env.BASE_URL).
 * @return As serverFromPath; neither for a bare code or a link on another site.
 */
export function serverInLink(text: string, base: string): NamedServer {
  const before = (/(\S*)#b=/.exec(text)?.[1] ?? '').replace(/^[<("'[]+/, '');
  let path = '';
  try {
    path = new URL(before).pathname;
  } catch {
    path = before.startsWith('/') ? before.split('?')[0]! : '';
  }
  return path ? serverFromPath(path, base) : {};
}

/**
 * Where the site's 404 page sends an address GitHub Pages has no file for: the page of the server
 * its first segment names, written in another case or with more after it
 * ("/HatesCoHPlanner/homecoming/x" -> "/HatesCoHPlanner/Homecoming/"). Anything else stays on the
 * 404 page: an unknown server's link is never opened as another server's.
 *
 * Self-contained (it uses nothing outside itself and plain JavaScript only): the build writes its
 * source into 404.html (vite.config.ts).
 *
 * @param pathname The missing address's path.
 * @param base Site base URL ("/HatesCoHPlanner/").
 * @param paths Every server's address segment, as written.
 * @return The path to go to, or null (no server named, or already that server's own page, which
 *   must not redirect to itself).
 */
export function notFoundRedirect(pathname: string, base: string, paths: readonly string[]): string | null {
  if (pathname.indexOf(base) !== 0) return null;
  let seg = pathname.slice(base.length).split('/')[0] || '';
  try {
    seg = decodeURIComponent(seg);
  } catch (e) {
    void e; // a malformed %-escape: kept as it is
  }
  for (let i = 0; i < paths.length; i++) {
    const to = base + paths[i] + '/';
    if (String(paths[i]).toLowerCase() === seg.toLowerCase()) return pathname === to ? null : to;
  }
  return null;
}

/** @return The page address for a server ("/HatesCoHPlanner/Homecoming/"). */
export function serverHref(s: GameServer, base: string): string {
  return `${base}${s.path}/`;
}

/** @return The URL of a server's data folder ("/HatesCoHPlanner/data/"). */
export function dataRoot(s: GameServer, base: string): string {
  return `${base}${s.data}`;
}

/**
 * A build marked with its server (left unmarked for Homecoming, as builds for it always were).
 *
 * @param b The build (a decoded share code carries no server: its link's address does).
 * @param id The server's id, or undefined for Homecoming.
 * @return The build, with `server` set only for another server.
 */
export function withServer<T extends { server?: string }>(b: T, id: string | undefined): T {
  return id && id !== DEFAULT_SERVER ? { ...b, server: id } : b;
}
