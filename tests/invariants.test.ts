/**
 * "Builds never break": published game versions stay byte for byte as published, stable ids stay
 * put, share links made today keep opening cleanly, and every archetype's power sets still level
 * to 50 without a rule broken.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVER, SERVERS } from '../src/data/servers.ts';
import type { BoostsFile, Core, Power, Powerset } from '../src/data/types.ts';
import type { GameVersions } from '../src/data/versions.ts';
import { BuildRules, startingSets } from '../src/engine/rules.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { decodeShare } from '../src/io/share.ts';
import { dataDir, loadData } from './helpers/data.ts';
import { RECORDED_LINKS } from './helpers/links.ts';
import { walkTo50 } from './helpers/walk.ts';

const FILES = ['core.json', 'powersets.json', 'powers.json', 'boosts.json'];

// each server keeps its own versions and stable ids (pipeline/ids.json, pipeline/ids-<server>.json)
describe.each(SERVERS.map((s) => [s.label, s] as const))('published game versions: %s', (_, server) => {
  const DATA = dataDir(server.id);
  const read = (...p: string[]) => readFileSync(join(DATA, ...p), 'utf-8');
  const versions = JSON.parse(read('versions.json')) as GameVersions;
  const idsFile = server.id === DEFAULT_SERVER ? 'ids.json' : `ids-${server.id}.json`;
  const ids = JSON.parse(readFileSync(join(process.cwd(), 'pipeline', idsFile), 'utf-8')) as Record<string, Record<string, number>>;

  it('has a folder for every listed version, and the default and latest.json name one of them', () => {
    const listed = versions.versions.map((v) => v.id);
    expect(listed).toContain(versions.default);
    expect(listed).toContain((JSON.parse(read('latest.json')) as { dataVersion: string }).dataVersion);
    // a Mids map only where MidsReborn has a database for the server
    const files = server.midsDb ? [...FILES, 'mids-map.json'] : FILES;
    for (const id of listed) for (const f of files) expect(existsSync(join(DATA, id, f)), `${id}/${f}`).toBe(true);
    if (!server.midsDb) for (const id of listed) expect(existsSync(join(DATA, id, 'mids-map.json')), `${id}/mids-map.json`).toBe(false);
  });

  it('uses version ids no other server uses (a share code tells its server by its version)', () => {
    for (const other of SERVERS.filter((s) => s.id !== server.id)) {
      const theirs = new Set((JSON.parse(readFileSync(join(dataDir(other.id), 'versions.json'), 'utf-8')) as GameVersions).versions.map((v) => v.id));
      expect(versions.versions.filter((v) => theirs.has(v.id)).map((v) => v.id), other.label).toEqual([]);
    }
  });

  // pipeline/export.py content_hash: sha1 over core.json without its manifest.hash, then the other three files
  it.each(versions.versions)('$id still matches its published hash (version folders are never edited)', (v) => {
    const core = read(v.id, 'core.json');
    const h = createHash('sha1');
    h.update(core.replace(/,"hash":"[0-9a-f]{12}"\}\}\s*$/, '}}'), 'utf8');
    for (const f of FILES.slice(1)) h.update(read(v.id, f), 'utf8');
    const hash = h.digest('hex').slice(0, 12);
    expect(hash).toBe(v.hash);
    expect((JSON.parse(core) as Core).manifest.hash).toBe(v.hash);
  });

  // a renumbered or reused id would no longer match the (unchangeable) folders published with it
  it.each(versions.versions)(`$id agrees with pipeline/${idsFile}`, (v) => {
    const core = JSON.parse(read(v.id, 'core.json')) as Core;
    const boosts = JSON.parse(read(v.id, 'boosts.json')) as BoostsFile;
    const wrong: string[] = [];
    const check = (table: string, name: string, id: number) => {
      if (ids[table]?.[name.toLowerCase()] !== id) wrong.push(`${table} ${name} = ${id}, ${idsFile} ${ids[table]?.[name.toLowerCase()]}`);
    };
    const powers = [...(JSON.parse(read(v.id, 'powers.json')) as Power[]), ...boosts.boosts, ...boosts.bonusPowers];
    for (const p of powers) check('power', p.n, p.id);
    for (const s of JSON.parse(read(v.id, 'powersets.json')) as Powerset[]) check('powerset', s.n, s.id);
    for (const s of boosts.sets) check('boostset', s.n, s.id);
    for (const a of core.archetypes) check('archetype', a.n, a.id);
    for (const o of core.origins) check('origin', o.n, o.id);
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it(`never gives two names the same id in pipeline/${idsFile}`, () => {
    for (const [table, m] of Object.entries(ids)) {
      const vals = Object.values(m);
      expect(new Set(vals).size, table).toBe(vals.length);
    }
  });
});

describe('share links made today', () => {
  const gd = loadData();
  it.each(Object.entries(RECORDED_LINKS))('open %s with nothing repaired and no rule broken', async (_, g) => {
    const { build, fixes } = checkBuild(gd, await decodeShare(g.link));
    expect(fixes).toEqual([]);
    expect(build).not.toBeNull();
    const b = build!;
    expect(gd.archetype(b.at).n).toBe(g.at);
    expect(b.endLevel).toBe(g.endLevel);
    expect(b.respecTo).toBe(g.respecTo);
    expect(b.alignment).toBe(g.alignment ?? 'Hero');
    expect(new BuildRules(gd, b).issues()).toEqual([]);
  });
});

describe('every power set levels to 50', () => {
  const gd = loadData();
  // every set New Build offers (sets the game hides, such as Wind Control, are not offered),
  // each primary and each secondary at least once, paired in turn
  it.each(gd.core.archetypes.map((a) => [a.dn, a] as const))('%s: picking the first choice at every level breaks no rule', (_, at) => {
    const pri = startingSets(gd, at.cats.pri, at);
    const sec = startingSets(gd, at.cats.sec, at);
    const bad: string[] = [];
    for (let k = 0; k < Math.max(pri.length, sec.length); k++) {
      const p = pri[k % pri.length]!;
      const s = sec[k % sec.length]!;
      const b = walkTo50(gd, at.n, p.id, s.id);
      const r = new BuildRules(gd, b);
      const unplaced = [...new Set(gd.core.schedule.slot)].reduce((n, l) => n + r.slotsLeft([l]), 0);
      const issues = r.issues().map((x) => x.message);
      if (issues.length || unplaced) bad.push(`${p.n} / ${s.n}: ${issues.join('; ')}${unplaced ? ` (${unplaced} slots unplaced)` : ''}`);
    }
    expect(bad).toEqual([]);
  }, 60_000);
});
