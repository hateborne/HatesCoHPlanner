import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BuildRules } from '../src/engine/rules.ts';
import { importMbd, importMidsText, parseMidsText, type Mbd, type MidsMap } from '../src/io/mids.ts';
import { loadData, pid } from './helpers/data.ts';
import { fixtureText as fixture, mbdFromChunk } from './helpers/fixtures.ts';

/**
 * The forum builds the browser recreation tests (e2e/) rebuild, all legal on the current patch: each
 * fixture imports here first, so a broken fixture or importer shows up in `npm test` and not only in
 * the browser run. The Sentinel is here for its save format alone; no browser test rebuilds it.
 */
const gd = loadData();
const map = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', gd.core.manifest.dataVersion, 'mids-map.json'), 'utf-8')) as MidsMap;

describe('forum build fixtures import', () => {
  it('Symphony / Dark Dominator (legacy |MxDz; chunk)', async () => {
    const { build, warnings } = await importMidsText(gd, map, fixture('symphony-dark-dominator.txt'));
    expect(gd.archetype(build.at).n).toBe('Class_Dominator');
    expect(gd.powerset(build.primary).n).toBe('Dominator_Control.Symphony_Control');
    expect(gd.powerset(build.secondary).n).toBe('Dominator_Assault.Dark_Assault');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(build.picks[22]?.power).toBe(pid(gd, 'Epic.Ice_Mastery_Dominator.Ice_Storm'));
    // four of its powers past the picks aren't in the map the planner ships: Mids' Afterburner (the
    // planner grants it with Fly, as Pool.Flight.Fly_Boost), its Fast_Snipe (no such power in the
    // game data) and two Incarnate powers (out of scope). None holds an enhancement, so they are left
    // out without a warning, as an .mbd's are
    expect(warnings).toEqual([]);
    expect(new BuildRules(gd, build).issues()).toEqual([]);
  });

  it('Archery / Traps Corruptor (|MBD; chunk), including a set Mids names differently', () => {
    const { build, warnings } = importMbd(gd, map, mbdFromChunk(fixture('archery-traps-corruptor.txt')));
    expect(gd.archetype(build.at).n).toBe('Class_Corruptor');
    expect(gd.powerset(build.primary).n).toBe('Corruptor_Ranged.Archery');
    expect(gd.powerset(build.secondary).n).toBe('Corruptor_Buff.Traps');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(warnings).toEqual([]);
    // Mids calls the Artillery set Crafted_Shrapnel: found by its full name instead
    const fistful = build.picks.find((p) => p?.power === pid(gd, 'Corruptor_Ranged.Archery.Fistful_of_Arrows'));
    expect(fistful?.slots.map((s) => (s.enh ? gd.power(s.enh.boost).n : null))).toEqual(
      ['A', 'C', 'E', 'F', 'D', 'B'].map((l) => `Boosts.Crafted_Artillery_${l}.Crafted_Artillery_${l}`),
    );
    expect(new BuildRules(gd, build).issues()).toEqual([]);
  });

  it('Electrical Melee / Sonic Aura Stalker (.mbd file), a leveling build that keeps its slot levels', () => {
    const { build, warnings } = importMbd(gd, map, JSON.parse(fixture('elec-sonic-stalker-leveling.mbd')) as Mbd);
    expect(gd.archetype(build.at).n).toBe('Class_Stalker');
    expect(gd.powerset(build.primary).n).toBe('Stalker_Melee.Electrical_Melee');
    expect(gd.powerset(build.secondary).n).toBe('Stalker_Defense.Sonic_Aura');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(build.respecTo).toBeUndefined();
    expect(warnings).toEqual([]); // its three accolades are out of scope and left out without a warning
    // each slot at the level it was gained (1-based): Havoc Punch is slotted from level 1 to 7
    const havoc = build.picks.find((p) => p?.power === pid(gd, 'Stalker_Melee.Electrical_Melee.Havoc_Punch'));
    expect(havoc?.slots.map((s) => s.level + 1)).toEqual([1, 3, 3, 5, 5, 7]);
    expect(new BuildRules(gd, build).issues()).toEqual([]);
  });

  /** The Hero Plan lines of a retail post: level and display name (the plan lists powers by display name). */
  const planOf = (text: string) =>
    [...text.matchAll(/^Level (\d+): ([^\n]*?)(?: --.*)?\s*$/gm)].map((m) => ({ level: Number(m[1]), name: m[2]!.trim() })).filter((e) => e.name);

  /** Every imported pick's display name is the plan's name at that level (a shared level: each name used once). */
  const expectPicksMatchPlan = (text: string, build: ReturnType<typeof importMbd>['build']) => {
    const plan = planOf(text);
    for (const p of build.picks) {
      if (!p) continue;
      const pw = gd.power(p.power);
      // a power the game renamed since (Afterburner is Evasive Maneuvers now) still has its old name in its internal name; every other pick matches by display name
      const old = (pw.n.split('.').pop() ?? '').replace(/_/g, ' ');
      const at = plan.findIndex((e) => e.level === p.level + 1 && (e.name === pw.dn || e.name === old));
      expect(at, `${pw.dn} at level ${p.level + 1}`).toBeGreaterThanOrEqual(0);
      plan.splice(at, 1);
    }
  };

  // retail-era Mids (1.95x) posts: the Hero Plan text, then a legacy |MxDz; chunk whose power indexes
  // the shipped map lacks for two powers; the posted plan names them
  it('retail Fire/Kin Controller: Afterburner comes from the Hero Plan text', async () => {
    const text = fixture('retail-fire-kin-controller.txt');
    const { build, warnings } = await importMidsText(gd, map, text);
    expect(gd.archetype(build.at).n).toBe('Class_Controller');
    expect(gd.powerset(build.primary).n).toBe('Controller_Control.Fire_Control');
    expect(gd.powerset(build.secondary).n).toBe('Controller_Buff.Kinetics');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(warnings).toEqual([]);
    const afterburner = build.picks.find((p) => p?.power === pid(gd, 'Pool.Flight.Afterburner'));
    expect(afterburner?.level).toBe(29); // level 30
    expectPicksMatchPlan(text, build);
    expect(new BuildRules(gd, build).issues().map((i) => i.message)).toEqual([]);
  });

  it('retail Inv/SS Tanker: Unyielding comes from the Hero Plan text', async () => {
    const text = fixture('retail-inv-ss-tanker.txt');
    const { build, warnings } = await importMidsText(gd, map, text);
    expect(gd.archetype(build.at).n).toBe('Class_Tanker');
    expect(gd.powerset(build.primary).n).toBe('Tanker_Defense.Invulnerability');
    expect(gd.powerset(build.secondary).n).toBe('Tanker_Melee.Super_Strength');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(warnings).toEqual([]);
    const unyielding = build.picks.find((p) => p?.power === pid(gd, 'Tanker_Defense.Invulnerability.Unyeilding_Stance'));
    expect(unyielding?.level).toBe(7); // level 8
    expectPicksMatchPlan(text, build);
    // Knockout Blow at level 20 is flagged: Homecoming moved it to level 24 (the build is legal on retail)
    const issues = new BuildRules(gd, build).issues();
    expect(issues.map((i) => i.message)).toEqual(['Available at level 24']);
    expect(gd.power(build.picks.find((p) => p?.level === 19)!.power).dn).toBe('Knockout Blow');
  });

  it('Archery / Bio Armor Sentinel (legacy |MxDz; chunk saved at version 3.10)', async () => {
    const text = fixture('archery-bio-sentinel.txt');
    // Mids save version 3.10: a power has ProcInclude but not the inherent-slot fields of 3.20
    const parsed = await parseMidsText(text);
    if (parsed.kind !== 'mxdz') throw new Error('not a legacy chunk');
    expect(new DataView(parsed.raw.buffer, parsed.raw.byteOffset).getFloat32(4, /*littleEndian=*/ true)).toBeCloseTo(3.1, 5);
    const { build, warnings } = await importMidsText(gd, map, text);
    expect(gd.archetype(build.at).n).toBe('Class_Sentinel');
    expect(gd.powerset(build.primary).n).toBe('Sentinel_Ranged.Archery');
    expect(gd.powerset(build.secondary).n).toBe('Sentinel_Defense.Bio_Organic_Armor');
    expect(build.picks.filter(Boolean)).toHaveLength(24);
    expect(build.picks.reduce((n, p) => n + (p ? p.slots.filter((s) => s.enh).length : 0), 0)).toBe(87);
    // the last powers of the code still read true: a reader a field out of step is lost long before them
    const dominate = build.picks.find((p) => p?.power === pid(gd, 'Epic.Sentinel_Psionic_Mastery.Dominate'));
    expect(dominate?.slots.map((s) => (s.enh ? gd.power(s.enh.boost).n : null))).toEqual(
      ['Gladiators_Net', 'Unbreakable_Constraint', 'Neuronic_Shutdown', 'Ghost_Widows_Embrace', 'Gladiators_Javelin', 'Decimation'].map(
        (set) => `Boosts.Crafted_${set}_F.Crafted_${set}_F`,
      ),
    );
    expect(build.picks[23]?.power).toBe(pid(gd, 'Pool.Flight.Fly'));
    expect(warnings).toEqual([]);
    expect(new BuildRules(gd, build).issues()).toEqual([]);
  });
});
