import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { dataRoot, DEFAULT_SERVER, defaultServer, serverById, serverFromPath, serverHref, serverInLink, serverOf, SERVERS, withServer } from '../src/data/servers.ts';
import { newBuild } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { finishBuildTxt, readBuildTxt } from '../src/io/buildtxt.ts';
import { exportMbd, importMbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, loadMidsMapFile, pid, sid } from './helpers/data.ts';

const BASE = '/HatesCoHPlanner/';
const gd = loadData();
const homecoming = serverById('homecoming')!;

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
  });
});

describe('server from the address', () => {
  it('reads the segment after the base, in any case', () => {
    expect(serverFromPath('/HatesCoHPlanner/Homecoming/', BASE)).toEqual({ server: homecoming });
    expect(serverFromPath('/HatesCoHPlanner/Homecoming', BASE)).toEqual({ server: homecoming });
    expect(serverFromPath('/HatesCoHPlanner/homecoming/', BASE)).toEqual({ server: homecoming });
    expect(serverFromPath('/HatesCoHPlanner/HOMECOMING/index.html', BASE)).toEqual({ server: homecoming });
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
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/Rebirth/#b=eJx', BASE)).toEqual({ unknown: 'Rebirth' });
  });

  it('names no server for an old link, its index.html, a bare code or another site', () => {
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/#b=eJx', BASE)).toEqual({});
    expect(serverInLink('https://hateborne.github.io/HatesCoHPlanner/index.html#b=eJx', BASE)).toEqual({});
    expect(serverInLink('#b=eJx', BASE)).toEqual({});
    expect(serverInLink('https://example.org/OtherPlanner/Stuff/#b=eJx', BASE)).toEqual({});
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
