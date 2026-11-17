/**
 * The live client's power-info requirement check (infoRequires, Homecoming 0x1404dfdd0, decompiled)
 * and what it lists: every Combo Level and "Only if hidden" group, as in game (the owner's
 * screenshots, November 17, 2026), but not another archetype's.
 */
import { describe, expect, it } from 'vitest';
import { powerInfo, segText } from '../src/engine/powerinfo.ts';
import { infoRequires } from '../src/engine/requires.ts';
import { loadData } from './helpers/data.ts';

const r = (s: string) => s.split(' ');

describe('infoRequires', () => {
  it('tells the caster\'s and the creator\'s archetype apart', () => {
    expect(infoRequires(r('arch source> Class_Stalker eq'), 'Class_Stalker', null)).toBe(true);
    expect(infoRequires(r('arch source> class_stalker eq'), 'Class_Stalker', null)).toBe(true);
    expect(infoRequires(r('arch source> Class_Scrapper eq'), 'Class_Stalker', null)).toBe(false);
    expect(infoRequires(r('arch source.owner> Class_Brute eq'), 'Class_Minion_Pets', 'Class_Brute')).toBe(true);
    expect(infoRequires(r('arch source.creator> Class_Brute eq'), 'Class_Minion_Pets', null)).toBe(false);
    // a target's archetype isn't checked
    expect(infoRequires(r('arch target> Class_Minion_Grunt eq'), 'Class_Scrapper', null)).toBe(true);
  });

  it('reads a critter target as met and a player target as not, in PvE', () => {
    expect(infoRequires(r('enttype target> critter eq'), 'Class_Blaster', null)).toBe(true);
    expect(infoRequires(r('enttype target> player eq'), 'Class_Blaster', null)).toBe(false);
    expect(infoRequires(r('enttype target> player eq'), 'Class_Blaster', null, /*pvp=*/ true)).toBe(true);
    expect(infoRequires(r('isPVPMap?'), 'Class_Blaster', null)).toBe(false);
  });

  it('reads owned powers, with or without a ! after them, as met', () => {
    const c = 'Temporary_Powers.Temporary_Powers.Combo_Level_';
    const level0 = `${c}1 source.ownPower? ! ${c}2 source.ownPower? ! && ${c}3 source.ownPower? ! &&`;
    expect(infoRequires(r(level0), 'Class_Stalker', null)).toBe(true);
    expect(infoRequires(r(`${c}2 source.ownPower?`), 'Class_Stalker', null)).toBe(true);
  });

  it('reads values and comparisons as true, and works && || ! eq on them', () => {
    expect(infoRequires(r('kMeter source> 0 >'), 'Class_Stalker', null)).toBe(true);
    expect(infoRequires(r('kMeter source> .9 < enttype target> critter eq &&'), 'Class_Stalker', null)).toBe(true);
    expect(infoRequires(r('kStormCell Source.Mode?'), 'Class_Blaster', null)).toBe(true);
    expect(infoRequires(r('enttype target> player eq arch source> Class_Blaster eq ||'), 'Class_Blaster', null)).toBe(true);
    // "not targeting itself" reads false: both sides are 1
    expect(infoRequires(r('entref target> entref source> eq !'), 'Class_Minion_Pets', 'Class_Controller')).toBe(false);
  });
});

describe('the lines the client lists for requirements', () => {
  const gd = loadData('i28p4');
  const lines = (cls: string, name: string) =>
    powerInfo(gd, gd.archetypeByName.get(cls)!, gd.powerByName.get(name)!, 49, null).effects.map((e) =>
      [segText(e.line), ...e.notes.map(segText)].join(' / '),
    );

  it("lists every Combo Level and the hidden line of Crushing Uppercut, in the game's order", () => {
    const got = lines('class_stalker', 'stalker_melee.brawling.crushing_uppercut').filter((l) => !l.startsWith('Grants'));
    expect(got).toEqual([
      '176.85 smashing damage on target / Only at Combo Level 0',
      '3.00 magnitude stun for 8.94s on target / Only at Combo Level 0',
      '185.69 smashing damage on target / Only at Combo Level 1',
      '3.00 magnitude stun for 10.28s on target / Only at Combo Level 1',
      '198.07 smashing damage on target / Only at Combo Level 2',
      // @TODO the game shows 11.18s: it multiplies in single precision (not ported yet)
      '3.00 magnitude stun for 11.17s on target / Only at Combo Level 2',
      '221.06 smashing damage on target / Only at Combo Level 3',
      '3.00 magnitude stun for 12.52s on target / Only at Combo Level 3',
      '3.00 magnitude hold for 12.52s on target / Only at Combo Level 3',
      '176.85 smashing damage on target / Only if hidden or target placated',
      '0.00% chance for 176.85 smashing damage on target / Chance increases the more allies are nearby',
      '6.23 magnitude knockup on target',
    ]);
  });

  it("lists Thunder Strike's hidden lines and keeps its damage as in game", () => {
    const got = lines('class_stalker', 'stalker_melee.electrical_melee.lightning_clap');
    expect(got.slice(0, 4)).toEqual([
      '142.37 energy damage on target',
      '23.36 energy damage on target',
      '149.31 energy damage on target / Only if hidden or target placated',
      '50.00% chance for 21.04 special damage on target / Only if hidden or target placated',
    ]);
    const s = powerInfo(gd, gd.archetypeByName.get('class_stalker')!, gd.powerByName.get('stalker_melee.electrical_melee.lightning_clap')!, 49, null).stats;
    expect(segText(s[0]!.value)).toBe('331.45'); // the hidden lines carry a note, so they don't count
  });
});

describe("Thunderspy's client checks an effect's own group only", () => {
  const ts = loadData('ts9-6', 'thunderspy');

  it("lists Twilight Shield's effects under a parent group the check reads as false", () => {
    // Thunderspy's Twilight Shield nests its 7 mods under "kWarshade_Blaster_Mode Source.Mode? !",
    // which reads false (the ? pops two, the ! negates); Homecoming's client would hide them all
    expect(infoRequires(r('kWarshade_Blaster_Mode Source.Mode? !'), 'Class_Warshade', null)).toBe(false);
    const p = ts.powerByName.get('warshade_defensive.umbral_aura.twilight_shield')!;
    expect(powerInfo(ts, ts.archetypeByName.get('class_warshade')!, p, 49, null).effects.length).toBeGreaterThan(0);
  });
});

describe("each client's notes read the requirements its check reads", () => {
  // a hit under a parent group gated on being hidden: Homecoming's client notes it from the parent
  // and leaves it out of the damage; Thunderspy's reads only the hit's own group, so neither
  const lines = (server: 'homecoming' | 'thunderspy') => {
    const gd = server === 'homecoming' ? loadData('i28p4') : loadData('ts9-6', 'thunderspy');
    const base = gd.powerByName.get('blaster_ranged.fire_blast.flares')!;
    const fire = { a: [gd.attribByName.get('DamageType02')!], asp: 'Absolute', t: 'Magnitude', tg: 'Affected', tbl: 'Ranged_Damage', sc: 1 };
    const p = { ...base, act: undefined, eff: [{ req: r('kMeter source> 0 >'), sub: [{ m: [fire] }] }] };
    const pi = powerInfo(gd, gd.archetypeByName.get('class_blaster')!, p, 49, null);
    const avg = pi.stats.find((s) => s.label === 'Average Damage:');
    return { lines: pi.effects.map((e) => [segText(e.line), ...e.notes.map(segText)].join(' / ')), dmg: avg ? segText(avg.value) : null };
  };

  it('notes and leaves out the hit on Homecoming', () => {
    const hc = lines('homecoming');
    expect(hc.lines).toEqual(['62.56 fire damage on target / Only if hidden or target placated']);
    expect(hc.dmg).toBe(null);
  });

  it('lists and counts it bare on Thunderspy', () => {
    const ts = lines('thunderspy');
    expect(ts.lines).toEqual([expect.stringMatching(/^[\d.]+ fire damage on target$/)]);
    expect(ts.dmg).not.toBe(null);
    expect(ts.lines[0]!.startsWith(ts.dmg!)).toBe(true);
  });
});

describe('Thunderspy\'s "Applies to" note (the owner\'s screenshots, Thunderspy, level 50, November 17, 2026)', () => {
  const ts = loadData('ts9-6', 'thunderspy');
  const show = (gd: typeof ts, cls: string, name: string) => {
    const pi = powerInfo(gd, gd.archetypeByName.get(cls)!, gd.powerByName.get(name)!, 49, null);
    const avg = pi.stats.find((s) => s.label === 'Average Damage:');
    return { lines: pi.effects.map((e) => [segText(e.line), ...e.notes.map(segText)].join(' / ')), dmg: avg ? segText(avg.value) : null };
  };

  it('says "Applies to enemies" for a critter target, and keeps the hit in the damage (Fire Blast)', () => {
    const fb = show(ts, 'class_blaster', 'blaster_ranged.fire_blast.fire_blast');
    expect(fb.lines[0]).toBe('62.56 fire damage on target / Applies to enemies');
    expect(fb.lines[1]).toBe('4 Ticks of 80.00% chance for 9.38 fire damage over 3.10s on target after 0.50s delay');
    expect(fb.dmg).toBe('84.72');
  });

  it('says "Applies to allies" for any other requirement that names the target (Stygian Circle, Judgement)', () => {
    // Stygian Circle's heals require the target's rank and say nothing of friends
    const sc = show(ts, 'class_warshade', 'warshade_defensive.umbral_aura.stygian_circle').lines;
    expect(sc[0]).toMatch(/^20\.00 endurance on self after 0\.25s delay \/ unresistable$/i); // no requirement: no note
    expect(sc.slice(1)).toEqual(['321.27 heal on self after 0.25s delay / Applies to allies', '535.45 heal on self after 0.25s delay / Applies to allies']);
    // Radiant Blast's Judgement: its damage groups (target not a friend) are left out by the check
    expect(show(ts, 'class_defender', 'defender_ranged.holy_light.judgement').lines).toEqual(['401.59 heal on target / Applies to allies']);
  });

  it("isn't written by Homecoming's client", () => {
    const hc = loadData('i28p4');
    expect(show(hc, 'class_blaster', 'blaster_ranged.fire_blast.fire_blast').lines.some((l) => l.includes('Applies to'))).toBe(false);
  });
});
