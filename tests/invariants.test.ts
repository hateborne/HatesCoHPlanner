/**
 * "Builds never break": published game versions stay byte for byte as published, stable ids stay
 * put, share links made today keep opening cleanly, and every archetype's power sets still level
 * to 50 without a rule broken.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoostsFile, Core, Power, Powerset } from '../src/data/types.ts';
import type { GameVersions } from '../src/data/versions.ts';
import { evalRequires } from '../src/engine/requires.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { decodeShare } from '../src/io/share.ts';
import { loadData } from './helpers/data.ts';
import { walkTo50 } from './helpers/walk.ts';

const DATA = join(process.cwd(), 'public', 'data');
const read = (...p: string[]) => readFileSync(join(DATA, ...p), 'utf-8');
const versions = JSON.parse(read('versions.json')) as GameVersions;
const FILES = ['core.json', 'powersets.json', 'powers.json', 'boosts.json'];
const ids = JSON.parse(readFileSync(join(process.cwd(), 'pipeline', 'ids.json'), 'utf-8')) as Record<string, Record<string, number>>;

describe('published game versions', () => {
  it('has a folder for every listed version, and the default and latest.json name one of them', () => {
    const listed = versions.versions.map((v) => v.id);
    expect(listed).toContain(versions.default);
    expect(listed).toContain((JSON.parse(read('latest.json')) as { dataVersion: string }).dataVersion);
    for (const id of listed) for (const f of [...FILES, 'mids-map.json']) expect(existsSync(join(DATA, id, f)), `${id}/${f}`).toBe(true);
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
  it.each(versions.versions)('$id agrees with pipeline/ids.json', (v) => {
    const core = JSON.parse(read(v.id, 'core.json')) as Core;
    const boosts = JSON.parse(read(v.id, 'boosts.json')) as BoostsFile;
    const wrong: string[] = [];
    const check = (table: string, name: string, id: number) => {
      if (ids[table]?.[name.toLowerCase()] !== id) wrong.push(`${table} ${name} = ${id}, ids.json ${ids[table]?.[name.toLowerCase()]}`);
    };
    const powers = [...(JSON.parse(read(v.id, 'powers.json')) as Power[]), ...boosts.boosts, ...boosts.bonusPowers];
    for (const p of powers) check('power', p.n, p.id);
    for (const s of JSON.parse(read(v.id, 'powersets.json')) as Powerset[]) check('powerset', s.n, s.id);
    for (const s of boosts.sets) check('boostset', s.n, s.id);
    for (const a of core.archetypes) check('archetype', a.n, a.id);
    for (const o of core.origins) check('origin', o.n, o.id);
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it('never gives two names the same id in pipeline/ids.json', () => {
    for (const [table, m] of Object.entries(ids)) {
      const vals = Object.values(m);
      expect(new Set(vals).size, table).toBe(vals.length);
    }
  });
});

// Links made with this version of the planner (synthetic builds from walkTo50, plus enhancements
// of every kind on the Blaster). They must keep opening with nothing to repair and no rule broken.
const GOLDEN: Record<string, { link: string; at: string; endLevel?: number; respecTo?: number; alignment?: string }> = {
  'a Blaster with set, attuned, boosted, relative-level and common IOs': {
    link: 'eJwdyckuQ1EcwOHfaXv_nafb6baqWo5WUVyxkJyzsvEcEl1IGgRv4Vk8jLk1PACJOZZEnHzLTylFup7bPhjtDvfbW6Od45PhEcGXBeG0osLIr-_1vMiPT-w7FknFzkoqECbm_xESJEiR4tMqRJEhQ44cBT5sFIlSwMenTJl36yEeVaoEBDR4s3EkToMmTVq0GJskkqRF2-nwatNImg4d5pxbk0WyaKdLlxuTR_J06Tl9XmwRKdKnz6JzbUpIiWVnwIBnW0EqDFh1Qq5MjWiNkJAnW4dLMwUXZhrOzQw86ll40PNwrxfgTi_BRK_AWK8BeHvrm4cb_AGLDzCQ',
    at: 'Class_Blaster',
  },
  'a Tanker stopped at level 30': {
    link: 'eJw9yEkSwWAQgNGvM_wyIyFaOhxCWbiSnXuYOYdDKGUoLqXKwls-SYWL__ZBzwYOPDwCAhwf_YUjIiIh4WSCEzIyCgp6HM3H-fQoKRkw4GAhLqSmRlEa9tYh6NDQ0vLWGInZWYqkvDRHcp7aRbpsrY_0eWiFVGxsiAy56wgZsbYx3NTgqhP-puFytljN-QKP0RNp',
    at: 'Class_Tanker',
    endLevel: 29,
  },
  'a Peacebringer': {
    link: 'eJwdyEtOwlAUgOG_LT28yxsqYrF4brVghRoHbsmZS1CjJq5GVwQ-UCZo4kidmdx8s88JHJ7cRxfCbwUBF5cCBYQHY0MoUaJChS91EIcaNQICmnyqh3g0adOmS5et-ohPnz4hIUM2WkSKDBkxIiLiQ8tImYh9K-Zdq0iVmJgDa611pI5aCQlv2kAaJBxaKa_aQlqkpEytF-0gHY6tjIxn7SE9MuZWzkoHeANycpa6A_dmF-7MHtyaMdyYCVwbA1fmCP50Br96Aj-6APAvTs8vz_gHH-wj_Q',
    at: 'Class_Peacebringer',
  },
  'an Arachnos Soldier with a branch': {
    link: 'eJwdyDlOw1AUQNH74_hlcubpEYLBEAwGDBhR0LwF0bEL5iwthLGgCBIFEqwC6et0x0UOtwxA_wwESpQoU0aYqw-hSpU6dX7NIY6IiBYtOvxYgAR06NFjwIBvC5GQESMUZcKXVZAKE6ZMiYl51BpSI2bLS1hZA2mQkLDjfVoTaTLzUlIetI20SdnzMj6si3TJyDjw7rWP9DnycnLudIgMyTnxCm51TDCmoOBG1-Dd1uFaN-DNNuHVtuHFduHZ9mFph_Bkx7CwU4Dw8uzi6px_LdIjaQ',
    at: 'Class_Arachnos_Soldier',
  },
  'a Praetorian Corruptor': {
    link: 'eJwdyGkyA0EYgOG3MzNf9n0bESNDGxkMRrqrcqVU-eEItnAxgnAA61EoVV3Pv0f5yr9U5xDeGxAoUMDHR3izLoQSJSpUuDMKUdSo0aBBi6XxEI8WHTr06HFrAiRgwICQkBE3pogUGTFmTETEqy0jZSImTsy1qSJVYmJ2nbWtI3W0k5DwYptIk4R9J-XKtJE2KSkHzrPtIl2OnIyMv1kf6ZNx4uQ82SHekJyc39kGrOwmPNoteLDb8KN34FvvwZeewqc-hA99DO_6FCBYnM0vDP81JSNL',
    at: 'Class_Corruptor',
    alignment: 'Praetorian',
  },
  'a respec to 50 (Brute)': {
    link: 'eJwdyMkyxFAUgOE_Sef0PE_RWghXdBCky-LU3XsYO49mZquN_QZ08y6qbn27z_M9LmYQPSsI-PiUKCEsrQuhQoUaNZ7UQzwaNGjRosOjBkhAhx49Bgx40BAJGTEiImLCvZaRMhOmTImJ-bJVpErMjpNwp3WkTkLCnvNpm0gT46SkfNg20iblwMm41S7SJSPj0Hm3faTPsZOTc6NDZEjOqVPwZscEYwoKrnUDXu0mLOwWvNht-DO78Gv2YW1msDJH8GNO4NucAYSXc706n_8Dsbsj7A',
    at: 'Class_Brute',
    respecTo: 49,
  },
};

describe('share links made today', () => {
  const gd = loadData();
  it.each(Object.entries(GOLDEN))('open %s with nothing repaired and no rule broken', async (_, g) => {
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
  // Sets the game hides (SetRequires false, e.g. ones still in development) can't be played, so
  // they aren't walked.
  const ctx = { ownsPower: () => false, ownsSet: () => false, prop: () => 0 };
  const playable = (cat: string) => gd.setsInCategory(cat).filter((s) => !s.spa && s.p.length > 0 && evalRequires(s.sr, ctx));
  // each primary and each secondary at least once, paired in turn
  it.each(gd.core.archetypes.map((a) => [a.dn, a] as const))('%s: picking the first choice at every level breaks no rule', (_, at) => {
    const pri = playable(at.cats.pri);
    const sec = playable(at.cats.sec);
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
