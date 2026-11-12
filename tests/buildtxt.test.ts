import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkBuild } from '../src/engine/validate.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { leveledSlotShortfall, lowestFreeLevels } from '../src/engine/schedule.ts';
import { finishBuildTxt, isBuildTxt, parseBuildTxt, readBuildTxt } from '../src/io/buildtxt.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();

// A made-up character in Homecoming's /build_save layout (tabs before the slot lines). Level 1's
// secondary is listed before its primary, unknown powers come in three kinds, and the badge list
// after the power list is ignored.
const SAMPLE = [
  'Example Guy: Level 12 Science Class_Blaster',
  '',
  'Character Profile:',
  '------------------',
  'Level 1: Inherent Inherent Brawl',
  '\tEMPTY',
  'Level 1: Inherent Fitness Stamina',
  '\tCrafted_Recovery (10)',
  '\tEMPTY',
  'Level 1: Blaster_Support Gadgets Caltrops',
  '\tScience_Damage (13)',
  'Level 1: Blaster_Ranged Fire_Blast Flares',
  '\tCrafted_Far_Strike_A (12+2)',
  '\tCrafted_Far_Strike_B (12)',
  '\tAttuned_Far_Strike_C (12)',
  'Level 2: Blaster_Ranged Fire_Blast Fire_Blast',
  '\tCrafted_Accuracy (10)',
  '\tEMPTY',
  'Level 4: Blaster_Support Gadgets Taser',
  '\tEMPTY',
  'Level 6: Pool Leaping Combat_Jumping',
  '\tEMPTY',
  'Level 0: Pool Leaping Double_Jump',
  'Level 8: Blaster_Ranged Fire_Blast Fire_Breath',
  '\tEMPTY',
  'Level 10: Blaster_Support Gadgets Targeting_Drone',
  '\tEMPTY',
  'Level 12: Blaster_Ranged Fire_Blast Aim',
  '\tEMPTY',
  'Level 12: Temporary_Powers Temporary_Powers Made_Up_Temp',
  '\tEMPTY',
  'Level 12: Inherent Inherent prestige_Made_Up',
  '\tCrafted_Damage (50)',
  'Level 5: Blaster_Ranged Fire_Blast Not_A_Power',
  '------------------',
  'Badges Earned:',
  '------------------',
  'Level10',
  '',
].join('\r\n');

/** @return SAMPLE with Aim's single slot replaced by these slot lines. */
const withAimSlots = (lines: string[]) => SAMPLE.replace('Blaster_Ranged Fire_Blast Aim\r\n\tEMPTY', ['Blaster_Ranged Fire_Blast Aim', ...lines].join('\r\n'));

describe('build.txt (/build_save)', () => {
  it('recognises the file and nothing else', () => {
    expect(isBuildTxt(SAMPLE)).toBe(true);
    expect(isBuildTxt('https://example.invalid/#b=abc')).toBe(false);
    expect(isBuildTxt('|MBD;abc')).toBe(false);
    expect(isBuildTxt('{"Class":"Class_Blaster"}')).toBe(false);
    // Mids' text export names the archetype by its display name; a Mids data chunk goes to Mids
    expect(isBuildTxt(SAMPLE.replace('Class_Blaster', 'Blaster'))).toBe(false);
    expect(isBuildTxt(`${SAMPLE}\r\n|MBD;1;1;1;BASE64;|\r\n|AAAA|`)).toBe(false);
  });

  it('parses the header, powers and slots, and stops at the badges', () => {
    const t = parseBuildTxt(SAMPLE);
    expect(t).toMatchObject({ name: 'Example Guy', level: 12, origin: 'Science', archetype: 'Class_Blaster', skipped: [] });
    expect(t.powers.map((p) => p.name)).toContain('Pool.Leaping.Double_Jump');
    expect(t.powers.find((p) => p.name === 'Blaster_Ranged.Fire_Blast.Flares')).toEqual({
      level: 1,
      name: 'Blaster_Ranged.Fire_Blast.Flares',
      slots: [
        { name: 'Crafted_Far_Strike_A', level: 12, boosters: 2 },
        { name: 'Crafted_Far_Strike_B', level: 12, boosters: 0 },
        { name: 'Attuned_Far_Strike_C', level: 12, boosters: 0 },
      ],
    });
    expect(t.powers.find((p) => p.name === 'Blaster_Ranged.Fire_Blast.Fire_Blast')?.slots).toEqual([{ name: 'Crafted_Accuracy', level: 10, boosters: 0 }, null]);
    expect(t.powers.some((p) => p.name.startsWith('Level10'))).toBe(false);
    expect(() => parseBuildTxt('not a build')).toThrow(/build_save/);
  });

  it('places picks, granted slots and enhancement values', () => {
    const imp = readBuildTxt(gd, SAMPLE);
    const b = imp.build;
    expect(imp.level).toBe(11);
    expect(imp.summary).toMatch(/^Example Guy: level 12 Science Blaster, /);
    expect(b.at).toBe(gd.archetypeByName.get('class_blaster')!.id);
    expect(b.primary).toBe(sid(gd, 'Blaster_Ranged.Fire_Blast'));
    expect(b.secondary).toBe(sid(gd, 'Blaster_Support.Gadgets'));
    expect(b.endLevel).toBe(11);
    // level 1's primary takes pick 0 though the file lists the secondary first
    expect(b.picks[0]?.power).toBe(pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'));
    expect(b.picks[1]?.power).toBe(pid(gd, 'Blaster_Support.Gadgets.Caltrops'));
    expect(b.picks[2]?.power).toBe(pid(gd, 'Blaster_Ranged.Fire_Blast.Fire_Blast'));
    expect(b.picks[7]?.power).toBe(pid(gd, 'Blaster_Ranged.Fire_Blast.Aim'));
    expect(b.picks.filter(Boolean)).toHaveLength(8);
    const flares = b.picks[0]!.slots.map((s) => s.enh);
    expect(flares[0]).toEqual({ boost: pid(gd, 'Boosts.Crafted_Far_Strike_A.Crafted_Far_Strike_A'), ioLevel: 11, boosters: 2 });
    expect(flares[1]).toEqual({ boost: pid(gd, 'Boosts.Crafted_Far_Strike_B.Crafted_Far_Strike_B'), ioLevel: 11 });
    expect(flares[2]).toEqual({ boost: pid(gd, 'Boosts.Attuned_Far_Strike_C.Attuned_Far_Strike_C') }); // attuned: follows the character
    expect(b.picks[1]!.slots[0]!.enh).toEqual({ boost: pid(gd, 'Boosts.Science_Damage.Science_Damage'), rel: 1 }); // an SO one level above the character
    const stamina = b.granted[pid(gd, 'Inherent.Fitness.Stamina')]!;
    expect(stamina.slots).toHaveLength(2);
    expect(stamina.slots[0]!.enh?.boost).toBe(pid(gd, 'Boosts.Crafted_Recovery.Crafted_Recovery'));
    // a granted power with one empty slot and no added ones is left to the defaults
    expect(b.granted[pid(gd, 'Inherent.Inherent.Brawl')]).toBeUndefined();
    // unknown powers: warned in the build's own categories or when they hold enhancements
    expect(imp.warnings).toHaveLength(2);
    expect(imp.warnings.join('\n')).toMatch(/prestige Made Up/);
    expect(imp.warnings.join('\n')).toMatch(/Not A Power/);
    expect(imp.leveledBlock).toBeNull();
  });

  it('gives a respec its slot levels, and keeps each power slot order', () => {
    const imp = readBuildTxt(gd, SAMPLE);
    const b = finishBuildTxt(gd, imp, { alignment: 'Villain', respec: true });
    expect(b.alignment).toBe('Villain');
    expect(b.respecTo).toBe(11);
    // lowest free slot level at or after each power's level, earliest powers first
    expect(b.picks[0]!.slots.map((s) => s.level)).toEqual([0, 2, 2]);
    expect(b.picks[2]!.slots.map((s) => s.level)).toEqual([1, 4]);
    expect(b.granted[pid(gd, 'Inherent.Fitness.Stamina')]!.slots.map((s) => s.level)).toEqual([0, 4]);
    expect(b.picks[0]!.slots.map((s) => s.enh?.boost)).toEqual(imp.build.picks[0]!.slots.map((s) => s.enh?.boost));
    const { build, fixes } = checkBuild(gd, b);
    expect(fixes).toEqual([]);
    expect(new BuildRules(gd, build!).issues()).toEqual([]);
  });

  it('gives a leveling build slot levels the slot schedule allows', () => {
    const b = finishBuildTxt(gd, readBuildTxt(gd, SAMPLE), { alignment: 'Hero', respec: false });
    expect(b.respecTo).toBeUndefined();
    const { build, fixes } = checkBuild(gd, b);
    expect(fixes).toEqual([]);
    expect(new BuildRules(gd, build!).issues()).toEqual([]);
  });

  it('rules out leveling when the slots could not have come from it', () => {
    const imp = readBuildTxt(gd, withAimSlots(['\tEMPTY', '\tEMPTY', '\tEMPTY', '\tEMPTY']));
    expect(imp.leveledBlock).toBe('Aim (taken at level 12) has 3 added slots, but leveling gives only 0 slots from level 12 on.');
    const b = finishBuildTxt(gd, imp, { alignment: 'Hero', respec: true });
    expect(new BuildRules(gd, b).issues()).toEqual([]); // a respec may put any slot on any power
  });

  it('survives a share link round trip', async () => {
    const b = finishBuildTxt(gd, readBuildTxt(gd, SAMPLE), { alignment: 'Praetorian', respec: true });
    const back = await decodeShare(await encodeShare(b));
    expect(back).toMatchObject({ name: 'Example Guy', alignment: 'Praetorian', respecTo: 11, picks: b.picks });
  });

  // a real /build_save file on this machine (set HCP_BUILDTXT_SAMPLE to its path); skipped when
  // unset, so no character or account names live in the repository
  const local = process.env.HCP_BUILDTXT_SAMPLE ?? '';
  it.skipIf(!local || !existsSync(local))('imports a real /build_save file (HCP_BUILDTXT_SAMPLE)', () => {
    const imp = readBuildTxt(gd, readFileSync(local, 'utf-8'));
    expect(imp.warnings).toEqual([]);
    expect(imp.build.picks.filter(Boolean).length).toBeGreaterThanOrEqual(22);
    for (const respec of imp.leveledBlock ? [true] : [true, false]) {
      const { build, fixes } = checkBuild(gd, finishBuildTxt(gd, imp, { alignment: 'Hero', respec }));
      expect(fixes).toEqual([]);
      expect(new BuildRules(gd, build!).issues()).toEqual([]);
    }
  });
});

describe('slot level schedule helpers', () => {
  it('finds the level a leveled history runs out of slots', () => {
    const sched = [2, 2, 4, 48, 48, 48];
    expect(leveledSlotShortfall([{ level: 0, count: 3 }, { level: 47, count: 3 }], sched)).toBeNull();
    expect(leveledSlotShortfall([{ level: 0, count: 2 }, { level: 47, count: 4 }], sched)).toEqual({ level: 47, need: 4, have: 3 });
    expect(leveledSlotShortfall([{ level: 3, count: 5 }], sched)).toEqual({ level: 3, need: 5, have: 4 });
  });

  it('hands out the lowest free level at or after each power, earliest powers first', () => {
    expect(lowestFreeLevels([4, 2, 2, 6], [3, 0, 0], 9)).toEqual([4, 2, 2]);
    expect(lowestFreeLevels([2, 4], [5, 0], 9)).toEqual([4, 2]); // nothing high enough: the highest free one
    expect(lowestFreeLevels([2], [0, 0], 9)).toEqual([2, 9]); // nothing left: the fallback
  });
});
