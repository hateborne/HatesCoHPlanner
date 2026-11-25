/**
 * Tag modes in the power info (the live clients' getChanceModString and getChanceModValue,
 * decompiled): a group whose first tag names a mode (Fiery Embrace, Dual Pistols' ammo, Homecoming's
 * ASTeamCrit) is listed whatever its chance, reads the mode's chance in place of its group's, and
 * carries the mode's note. Homecoming's client also reads a tagged group's parents' first tags;
 * Thunderspy's reads the group's own only and has no ASTeamCrit. Damage totals are left alone.
 */
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import type { Effect, Power } from '../src/data/types.ts';
import { powerInfo, segText } from '../src/engine/powerinfo.ts';
import { loadData } from './helpers/data.ts';

const L50 = 49;

/** @return A power's info at level 50, unenhanced: its stats as { label: text } and its lines. */
function info(gd: GameData, at: string, power: string | Power): { stats: Record<string, string>; lines: string[] } {
  const a = gd.archetypeByName.get(at.toLowerCase());
  const p = typeof power === 'string' ? gd.powerByName.get(power.toLowerCase()) : power;
  if (!a || !p) throw new Error(`no ${at} or ${String(power)}`);
  const pi = powerInfo(gd, a, p, L50, null);
  return {
    stats: Object.fromEntries(pi.stats.map((r) => [r.label, segText(r.value)])),
    lines: pi.effects.map((e) => [segText(e.line), ...e.notes.map(segText)].join(' / ')),
  };
}

/**
 * A made-up power: Blaster Flares with these groups in place of its own.
 *
 * @param gd The data.
 * @param eff The groups.
 * @return The power.
 */
function madeUp(gd: GameData, eff: Effect[]): Power {
  const p = gd.powerByName.get('blaster_ranged.fire_blast.flares');
  if (!p) throw new Error('no Flares');
  return { ...p, eff, act: undefined };
}

/** @return A group dealing 1 x Ranged_Damage fire damage (Blaster: 62.5631 at 50), with these fields. */
const fireGroup = (gd: GameData, g: Omit<Effect, 'm'>): Effect => ({
  ...g,
  m: [{ a: [gd.attribByName.get('DamageType02')!], asp: 'Absolute', t: 'Magnitude', tg: 'Affected', tbl: 'Ranged_Damage', sc: 1 }],
});

describe('tag modes on Homecoming', () => {
  const gd = loadData('i28p4');

  it('lists a Fiery Embrace group of chance 0 with its note, its damage left out of the total', () => {
    const { stats, lines } = info(gd, 'Class_Tanker', 'Tanker_Melee.War_Mace.Clobber');
    expect(lines).toContain('69.42 fire damage on target / Only using Fiery Embrace');
    expect(stats['Average Damage:']).toBe('154.27'); // the smashing hit alone, as before
  });

  it("lists each Dual Pistols ammo's groups with its note", () => {
    const { lines } = info(gd, 'Class_Sentinel', 'Sentinel_Ranged.Dual_Pistols.Executioners_Shot');
    expect(lines).toContain('129.69 lethal damage on target / Only using Standard Ammo');
    expect(lines).toContain('129.69 fire damage on target / Only using Incendiary Ammo');
    expect(lines).toContain('129.69 cold damage on target / Only using Cryo Ammo');
    expect(lines).toContain('129.69 toxic damage on target / Only using Chemical Ammo');
    // LethalKB70 (chance 0.7) reads 1: the client tries "Lethal" first
    expect(lines).toContain('1.66 magnitude knock on target / Only using Standard Ammo');
    // a SentCrit group takes its parent's mode; its tick chance is 0 (its own note from the info file)
    expect(lines).toContain('0.00% chance for 51.87 fire damage on target / Only using Incendiary Ammo / Opportunity');
  });

  it("shows Hail of Bullets' stand-in chances by the client's rule: the group's without a duration, else the tick's", () => {
    const { lines } = info(gd, 'Class_Sentinel', 'Sentinel_Ranged.Dual_Pistols.Hail_of_Bullets');
    // HailofBulletsKnockdown (0.05) has a duration, so its 0.1 tick chance shows
    expect(lines).toContain('10.00% chance for 0.40 magnitude knock for 2.30s on target / Only using Standard Ammo / Within 20ft radius');
    // HailofBulletsEndKnockback (0.4) has none
    expect(lines).toContain('40.00% chance for 0.40 magnitude knock on target after 2.30s delay / Only using Standard Ammo / Within 20ft radius');
    // HailofBulletsLethal reads 1 ("Lethal" first), so the 0.6 tick chance shows
    expect(lines).toContain('60.00% chance for 12 Ticks of 8.01 lethal damage over 2.30s on target / Only using Standard Ammo / Within 20ft radius');
  });

  it("gives ASTeamCrit its note and a chance of 0 (the client's chance table has no entry for it)", () => {
    const { stats, lines } = info(gd, 'Class_Stalker', 'Stalker_Melee.Brawling.Crushing_Uppercut');
    expect(lines).toContain('0.00% chance for 176.85 smashing damage on target / Chance increases the more allies are nearby');
    expect(lines.filter((l) => l.includes('allies'))).toHaveLength(1);
    // the total keeps the group's own 0.07: 3.18 x 55.6117 x (1 + 0.07)
    expect(stats['Average Damage:']).toBe('189.22');
  });

  it("reads only a line's own group's chance: a mode's parent group lends its sub-groups none", () => {
    // Thunder Strike's ASTeamCrit group (0.07) has no mods; its untagged sub-groups (chance 1) deal
    // the damage, and the game shows them without a chance (the owner's screenshot, November 17, 2026)
    const { lines } = info(gd, 'Class_Stalker', 'Stalker_Melee.Electrical_Melee.Lightning_Clap');
    expect(lines.filter((l) => l === '142.37 energy damage on target / Main Target Only')).toHaveLength(2);
    expect(lines).toContain('23.36 special damage on target');
    expect(lines.some((l) => l.includes('7.00% chance'))).toBe(false);
  });

  it("reads a tagged group's parents' first tags, passing over parents without tags", () => {
    const p = madeUp(gd, [
      { ch: 0, tag: ['FieryEmbrace'], sub: [{ sub: [fireGroup(gd, { tag: ['SentCrit', 'FireDamage'] })] }] },
    ]);
    expect(info(gd, 'Class_Blaster', p).lines).toEqual(['62.56 fire damage on target / Only using Fiery Embrace']);
  });

  it("reads the template's own Duration field for the rule, not a duration from a table", () => {
    // a stun of type Duration: its duration comes from Ranged_Stun, its Duration field is 0, so the
    // client shows the group's (the mode's 0.6) chance rather than the 0.5 tick chance
    const stun = { a: [gd.attribByName.get('Stunned')!], asp: 'Current', t: 'Duration', tg: 'Affected', tbl: 'Ranged_Stun', sc: 1, mag: 3, tc: 0.5 };
    const lines = info(gd, 'Class_Blaster', madeUp(gd, [{ tag: ['HailofBulletsFire'], m: [stun] }])).lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^60\.00% chance for 3\.00 magnitude stun for .* on target \/ Only using Incendiary Ammo$/);
    // with a Duration field of its own, the tick chance shows
    const timed = info(gd, 'Class_Blaster', madeUp(gd, [{ tag: ['HailofBulletsFire'], m: [{ ...stun, dur: 2 }] }])).lines;
    expect(timed[0]).toMatch(/^50\.00% chance for /);
  });

  it("doesn't list a tagged group of chance 0 whose tags name no mode (as the client)", () => {
    const p = madeUp(gd, [fireGroup(gd, { ch: 0, tag: ['Combo1', 'FieryEmbrace'] })]); // first tag only
    expect(info(gd, 'Class_Blaster', p).lines).toEqual([]);
  });

  it('lists an untagged group of chance 0, as the client does (it skips only a tagged one)', () => {
    const p = madeUp(gd, [fireGroup(gd, { ch: 0 })]);
    expect(info(gd, 'Class_Blaster', p).lines).toEqual(['0.00% chance for 62.56 fire damage on target']);
  });
});

describe("tag modes on Thunderspy (its client reads a group's own first tag only)", () => {
  const gd = loadData('ts9-6', 'thunderspy');
  const hc = loadData('i28p4');

  it("lists Dual Pistols' ammo groups with their notes", () => {
    const { lines } = info(gd, 'Class_Dominator', 'Dominator_Assault.Dual_Pistols.Piercing_Rounds');
    // the tag mode's note comes before the requirement notes ("Applies to enemies": a critter target)
    expect(lines).toContain('68.68 fire damage on target / Only using Incendiary Ammo / Applies to enemies');
    expect(lines).toContain('68.68 toxic damage on target / Only using Chemical Ammo / Applies to enemies');
  });

  it("doesn't read a parent's tag (Homecoming's does)", () => {
    const groups = (d: GameData): Effect[] => [{ tag: ['FieryEmbrace'], sub: [fireGroup(d, { tag: ['SentCrit'] })] }];
    expect(info(gd, 'Class_Blaster', madeUp(gd, groups(gd))).lines).toEqual(['62.56 fire damage on target']);
    expect(info(hc, 'Class_Blaster', madeUp(hc, groups(hc))).lines).toEqual(['62.56 fire damage on target / Only using Fiery Embrace']);
  });

  it('has no ASTeamCrit mode', () => {
    const p = madeUp(gd, [fireGroup(gd, { ch: 0.07, tag: ['ASTeamCrit'] })]);
    expect(info(gd, 'Class_Blaster', p).lines).toEqual(['7.00% chance for 62.56 fire damage on target']);
  });
});
