/**
 * Totals count only what lands on the character while its powers run: no effect meant for
 * teammates or foes (SecondaryTargetsOnly groups), no burst a toggle gives when it is switched off
 * (OnDeactivate / OnExpire), and toggle costs that use the character's whole End Discount.
 */
import { describe, expect, it } from 'vitest';
import { newBuild, type Build } from '../src/engine/build.ts';
import { powerStrength } from '../src/engine/enhance.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const P = gd.core.schedule.power;

/** A new level-50 build of an archetype and its two sets. */
function build(at: string, primary: string, secondary: string): Build {
  return newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: gd.archetypeByName.get(at)!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, primary),
    secondary: sid(gd, secondary),
    pickCount: P.length,
  });
}

/** Put a power in pick i with the given enhancements (level 50 IOs), one slot each. */
function put(b: Build, i: number, power: string, enh: string[] = []): void {
  const slots = (enh.length ? enh : ['']).map((e) => ({ level: P[i]!, enh: e ? { boost: pid(gd, e), ioLevel: 49 } : undefined }));
  b.picks[i] = { power: pid(gd, power), level: P[i]!, slots };
}

const totals = (b: Build) => computeTotals(gd, new BuildRules(gd, b), b);
const sourcesOf = (b: Build, key: string) => totals(b).lines.get(key)?.sources.map((s) => s.name) ?? [];

describe('only what lands on the character', () => {
  it("doesn't give the caster Group Fly's lift for teammates", () => {
    const fly = build('class_blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation');
    put(fly, 3, 'Pool.Flight.Fly');
    const both = build('class_blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation');
    put(both, 3, 'Pool.Flight.Fly');
    put(both, 4, 'Pool.Flight.Group_Fly');
    expect(sourcesOf(both, 'fly')).not.toContain('Group Fly');
    expect(totals(both).speeds.fly).toBeCloseTo(totals(fly).speeds.fly, 9);
  });

  it("leaves out Reaction Time's slow on foes and the burst it gives when switched off", () => {
    const b = build('class_blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Martial_Manipulation');
    put(b, 3, 'Blaster_Support.Martial_Manipulation.Reaction_Time');
    for (const key of ['rech', 'run', 'max.run']) expect(sourcesOf(b, key), key).not.toContain('Reaction Time');
  });
});

describe('toggle endurance use', () => {
  it("divides a toggle's cost by the character's End Discount plus its own slotted End Reduction", () => {
    const b = build('class_tanker', 'Tanker_Melee.Super_Strength', 'Tanker_Defense.Invulnerability');
    const ug = (l: string) => `Boosts.Crafted_Unbreakable_Guard_${l}.Crafted_Unbreakable_Guard_${l}`;
    put(b, 0, 'Tanker_Defense.Invulnerability.Temp_Invulnerability', ['A', 'B', 'C', 'D', 'E'].map(ug));
    const t = totals(b);
    const power = gd.power(pid(gd, 'Tanker_Defense.Invulnerability.Temp_Invulnerability'));
    const slotted = powerStrength(gd, gd.archetype(b.at), power, b.picks[0]!.slots.map((s) => s.enh), 49).post.get(gd.attribByName.get('EnduranceDiscount')!) ?? 0;
    const global = t.lines.get('endrdx')?.value ?? 0;
    expect(global).toBeGreaterThan(0); // Unbreakable Guard's (5) bonus
    expect(slotted).toBeGreaterThan(0);
    expect(t.endUsePerSec).toBeCloseTo(power.end! / power.ap! / (1 + global + slotted), 9);
  });
});
