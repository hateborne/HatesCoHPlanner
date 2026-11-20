import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { dataRoot, DEFAULT_SERVER, defaultServer, notFoundRedirect, onThisSite, PAGES_BASE, serverById, serverByMidsDb, serverFromPath, serverHref, serverInLink, serverOf, SERVERS, withServer } from '../src/data/servers.ts';
import { newBuild } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { finishBuildTxt, readBuildTxt } from '../src/io/buildtxt.ts';
import { exportMbd, importMbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, loadMidsMapFile, pid, sid } from './helpers/data.ts';

const BASE = '/HatesCoHPlanner/';
const OWN = '/'; // the base of the site's copy on its own domain (HCP_BASE)
const OWN_HOST = 'cohplanner.hateborne.com'; // that copy's host, as the page gives it (location.host)
const gd = loadData();
const homecoming = serverById('homecoming')!;
const thunderspy = serverById('thunderspy')!;

/** A small Homecoming build (one power) for the round trips below. */
function sample() {
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    name: 'Server Test',
    at: gd.archetypeByName.get('class_blaster')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: gd.core.schedule.power.length,
  });
  b.picks[0] = { power: pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [{ level: 0 }] };
  return b;
}

/** @return The same data, labelled as another server's (what a second server's data set would be). */
function asServer(data: GameData, server: string): GameData {
  return Object.assign(Object.create(Object.getPrototypeOf(data) as object) as GameData, data, { server });
}

describe('server list', () => {
  it('starts with Homecoming, the default, whose data stays in data/', () => {
    expect(DEFAULT_SERVER).toBe('homecoming');
    expect(SERVERS[0]!.id).toBe(DEFAULT_SERVER);
    expect(defaultServer()).toBe(homecoming);
    // published version folders never move: Homecoming's data is where builds and links found it
    expect(homecoming.data).toBe('data/');
    expect(homecoming.path).toBe('Homecoming');
    expect(homecoming.midsDb).toBe('Homecoming');
    expect(homecoming.buildSave).toBe(true);
  });

  it('carries Thunderspy in its own data folder, without Mids or /build_save', () => {
    expect(thunderspy).toBeDefined();
    expect(thunderspy.data).toBe('data/thunderspy/');
    expect(thunderspy.path).toBe('Thunderspy');
    expect(thunderspy.midsDb).toBeUndefined();
    expect(thunderspy.buildSave).toBe(false);
    expect(serverByMidsDb('homecoming')).toBe(homecoming);
    expect(serverByMidsDb('Rebirth')).toBeUndefined();
    expect(serverByMidsDb(undefined)).toBeUndefined();
  });

  it('gives every server its own id, address and data, with files the site serves', () => {
    const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
    expect(new Set(SERVERS.map((s) => s.id)).size).toBe(SERVERS.length);
    expect(new Set(lower(SERVERS.map((s) => s.path))).size).toBe(SERVERS.length);
    expect(new Set(SERVERS.map((s) => s.data)).size).toBe(SERVERS.length);
    for (const s of SERVERS) {
      // an address segment that can't be mistaken for a file or a data folder
      expect(s.path).toMatch(/^[A-Za-z][A-Za-z0-9-]*$/);
      expect(['data', 'assets', 'servers']).not.toContain(s.path.toLowerCase());
      expect(existsSync(join(process.cwd(), 'public', s.logo)), s.logo).toBe(true);
      expect(existsSync(join(process.cwd(), 'public', s.data, 'versions.json')), s.data).toBe(true);
    }
  });

  it('builds addresses and data URLs under the site base', () => {
    expect(serverHref(homecoming, BASE)).toBe('/HatesCoHPlanner/Homecoming/');
    expect(dataRoot(homecoming, BASE)).toBe('/HatesCoHPlanner/data/');
    expect(serverHref(thunderspy, BASE)).toBe('/HatesCoHPlanner/Thunderspy/');
    expect(dataRoot(thunderspy, BASE)).toBe('/HatesCoHPlanner/data/thunderspy/');
  });
});

describe('server from the address', () => {
  it('reads the segment after the base, in any case', () => {
    expect(serverFromPath('/HatesCoHPlanner/Homecoming/', BASE)).toEqual({ server: homecoming });
    expect(serverFromPath('/HatesCoHPlanner/Homecoming', BASE)).toEqual({ server: homecoming });
    expect(serverFromPath('/HatesCoHPlanner/homecoming/', BASE)).toEqual({ server: homecoming });
    expect(serverFromPath('/HatesCoHPlanner/HOMECOMING/index.html', BASE)).toEqual({ server: homecoming });
    expect(serverFromPath('/HatesCoHPlanner/Thunderspy/', BASE)).toEqual({ server: thunderspy });
    expect(serverFromPath('/HatesCoHPlanner/thunderspy', BASE)).toEqual({ server: thunderspy });
  });

  it('names no server for the bare site, its index.html or another site (Homecoming, as before servers)', () => {
    expect(serverFromPath('/HatesCoHPlanner/', BASE)).toEqual({});
    expect(serverFromPath('/HatesCoHPlanner/index.html', BASE)).toEqual({});
    expect(serverFromPath('/Elsewhere/Homecoming/', BASE)).toEqual({});
  });

  it('marks a segment naming no server the site carries, so its build is not opened as Homecoming', () => {
    expect(serverFromPath('/HatesCoHPlanner/Rebirth/', BASE)).toEqual({ unknown: 'Rebirth' });
    expect(serverFromPath('/HatesCoHPlanner/%E0%A4%A/', BASE)).toEqual({ unknown: '%E0%A4%A' });
  });

  it("reads a pasted link's server like the page's own", () => {
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/Homecoming/#b=eJx', BASE)).toEqual({ server: homecoming });
    expect(serverInLink('see https://hateborne.github.io/HatesCoHPlanner/homecoming#b=eJx please', BASE)).toEqual({ server: homecoming });
    expect(serverInLink('<http://localhost:5173/HatesCoHPlanner/Homecoming/?x=1#b=eJx>', BASE)).toEqual({ server: homecoming });
    expect(serverInLink('/HatesCoHPlanner/Homecoming/#b=eJx', BASE)).toEqual({ server: homecoming });
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/Thunderspy/#b=eJx', BASE)).toEqual({ server: thunderspy });
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/Rebirth/#b=eJx', BASE)).toEqual({ unknown: 'Rebirth' });
  });

  it('reads a long paste in linear time (a backtracking regex froze the tab on 2 MB of it)', () => {
    const t0 = performance.now();
    expect(serverInLink(`${'a'.repeat(300_000)} https://hateborne.github.io/HatesCoHPlanner/Homecoming/#b=eJx`, BASE)).toEqual({ server: homecoming });
    expect(serverInLink(`${'a'.repeat(300_000)} #b=eJx`, BASE)).toEqual({});
    expect(performance.now() - t0).toBeLessThan(2000); // quadratic: well over a minute
  });

  it('names no server for an old link, its index.html, a bare code or another site', () => {
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/#b=eJx', BASE)).toEqual({});
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/index.html#b=eJx', BASE)).toEqual({});
    expect(serverInLink('#b=eJx', BASE)).toEqual({});
    expect(serverInLink('https://example.org/OtherPlanner/Stuff/#b=eJx', BASE)).toEqual({});
  });
});

describe("the site's copy on its own domain (built for the root path)", () => {
  it('keeps GitHub Pages at the path every link made there carries', () => {
    expect(PAGES_BASE).toBe(BASE);
  });

  it('builds short addresses and data URLs', () => {
    expect(serverHref(homecoming, OWN)).toBe('/Homecoming/');
    expect(serverHref(thunderspy, OWN)).toBe('/Thunderspy/');
    expect(dataRoot(homecoming, OWN)).toBe('/data/');
    expect(dataRoot(thunderspy, OWN)).toBe('/data/thunderspy/');
  });

  it("reads the page's own address as GitHub Pages reads its own", () => {
    expect(serverFromPath('/Homecoming/', OWN)).toEqual({ server: homecoming });
    expect(serverFromPath('/thunderspy', OWN)).toEqual({ server: thunderspy });
    expect(serverFromPath('/', OWN)).toEqual({});
    expect(serverFromPath('/index.html', OWN)).toEqual({});
    expect(serverFromPath('/Rebirth/', OWN)).toEqual({ unknown: 'Rebirth' });
  });

  it('reads a pasted link made at either address', () => {
    expect(serverInLink('https://cohplanner.hateborne.com/Homecoming/#b=eJx', OWN)).toEqual({ server: homecoming });
    expect(serverInLink('https://cohplanner.hateborne.com/Thunderspy/#b=eJx', OWN)).toEqual({ server: thunderspy });
    expect(serverInLink('https://cohplanner.hateborne.com/#b=eJx', OWN)).toEqual({});
    expect(serverInLink('#b=eJx', OWN)).toEqual({});
    // made on GitHub Pages: the same server as there
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/Homecoming/#b=eJx', OWN)).toEqual({ server: homecoming });
    expect(serverInLink('see https://hateborne.github.io/HatesCoHPlanner/thunderspy#b=eJx please', OWN)).toEqual({ server: thunderspy });
    expect(serverInLink('/HatesCoHPlanner/Homecoming/?x=1#b=eJx', OWN)).toEqual({ server: homecoming });
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/#b=eJx', OWN)).toEqual({});
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner#b=eJx', OWN)).toEqual({});
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/index.html#b=eJx', OWN)).toEqual({});
    // a server the site doesn't carry is still refused, never opened as Homecoming
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/Rebirth/#b=eJx', OWN)).toEqual({ unknown: 'Rebirth' });
    expect(serverInLink('https://cohplanner.hateborne.com/Rebirth/#b=eJx', OWN)).toEqual({ unknown: 'Rebirth' });
  });

  it("reads another site's link by its code alone, as GitHub Pages does", () => {
    const here = (text: string) => serverInLink(text, OWN, OWN_HOST);
    // every path is under "/", so the host tells this copy's own links from another site's
    for (const link of [
      'https://forums.example.org/topic/123-build/#b=eJx',
      'https://www.example.com/r/x/comments/abc/#b=eJx',
      'https://example.org/Homecoming/#b=eJx',
      'https://example.org/Rebirth/#b=eJx',
      'http://localhost:5173/Thunderspy/#b=eJx',
      // not GitHub Pages' spelling of its path (it serves no other): another site's link, as there
      'https://hateborne.github.io/hatescohplanner/Homecoming/#b=eJx',
    ]) {
      expect(here(link), link).toEqual({});
      expect(serverInLink(link, BASE), link).toEqual({}); // the same answer as on GitHub Pages
    }
    // its own host, a path alone and a GitHub Pages link (from any host) still name their server
    expect(here('https://cohplanner.hateborne.com/Thunderspy/#b=eJx')).toEqual({ server: thunderspy });
    expect(here('https://COHPLANNER.hateborne.com/homecoming#b=eJx')).toEqual({ server: homecoming });
    expect(here('https://cohplanner.hateborne.com/Rebirth/#b=eJx')).toEqual({ unknown: 'Rebirth' });
    expect(here('/Thunderspy/#b=eJx')).toEqual({ server: thunderspy });
    expect(here('https://hateborne.github.io/HatesCoHPlanner/Thunderspy/#b=eJx')).toEqual({ server: thunderspy });
    expect(here('http://localhost:5173/HatesCoHPlanner/Homecoming/?x=1#b=eJx')).toEqual({ server: homecoming });
    expect(here('https://hateborne.github.io/HatesCoHPlanner/Rebirth/#b=eJx')).toEqual({ unknown: 'Rebirth' });
    expect(here('https://hateborne.github.io/HatesCoHPlanner/#b=eJx')).toEqual({});
    expect(here('#b=eJx')).toEqual({});
  });

  it('takes no notice of the host on GitHub Pages, where the path alone always decided', () => {
    const pages = 'hateborne.github.io';
    for (const link of [
      'https://hateborne.github.io/HatesCoHPlanner/Homecoming/#b=eJx',
      'http://localhost:5173/HatesCoHPlanner/Thunderspy/#b=eJx',
      'https://example.org/HatesCoHPlanner/Rebirth/#b=eJx',
      'https://cohplanner.hateborne.com/Homecoming/#b=eJx',
      'https://example.org/OtherPlanner/Stuff/#b=eJx',
      '/HatesCoHPlanner/Homecoming/#b=eJx',
      '#b=eJx',
    ]) {
      expect(serverInLink(link, BASE, pages), link).toEqual(serverInLink(link, BASE));
      expect(serverInLink(link, BASE, 'elsewhere.example'), link).toEqual(serverInLink(link, BASE));
    }
  });

  it('changes no path on GitHub Pages itself, so nothing a link opens there moves', () => {
    for (const p of ['/HatesCoHPlanner/', '/HatesCoHPlanner', '/HatesCoHPlanner/Homecoming/', '/HatesCoHPlanner/Rebirth/x', '/Homecoming/', '/', '']) expect(onThisSite(p, BASE), p).toBe(p);
    // a link made at the short address is read there by its code alone, like any other site's
    expect(serverInLink('https://cohplanner.hateborne.com/Homecoming/#b=eJx', BASE)).toEqual({});
    expect(serverInLink('https://cohplanner.hateborne.com/Thunderspy/#b=eJx', BASE)).toEqual({});
  });

  it('turns a GitHub Pages path into its own, and leaves every other path alone', () => {
    expect(onThisSite('/HatesCoHPlanner/Homecoming/', OWN)).toBe('/Homecoming/');
    expect(onThisSite('/HatesCoHPlanner/', OWN)).toBe('/');
    expect(onThisSite('/HatesCoHPlanner', OWN)).toBe('/');
    expect(onThisSite('/HatesCoHPlanner/a/b', '/Planner/')).toBe('/Planner/a/b');
    for (const p of ['/Homecoming/', '/', '/HatesCoHPlannerX/', '/x/HatesCoHPlanner/', '/hatescohplanner/']) expect(onThisSite(p, OWN), p).toBe(p);
  });
});

describe('the 404 page redirect', () => {
  const paths = SERVERS.map((s) => s.path);
  it('sends a server address in another case, or with more after it, to that server page', () => {
    expect(notFoundRedirect('/HatesCoHPlanner/homecoming/', BASE, paths)).toBe('/HatesCoHPlanner/Homecoming/');
    expect(notFoundRedirect('/HatesCoHPlanner/homecoming', BASE, paths)).toBe('/HatesCoHPlanner/Homecoming/');
    expect(notFoundRedirect('/HatesCoHPlanner/HOMECOMING/x/y.html', BASE, paths)).toBe('/HatesCoHPlanner/Homecoming/');
    expect(notFoundRedirect('/HatesCoHPlanner/Homecoming/nope', BASE, paths)).toBe('/HatesCoHPlanner/Homecoming/');
    expect(notFoundRedirect('/HatesCoHPlanner/thunderspy/x', BASE, paths)).toBe('/HatesCoHPlanner/Thunderspy/');
  });

  it("leaves anything else on the 404 page, and never redirects a server's own page to itself", () => {
    expect(notFoundRedirect('/HatesCoHPlanner/Homecoming/', BASE, paths)).toBeNull();
    expect(notFoundRedirect('/HatesCoHPlanner/Thunderspy/', BASE, paths)).toBeNull();
    expect(notFoundRedirect('/HatesCoHPlanner/Rebirth/', BASE, paths)).toBeNull();
    expect(notFoundRedirect('/HatesCoHPlanner/', BASE, paths)).toBeNull();
    expect(notFoundRedirect('/HatesCoHPlanner/assets/missing.png', BASE, paths)).toBeNull();
    expect(notFoundRedirect('/Elsewhere/homecoming/', BASE, paths)).toBeNull();
    expect(notFoundRedirect('/HatesCoHPlanner/%E0%A4%A/', BASE, paths)).toBeNull();
  });

  it("on the site's own domain, sends a link made at the GitHub Pages address to the same page there", () => {
    const own = (p: string) => notFoundRedirect(p, OWN, paths, PAGES_BASE);
    expect(own('/HatesCoHPlanner/Homecoming/')).toBe('/Homecoming/');
    expect(own('/HatesCoHPlanner/Homecoming')).toBe('/Homecoming/');
    expect(own('/HatesCoHPlanner/Thunderspy/')).toBe('/Thunderspy/');
    expect(own('/HatesCoHPlanner/homecoming/x')).toBe('/Homecoming/');
    expect(own('/HatesCoHPlanner/')).toBe('/');
    expect(own('/HatesCoHPlanner')).toBe('/');
    expect(own('/HatesCoHPlanner/index.html')).toBe('/');
    // its own addresses, as on GitHub Pages
    expect(own('/homecoming/')).toBe('/Homecoming/');
    expect(own('/Homecoming/nope')).toBe('/Homecoming/');
    expect(own('/Homecoming/')).toBeNull();
    expect(own('/Thunderspy/')).toBeNull();
  });

  it("on the site's own domain, still leaves an unknown server and a missing file on the 404 page", () => {
    const own = (p: string) => notFoundRedirect(p, OWN, paths, PAGES_BASE);
    expect(own('/HatesCoHPlanner/Rebirth/')).toBeNull();
    expect(own('/Rebirth/')).toBeNull();
    expect(own('/HatesCoHPlanner/data/versions.json')).toBeNull();
    expect(own('/HatesCoHPlanner/%E0%A4%A/')).toBeNull();
    expect(own('/hatescohplanner/Homecoming/')).toBeNull(); // not GitHub Pages' spelling of the path
    expect(own('/HatesCoHPlannerX/')).toBeNull();
    expect(own('/assets/missing.png')).toBeNull();
    // only the GitHub Pages root itself is this site's root: nothing odd after it gets sent there
    expect(own('/HatesCoHPlanner//Thunderspy/')).toBeNull();
    expect(own('/HatesCoHPlanner//')).toBeNull();
    expect(own('/HatesCoHPlanner/index.html/x')).toBeNull();
    expect(own('/HatesCoHPlanner/INDEX.HTML')).toBeNull();
    expect(own('/HatesCoHPlanner//evil.example/')).toBeNull();
  });

  it('is the same on GitHub Pages with or without its own base named', () => {
    for (const p of ['/HatesCoHPlanner/', '/HatesCoHPlanner', '/HatesCoHPlanner/index.html', '/HatesCoHPlanner/homecoming/x', '/HatesCoHPlanner/Homecoming/', '/HatesCoHPlanner/Rebirth/', '/Homecoming/', '/']) {
      expect(notFoundRedirect(p, BASE, paths, PAGES_BASE), p).toBe(notFoundRedirect(p, BASE, paths));
    }
  });

  it('runs on its own, as the 404 page runs it', () => {
    const run = new Function(`return (${notFoundRedirect.toString()})`)() as typeof notFoundRedirect;
    expect(run('/HatesCoHPlanner/homecoming/x', BASE, paths)).toBe('/HatesCoHPlanner/Homecoming/');
    expect(run('/HatesCoHPlanner/Homecoming/', BASE, paths)).toBeNull();
    expect(run('/HatesCoHPlanner/Homecoming/', OWN, paths, PAGES_BASE)).toBe('/Homecoming/');
    expect(run('/HatesCoHPlanner/', OWN, paths, PAGES_BASE)).toBe('/');
  });
});

describe('builds and servers', () => {
  it('counts a build that names no server as Homecoming', () => {
    expect(serverOf({})).toBe('homecoming');
    expect(serverOf({ server: '' })).toBe('homecoming');
    expect(serverOf({ server: 'rebirth' })).toBe('rebirth');
  });

  it('marks only builds for another server, so Homecoming builds stay as they were', () => {
    const b = sample();
    expect('server' in b).toBe(false);
    expect(withServer(b, 'homecoming')).toBe(b);
    expect(withServer(b, undefined)).toBe(b);
    expect(withServer(b, 'rebirth')).toEqual({ ...b, server: 'rebirth' });
    expect('server' in newBuild({ ...b, server: 'homecoming', pickCount: 24 })).toBe(false);
    expect(newBuild({ ...b, server: 'rebirth', pickCount: 24 }).server).toBe('rebirth');
  });

  it('ties a checked build to the server of the data it was checked against', () => {
    const b = sample();
    const home = checkBuild(gd, { ...b, server: 'rebirth' }).build!;
    expect(home).not.toBeNull();
    expect('server' in home).toBe(false);
    const other = checkBuild(asServer(gd, 'rebirth'), b).build!;
    expect(other.server).toBe('rebirth');
  });

  it('keeps the server out of the share code: the address carries it', async () => {
    const b = sample();
    const code = await encodeShare(b);
    expect(await encodeShare({ ...b, server: 'rebirth' })).toBe(code);
    expect('server' in (await decodeShare(code))).toBe(false);
  });

  it("names the data's server in Mids exports", () => {
    const map: MidsMap = loadMidsMapFile(gd.core.manifest.dataVersion);
    expect(exportMbd(gd, map, sample()).mbd.BuiltWith?.Database).toBe('Homecoming');
  });

  it('makes an import the build of the server whose data it was read against', () => {
    const map: MidsMap = loadMidsMapFile(gd.core.manifest.dataVersion);
    const mbd = exportMbd(gd, map, sample()).mbd;
    expect('server' in importMbd(gd, map, mbd).build).toBe(false);
    expect(importMbd(asServer(gd, 'rebirth'), map, mbd).build.server).toBe('rebirth');
    const txt = [
      'Server Test: Level 2 Science Class_Blaster',
      '',
      'Character Profile:',
      '------------------',
      'Level 1: Blaster_Ranged Fire_Blast Flares',
      '\tEMPTY',
      'Level 1: Blaster_Support Fire_Manipulation Ring_of_Fire',
      '\tEMPTY',
    ].join('\n');
    const finish = (data: GameData) => finishBuildTxt(data, readBuildTxt(data, txt), { alignment: 'Hero', respec: true });
    expect('server' in finish(gd)).toBe(false);
    expect(finish(asServer(gd, 'rebirth')).server).toBe('rebirth');
  });
});
