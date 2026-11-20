/**
 * Game servers (shards) the planner carries data for. Each keeps its own game versions, data
 * folder and logo, and names itself in the page's address (/HatesCoHPlanner/Homecoming/#b=...).
 *
 * Homecoming came first, so a build, saved build or link that names no server is Homecoming's: its
 * data stays in data/ (published version folders never move), and builds for it store no server.
 * Each server numbers its powers, sets and archetypes on its own (pipeline/ids-<server>.json), and
 * every game version id belongs to one server only, so a share code tells its server by its version.
 * Pure (no DOM, no import.meta): vite.config.ts reads the address paths from here too.
 */

/** One server the site carries. */
export interface GameServer {
  id: string; // the id builds store; never renamed or reused (old builds name it)
  label: string; // shown name ("Homecoming")
  path: string; // the address segment, as written in links ("Homecoming"); read in any case
  data: string; // its data folder under the site base: versions.json and one folder per game version
  logo: string; // its logo under the site base (public/servers/)
  midsDb?: string; // the name Mids gives its database (BuiltWith.Database); none: Mids has no database for it
  buildSave: boolean; // its game client writes /build_save files (build.txt) the planner can import
  versionPrefix?: string; // every game version id of its starts with this (the pipeline enforces it); the default server has none
  ioLevelsAbove?: number; // how far an IO or set piece's level may be above the character's and still work; omitted: the boost effect table's length - 1 (3, Homecoming's client)
  infoPvp?: 'listed'; // its client's power info lists PvP-only effect groups too (it tests no group flags: Thunderspy.exe power_AddEffects 0x1404da680); the version's info file carries those groups
  infoRequires?: 'ownGroup'; // its client's power info reads an effect's requirements (infoRequires and the requirement notes) on the effect's own group only (Thunderspy.exe 0x1404d4cc0, from power_AddEffects and getTotalDamage 0x1404d6070); omitted: Homecoming's client, which reads every group above it too
  infoFriendNotes?: true; // its client's power info notes on a line whose group's requirement names the target whom it applies to, "Applies to enemies" / "Applies to allies" (Thunderspy.exe's requirement notes 0x1404d2f00, from power_AddEffects; not for the damage total); omitted: Homecoming's client, which has no such note
  tagModes?: 'ownTag'; // its client's power info reads a group's tag mode (getChanceModString, getChanceModValue) from the group's own first tag only and knows no ASTeamCrit (Thunderspy.exe); omitted: Homecoming's client, which also reads its parent groups' first tags
}

/** The server new visitors start on (the most played), and the one builds without a server belong to. */
export const DEFAULT_SERVER = 'homecoming';

/**
 * The site's path on GitHub Pages (hateborne.github.io/HatesCoHPlanner/): the default site base
 * (vite.config.ts), and the path every link made there carries. A copy of the site built for
 * another base (HCP_BASE: its own domain's "/") still reads those links (onThisSite, and the 404
 * page's notFoundRedirect).
 */
export const PAGES_BASE = '/HatesCoHPlanner/';

/**
 * Every server the site carries, the default first. Rebirth's logo is ready
 * (public/servers/rebirth.webp); it gets an entry here once its data is exported (to data/rebirth/).
 */
export const SERVERS: readonly GameServer[] = [
  { id: 'homecoming', label: 'Homecoming', path: 'Homecoming', data: 'data/', logo: 'servers/homecoming.webp', midsDb: 'Homecoming', buildSave: true },
  // Thunderspy's client has no /build_save, and MidsReborn has no Thunderspy database. Its
  // power_MinBoostUseLevel gives an IO or set piece (BoostIgnoreEffectiveness) no levels below its
  // own: MAX(MinSlotLevel, level), where Homecoming's takes level - 3 (seen in Thunderspy.exe). Its
  // power info reads tag modes from a group's own first tag (tagModes, Thunderspy.exe 0x1404d1f90)
  // and checks requirements on an effect's own group only (infoRequires, 0x1404d4cc0), and notes whom
  // a line applies to (infoFriendNotes, 0x1404d2f00)
  { id: 'thunderspy', label: 'Thunderspy', path: 'Thunderspy', data: 'data/thunderspy/', logo: 'servers/thunderspy.webp', buildSave: false, versionPrefix: 'ts', ioLevelsAbove: 0, tagModes: 'ownTag', infoRequires: 'ownGroup', infoPvp: 'listed', infoFriendNotes: true },
];

/**
 * The server a game version id belongs to: the one whose `versionPrefix` it starts with, else the
 * default server, whose ids carry none.
 *
 * A share code names its game version but not its server, and each server numbers its powers on its
 * own. The pipeline gives every server's ids its prefix (Thunderspy's release 9.6 is "ts9-6") and
 * refuses a Homecoming id that starts with another's, so the id alone tells the server: no server's
 * version list has to be downloaded, and a link never fails because another server's files won't load.
 *
 * @param version The version id ("i28p4", "ts9-6").
 * @return Its server.
 */
export function versionServer(version: string): GameServer {
  return SERVERS.find((s) => s.versionPrefix && version.startsWith(s.versionPrefix)) ?? defaultServer();
}

/** @return The server with this id, or undefined when the site doesn't carry it. */
export function serverById(id: string | undefined): GameServer | undefined {
  return SERVERS.find((s) => s.id === id);
}

/** @return The default server. */
export function defaultServer(): GameServer {
  return serverById(DEFAULT_SERVER)!;
}

/** @return The carried server whose Mids database has this name (any case), or undefined. */
export function serverByMidsDb(db: string | undefined): GameServer | undefined {
  const d = db?.toLowerCase();
  return d ? SERVERS.find((s) => s.midsDb?.toLowerCase() === d) : undefined;
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
 * A link's path as this site reads it: one made at the site's GitHub Pages address
 * ("/HatesCoHPlanner/Homecoming/") is, on a copy of the site built for another base, that copy's
 * own ("/Homecoming/").
 *
 * On GitHub Pages itself every path stays as it is, so nothing a link opens there changes. Only the
 * path's exact spelling counts, as on GitHub Pages, which serves no other.
 *
 * @param pathname The link's path.
 * @param base Site base URL (import.meta.env.BASE_URL).
 * @return The path to read against `base`.
 */
export function onThisSite(pathname: string, base: string): string {
  if (base === PAGES_BASE) return pathname;
  if (`${pathname}/` === PAGES_BASE) return base;
  return pathname.startsWith(PAGES_BASE) ? `${base}${pathname.slice(PAGES_BASE.length)}` : pathname;
}

/**
 * The server a pasted share link names, read from the link's address like the page's own.
 *
 * On GitHub Pages a link is read by its path alone, whatever its host, as it always was: only a
 * path under the site's own names a server. A copy of the site at a domain's root can't tell by
 * the path (every path is under "/"), so there:
 * 1. a link made at the GitHub Pages address reads as it does there (onThisSite);
 * 2. a link on the copy's own host, or a path alone, reads by its path;
 * 3. a link on any other site names no server, as on GitHub Pages: its code decides.
 *
 * @param text Pasted text holding a share link (or a bare #b= code).
 * @param base Site base URL (import.meta.env.BASE_URL).
 * @param host The page's own host (location.host); omitted, every link counts as on it.
 * @return As serverFromPath; neither for a bare code or a link on another site.
 */
export function serverInLink(text: string, base: string, host?: string): NamedServer {
  const at = text.indexOf('#b=');
  if (at < 0) return {};
  // the link runs back from its code to the whitespace before it; a plain scan, since a regex
  // like /(\S*)#b=/ backtracks over long pasted text (2 MB of it froze the tab for minutes)
  let start = at;
  while (start > 0 && !/\s/.test(text.charAt(start - 1))) start--;
  const before = text.slice(start, at).replace(/^[<("'[]+/, '');
  let path = '';
  let own = true; // on this site's own host (a path alone is)
  try {
    const url = new URL(before);
    path = url.pathname;
    own = host === undefined || url.host === host;
  } catch {
    path = before.startsWith('/') ? before.split('?')[0]! : '';
  }
  if (!path) return {};
  if (base === PAGES_BASE) return serverFromPath(path, base);
  const here = onThisSite(path, base);
  return here !== path || own ? serverFromPath(here, base) : {};
}

/**
 * Where the site's 404 page sends an address GitHub Pages has no file for: the page of the server
 * its first segment names, written in another case or with more after it
 * ("/HatesCoHPlanner/homecoming/x" -> "/HatesCoHPlanner/Homecoming/"). Anything else stays on the
 * 404 page: an unknown server's link is never opened as another server's.
 *
 * On a copy of the site built for another base, a link made at the GitHub Pages address has no file
 * either (`was`): it goes to the same page under this base ("/HatesCoHPlanner/Homecoming/" ->
 * "/Homecoming/", "/HatesCoHPlanner/" -> "/"), so such a link opens with only its host changed.
 *
 * Self-contained (it uses nothing outside itself and plain JavaScript only): the build writes its
 * source into 404.html (vite.config.ts).
 *
 * @param pathname The missing address's path.
 * @param base Site base URL ("/HatesCoHPlanner/").
 * @param paths Every server's address segment, as written.
 * @param was The base the site's links were made under (PAGES_BASE), on a copy built for another;
 *   omitted on GitHub Pages itself.
 * @return The path to go to, or null (no server named, or already that server's own page, which
 *   must not redirect to itself).
 */
export function notFoundRedirect(pathname: string, base: string, paths: readonly string[], was?: string): string | null {
  let path = pathname;
  let moved = false;
  if (was && was !== base) {
    if (path + '/' === was) path = was;
    if (path.indexOf(was) === 0) {
      path = base + path.slice(was.length);
      moved = true;
    }
  }
  if (path.indexOf(base) !== 0) return null;
  let seg = path.slice(base.length).split('/')[0] || '';
  try {
    seg = decodeURIComponent(seg);
  } catch (e) {
    void e; // a malformed %-escape: kept as it is
  }
  for (let i = 0; i < paths.length; i++) {
    const to = base + paths[i] + '/';
    if (String(paths[i]).toLowerCase() === seg.toLowerCase()) return pathname === to ? null : to;
  }
  // the other base's own root (or its index.html), and nothing else, is this site's root
  return moved && (path === base || path === base + 'index.html') ? base : null;
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
