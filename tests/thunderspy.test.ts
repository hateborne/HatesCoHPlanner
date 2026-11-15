/**
 * Thunderspy, the second server: its own data (public/data/thunderspy/), its own stable ids, its
 * own copy of every icon, and no Mids or /build_save. Its builds must level to 50 and
 * round-trip through share links like Homecoming's, and never be read against Homecoming's ids.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serverById, SERVERS } from '../src/data/servers.ts';
import type { Archetype, Powerset } from '../src/data/types.ts';
import { carryOrigin, newBuild } from '../src/engine/build.ts';
import { boostPog, effectiveness, levelsAbove } from '../src/engine/enhance.ts';
import { BuildRules, isPatronSet, patronArcNote, startingSets } from '../src/engine/rules.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { ImportProblem, noBuildSave, wrongServer } from '../src/io/importProblem.ts';
import { loadMidsMap, midsUnavailable } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { icon } from '../src/ui/skin/skin.ts';
import { loadData, loadVersionIndex } from './helpers/data.ts';
import { walkTo50 } from './helpers/walk.ts';

const ts = loadData(undefined, 'thunderspy');
const hc = loadData();
const thunderspy = serverById('thunderspy')!;
const homecoming = serverById('homecoming')!;

describe('Thunderspy data', () => {
  it('is for Thunderspy, on a version only Thunderspy lists', () => {
    expect(ts.server).toBe('thunderspy');
    const own = loadVersionIndex('thunderspy');
    expect(own.versions.map((v) => v.id)).toContain(ts.core.manifest.dataVersion);
    expect(loadVersionIndex().versions.map((v) => v.id)).not.toContain(ts.core.manifest.dataVersion);
  });

  it("has Thunderspy's archetypes: Primalist, and no Sentinel", () => {
    const names = ts.core.archetypes.map((a) => a.n);
    expect(names).toHaveLength(15);
    expect(names).toContain('Class_Primalist');
    expect(names).not.toContain('Class_Sentinel');
  });

  it('gives every archetype a primary and a secondary to start with', () => {
    for (const at of ts.core.archetypes) {
      expect(startingSets(ts, at.cats.pri, at).length, at.n).toBeGreaterThan(0);
      expect(startingSets(ts, at.cats.sec, at).length, at.n).toBeGreaterThan(0);
    }
  });

  it('gives every enhancement frame art (borrowed from Homecoming, by name or set type)', () => {
    expect(ts.core.manifest.framesFrom).toBe('homecoming/i28p4');
    expect(ts.boosts.filter((b) => !b.bf).map((b) => b.n)).toEqual([]);
  });

  it('writes no Mids map: MidsReborn has no Thunderspy database', () => {
    expect(existsSync(join(process.cwd(), 'public', thunderspy.data, ts.core.manifest.dataVersion, 'mids-map.json'))).toBe(false);
  });
});

describe('Thunderspy icons', () => {
  const file = (url: string) => join(process.cwd(), 'public', url.slice(import.meta.env.BASE_URL.length));

  it("resolves its own art to its folder and everything else to the shared icons", () => {
    expect(icon('powers', 'thunderspy:ArcticMastery_Shiver')).toBe(`${import.meta.env.BASE_URL}assets/thunderspy/icons/powers/arcticmastery_shiver.png`);
    expect(icon('powers', 'Flares')).toBe(`${import.meta.env.BASE_URL}assets/icons/powers/flares.png`);
    // a prefix naming no server the site carries stays part of a shared name
    expect(icon('powers', 'evil:../x')).toBe(`${import.meta.env.BASE_URL}assets/icons/powers/evil:../x.png`);
  });

  it('has a file for every icon a player sees: powers of every set offered, enhancements, archetypes, origins', () => {
    const missing: string[] = [];
    const need = (kind: 'powers' | 'enh' | 'at' | 'origin', name: string | undefined, what: string) => {
      if (name && !existsSync(file(icon(kind, name)))) missing.push(`${what}: ${name}`);
    };
    for (const at of ts.core.archetypes) {
      need('at', at.icon, at.n);
      for (const cat of [at.cats.pri, at.cats.sec, at.cats.pool, at.cats.epic]) {
        for (const s of ts.setsInCategory(cat)) for (const p of s.p) need('powers', ts.power(p).icon, ts.power(p).n);
      }
    }
    for (const o of ts.core.origins) need('origin', o.icon, o.n);
    for (const b of ts.boosts) {
      need('enh', b.icon, b.n);
      for (const f of b.bf ?? []) need('enh', f, `${b.n} frame`);
      need('enh', boostPog(ts, b), `${b.n} pog`);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("shows only its own copies, so a later Homecoming redraw can't change them", () => {
    const shared: string[] = [];
    const own = (name: string | undefined, what: string) => {
      if (name && !name.startsWith('thunderspy:')) shared.push(`${what}: ${name}`);
    };
    for (const at of ts.core.archetypes) {
      own(at.icon, at.n);
      for (const cat of [at.cats.pri, at.cats.sec, at.cats.pool, at.cats.epic]) {
        for (const s of ts.setsInCategory(cat)) for (const p of s.p) own(ts.power(p).icon, ts.power(p).n);
      }
    }
    for (const o of ts.core.origins) own(o.icon, o.n);
    for (const b of ts.boosts) {
      own(b.icon, b.n);
      for (const f of b.bf ?? []) own(f, `${b.n} frame`);
    }
    expect([...new Set(shared)]).toEqual([]);
  });
});

/**
 * Whether the game lets a primary go with a secondary: some sets forbid each other through their
 * powers' BuyRequires (Thunderspy's Katana, Staff Fighting and Titan Weapons with Shield Defense).
 */
function goTogether(at: Archetype, pri: Powerset, sec: Powerset): boolean {
  const b = newBuild({ dataVersion: ts.core.manifest.dataVersion, at: at.id, origin: ts.core.origins[0]!.id, alignment: 'Hero', primary: pri.id, secondary: sec.id, pickCount: ts.core.schedule.power.length });
  const r = new BuildRules(ts, b);
  // level 1's first pick is from the primary, its second from the secondary
  const free = (s: Powerset, pick: number) => s.p.some((p, i) => s.av[i] === 0 && r.powerOption(p, pick).state === 'available');
  return free(pri, 0) && free(sec, 1);
}

describe('Thunderspy builds', () => {
  // every set New Build offers, each primary and each secondary at least once, paired in turn (a
  // pair the game forbids takes the next secondary that goes with that primary)
  it.each(ts.core.archetypes.map((a) => [a.dn, a] as const))('%s: picking the first choice at every level breaks no rule', (_, at) => {
    const pri = startingSets(ts, at.cats.pri, at);
    const sec = startingSets(ts, at.cats.sec, at);
    const bad: string[] = [];
    const usedSec = new Set<number>();
    for (let k = 0; k < Math.max(pri.length, sec.length); k++) {
      const p = pri[k % pri.length]!;
      let j = k;
      while (!goTogether(at, p, sec[j % sec.length]!) && j < k + sec.length) j++;
      const s = sec[j % sec.length]!;
      usedSec.add(s.id);
      const b = walkTo50(ts, at.n, p.id, s.id);
      const r = new BuildRules(ts, b);
      const unplaced = [...new Set(ts.core.schedule.slot)].reduce((n, l) => n + r.slotsLeft([l]), 0);
      const issues = r.issues().map((x) => x.message);
      if (issues.length || unplaced) bad.push(`${p.n} / ${s.n}: ${issues.join('; ')}${unplaced ? ` (${unplaced} slots unplaced)` : ''}`);
    }
    expect(bad).toEqual([]);
    // every secondary still leveled with some primary
    const unused = sec.filter((s) => !usedSec.has(s.id) && !pri.some((p) => goTogether(at, p, s) && walkTo50(ts, at.n, p.id, s.id)));
    expect(unused.map((s) => s.n)).toEqual([]);
  }, 60_000);

  it('round-trip through a share link, tied to Thunderspy once checked against its data', async () => {
    const at = ts.archetypeByName.get('class_primalist')!;
    const b = walkTo50(ts, at.n, startingSets(ts, at.cats.pri, at)[0]!.id, startingSets(ts, at.cats.sec, at)[0]!.id);
    const back = await decodeShare(await encodeShare(b));
    expect(back.dataVersion).toBe(ts.core.manifest.dataVersion);
    const { build, fixes } = checkBuild(ts, back);
    expect(fixes).toEqual([]);
    expect(build!.server).toBe('thunderspy');
    expect(build!.picks).toEqual(b.picks);
  });
});

describe('Thunderspy totals', () => {
  it("reads its client's Knockback as the engine's Knock, so knockback protection counts", () => {
    // Homecoming's client calls offset 328 Knock (alias Knockback); Thunderspy's calls it Knockback
    expect(ts.core.attribs['328']!.name).toBe('Knockback');
    expect(ts.attribName.get(328)).toBe('Knock');
    expect(ts.attribByName.get('Knockback')).toBe(328);
    for (const gd of [hc, ts]) {
      const at = gd.archetypeByName.get('class_blaster')!;
      const b = newBuild({ dataVersion: gd.core.manifest.dataVersion, at: at.id, origin: gd.core.origins[0]!.id, alignment: 'Hero', primary: startingSets(gd, at.cats.pri, at)[0]!.id, secondary: startingSets(gd, at.cats.sec, at)[0]!.id, pickCount: gd.core.schedule.power.length });
      const acro = gd.powerByName.get('pool.leaping.leap')!; // Acrobatics
      b.picks[10] = { power: acro.id, level: gd.core.schedule.power[10]!, slots: [{ level: gd.core.schedule.power[10]! }] };
      const prot = computeTotals(gd, new BuildRules(gd, b), b).lines.get('mezprot.Knock');
      expect(prot?.value, gd.server).toBeGreaterThan(0);
    }
  });
});

describe('Thunderspy enhancement levels (its client, not the source)', () => {
  const io = (gd: typeof ts) => gd.powerByName.get('boosts.crafted_accuracy.crafted_accuracy')!;
  const so = (gd: typeof ts) => gd.powerByName.get('boosts.magic_accuracy.magic_accuracy')!;

  it('works an IO or set piece only at or above its own level (power_MinBoostUseLevel)', () => {
    expect(levelsAbove(hc)).toBe(3);
    expect(levelsAbove(ts)).toBe(0);
    for (const [gd, at47] of [[hc, 1], [ts, 0]] as const) {
      const b = io(gd);
      expect(effectiveness(gd, b, { boost: b.id, ioLevel: 49 }, 46), gd.server).toBe(at47);
      expect(effectiveness(gd, b, { boost: b.id, ioLevel: 49 }, 49), gd.server).toBe(1);
    }
  });

  it("keeps TO/DO/SO-style pieces at full strength at any level: its tables are 50 flat entries", () => {
    expect(ts.core.boostEffect.above).toHaveLength(50);
    for (const rel of [-10, -3, 0, 3, 10]) {
      const b = so(ts);
      expect(effectiveness(ts, b, { boost: b.id, rel }, 30), String(rel)).toBe(1);
    }
    // Homecoming's: +/- 3 levels, 5% a level above, 10% a level below
    const h = so(hc);
    expect(effectiveness(hc, h, { boost: h.id, rel: 3 }, 30)).toBeCloseTo(1.15);
    expect(effectiveness(hc, h, { boost: h.id, rel: -10 }, 30)).toBe(0);
  });
});

describe('Thunderspy and the other server', () => {
  it('carries the origin over by name: each server numbers origins on its own', () => {
    for (const o of hc.core.origins) {
      const there = ts.core.origins.find((x) => x.n === o.n);
      expect(carryOrigin(o.id, hc.core.origins, ts.core.origins), o.n).toBe(there?.id);
    }
    expect(carryOrigin(undefined, hc.core.origins, ts.core.origins)).toBeUndefined();
    // no old data to read the name from: the id is only kept when the new data has it
    expect(carryOrigin(ts.core.origins[0]!.id, undefined, ts.core.origins)).toBe(ts.core.origins[0]!.id);
    expect(carryOrigin(99999, undefined, ts.core.origins)).toBeUndefined();
  });

  it("refuses a code whose version is one server's at an address naming another, in words", () => {
    const p = wrongServer(thunderspy, homecoming);
    expect(p).toBeInstanceOf(ImportProblem);
    expect(p.reason).toBe("the build was made on Thunderspy's game data, but the link's address names Homecoming");
    expect(p.fix).toBe('Open it on Thunderspy: change "/Homecoming/" in the link to "/Thunderspy/".');
  });

  it('refuses Mids on Thunderspy before fetching anything, and points Mids builds to Homecoming', async () => {
    await expect(loadMidsMap(ts)).rejects.toBeInstanceOf(ImportProblem);
    const p = midsUnavailable(thunderspy);
    expect(p.reason).toBe("MidsReborn has no Thunderspy database, so Thunderspy builds can't come from or go to Mids");
    expect(p.fix).toContain('A Mids build made for Homecoming imports after switching to Homecoming on New Build.');
  });

  it('refuses a /build_save file on Thunderspy and says where it goes', () => {
    const p = noBuildSave(thunderspy, SERVERS.filter((s) => s.buildSave));
    expect(p.reason).toBe("a /build_save file comes from Homecoming's game client, not Thunderspy's");
    expect(p.fix).toBe('Switch to Homecoming on New Build, then import it there.');
  });

  it("keeps the Patron note on Thunderspy, without Homecoming's wiki link", () => {
    const patron = ts.core.archetypes
      .flatMap((a) => ts.setsInCategory(a.cats.epic))
      .find((s) => isPatronSet(ts, s));
    // release 9.6 has them (30); a release without any must fail here, not pass having checked nothing
    expect(patron, 'a Patron pool in the Thunderspy data').toBeDefined();
    const at = ts.core.archetypes.find((a) => ts.setsInCategory(a.cats.epic).includes(patron!))!;
    const b = walkTo50(ts, at.n, startingSets(ts, at.cats.pri, at)[0]!.id, startingSets(ts, at.cats.sec, at)[0]!.id);
    const note = patronArcNote(ts, { ...b, alignment: 'Hero' }, patron!);
    expect(note?.text).toContain('is a Patron pool');
    expect(note?.link).toBeUndefined();
  });
});
