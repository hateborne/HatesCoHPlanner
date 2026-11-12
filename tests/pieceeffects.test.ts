/**
 * A slotted piece's own effects (Miracle's +Recovery, Kismet's +ToHit, the travel sets' stealth)
 * count in the totals while the power holding it runs and the piece works at the level
 * (character_AccrueBoosts bBonusAttributes; character_ApplyPower attaches the non-boost templates).
 */
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import type { Power } from '../src/data/types.ts';
import { newBuild, type Build, type SlottedEnh } from '../src/engine/build.ts';
import { boostMods } from '../src/engine/enhance.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { loadData, loadVersionIndex, pid, sid } from './helpers/data.ts';

const gd = loadData();
const P = gd.core.schedule.power;

/** A new level-50 Fire/Fire Blaster of a data version. */
function blaster(d: GameData = gd): Build {
  return newBuild({
    dataVersion: d.core.manifest.dataVersion,
    at: d.archetypeByName.get('class_blaster')!.id,
    origin: d.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(d, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(d, 'Blaster_Support.Fire_Manipulation'),
    pickCount: d.core.schedule.power.length,
  });
}
/** A piece by its short name ("Crafted_Miracle_F"). */
const io = (short: string, ioLevel = 49): SlottedEnh => ({ boost: pid(gd, `Boosts.${short}.${short}`), ioLevel });
/** Put a power in pick i with pieces in its slots. */
function put(b: Build, i: number, power: string, pieces: SlottedEnh[], on?: boolean): void {
  b.picks[i] = { power: pid(gd, power), level: P[i]!, slots: pieces.map((enh) => ({ level: P[i]!, enh })), on };
}
/** Put pieces in Health (granted at level 1). */
function inHealth(b: Build, pieces: SlottedEnh[]): void {
  b.granted[pid(gd, 'Inherent.Fitness.Health')] = { slots: pieces.map((enh) => ({ level: 0, enh })) };
}
const totals = (b: Build, d: GameData = gd) => computeTotals(d, new BuildRules(d, b), b);
/** @return The named sources of a totals line. */
const from = (b: Build, key: string, name: string) => totals(b).lines.get(key)?.sources.filter((s) => s.name === name) ?? [];

describe("a slotted piece's own effects count in the totals", () => {
  it('Miracle: +Recovery in Health adds 15% recovery', () => {
    const b = blaster();
    inHealth(b, [io('Crafted_Miracle_F')]);
    expect(from(b, 'recov', 'Miracle: +Recovery').map((s) => s.value)).toEqual([0.15]);
  });

  it("Numina's Convalescence adds 20% regeneration and 10% recovery", () => {
    const b = blaster();
    inHealth(b, [io('Crafted_Numinas_Convalesence_F')]);
    const name = "Numina's Convalescence: Regeneration/Recovery";
    expect(from(b, 'regen', name).map((s) => s.value)).toEqual([0.2]);
    expect(from(b, 'recov', name).map((s) => s.value)).toEqual([0.1]);
  });

  it('Kismet: +ToHit counts while its toggle runs, not when it is switched off', () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Crafted_Kismet_E', 29)]);
    expect(from(b, 'tohit', 'Kismet: +ToHit').map((s) => s.value)).toEqual([0.06]);
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Crafted_Kismet_E', 29)], /*on=*/ false);
    expect(from(b, 'tohit', 'Kismet: +ToHit')).toEqual([]);
  });

  it('one piece in two running powers counts once (Replace stacking)', () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Attuned_Kismet_E')]);
    put(b, 4, 'Pool.Flight.Combat_Flight', [io('Attuned_Kismet_E')]);
    expect(totals(b).lines.get('tohit')?.value).toBeCloseTo(0.06, 6);
  });

  it('keeps working when exemplared below the piece: the test is at the real level', () => {
    // character_AccrueBoosts tests boost_Effectiveness at character_CalcExperienceLevel
    const b = blaster();
    b.exemplar = 9;
    inHealth(b, [io('Crafted_Miracle_F')]);
    expect(from(b, 'recov', 'Miracle: +Recovery').map((s) => s.value)).toEqual([0.15]);
  });

  it('a build stopped below the piece does not get it; an attuned one works from its MinSlotLevel', () => {
    const b = blaster();
    b.endLevel = 19;
    inHealth(b, [io('Crafted_Miracle_F')]);
    expect(from(b, 'recov', 'Miracle: +Recovery')).toEqual([]);
    // attuned: from its MinSlotLevel (level 17) up
    inHealth(b, [io('Attuned_Miracle_F')]);
    expect(from(b, 'recov', 'Miracle: +Recovery').map((s) => s.value)).toEqual([0.15]);
  });

  it("Luck of the Gambler's Null help-text carrier adds nothing on its own: 7.5% recharge, once", () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Crafted_Luck_of_the_Gambler_F')]);
    const t = totals(b);
    expect(t.lines.get('rech')?.value).toBeCloseTo(0.075, 6);
    expect([...t.lines.keys()].filter((k) => k.includes('Null'))).toEqual([]);
  });
});

/** @return Whether a piece has any self-targeted mod besides its enhancement values. */
function hasOwnEffect(d: GameData, boost: Power): boolean {
  const enhancing = new Set(boostMods(boost));
  const walk = (effs: Power['eff']): boolean =>
    (effs ?? []).some((e) => (e.m ?? []).some((m) => m.tg === 'Caster' && !enhancing.has(m) && !m.a.every((a) => d.attribName.get(a) === 'Null')) || walk(e.sub));
  return walk(boost.eff);
}

// every published version: each piece with a self effect, alone in a running power that takes it
for (const { id } of loadVersionIndex().versions) {
  it(`only the always-on unique pieces add their own effects (${id})`, () => {
    const d = loadData(id);
    const family = (n: string) => n.split('.')[1]!.replace(/^(Crafted|Attuned|Superior_Attuned|Superior)_/, '');
    const added = new Set<string>();
    for (const set of d.boostSets) {
      const power = set.elig[0];
      if (power === undefined) continue;
      for (const boost of set.slots.flat().map((x) => d.power(x)).filter((x) => hasOwnEffect(d, x))) {
        const b = blaster(d);
        b.picks[3] = { power, level: d.core.schedule.power[3]!, slots: [{ level: d.core.schedule.power[3]!, enh: { boost: boost.id, ioLevel: 49 } }], on: true };
        const t = totals(b, d);
        expect([...t.lines.keys()].filter((k) => k.includes('Null')), boost.n).toEqual([]);
        if ([...t.lines.values()].some((l) => l.sources.some((s) => s.name === boost.dn))) added.add(family(boost.n));
      }
    }
    // chance procs, PPM procs, proc-chance changes and granted powers add nothing here
    expect([...added].sort()).toEqual([
      'Celerity_C',
      'Freebird_C',
      'Impervious_Skin_E',
      'Kismet_E',
      'Launch_D',
      'Miracle_F',
      'Numinas_Convalesence_F',
      'Regenerative_Tissue_E',
      'Thrust_D',
      'TimeSpace_Manipulation_C',
      'Unbounded_Leap_C',
      'Warp_D',
    ]);
  });
}
