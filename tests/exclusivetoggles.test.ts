/**
 * Which powers the totals count by default: of toggles that switch each other off in the game
 * (character_ShutOffAllTogglePowersInSameGroup: a shared GroupMembership), only the earliest
 * picked; and no emergency toggle (untouchable, intangible or self-only while it runs).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newBuild, type Build } from '../src/engine/build.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { computeTotals, defaultsOf, exclusiveGroups, isEmergencyToggle } from '../src/engine/totals.ts';
import { exportMbd, importMbd, type MidsMap } from '../src/io/mids.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const P = gd.core.schedule.power;
const map = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', gd.core.manifest.dataVersion, 'mids-map.json'), 'utf-8')) as MidsMap;

/** A new level-50 build. */
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
const put = (b: Build, i: number, power: string) => {
  b.picks[i] = { power: pid(gd, power), level: P[i]!, slots: [{ level: P[i]! }] };
};
const NOVA = 'Warshade_Offensive.Umbral_Blast.Dark_Nova';
const DWARF = 'Warshade_Defensive.Umbral_Aura.Black_Dwarf';
const warshade = () => build('class_warshade', 'Warshade_Offensive.Umbral_Blast', 'Warshade_Defensive.Umbral_Aura');
const defaults = (b: Build) => defaultsOf(gd, new BuildRules(gd, b).entries());
const keyOf = (b: Build, power: string) => `pick:${b.picks.findIndex((p) => p?.power === pid(gd, power))}`;
const counted = (b: Build, key: string) => computeTotals(gd, new BuildRules(gd, b), b).lines.get(key)?.sources.map((s) => s.name) ?? [];

describe('toggles that switch each other off', () => {
  it('groups the Kheldian forms, and counts only the earliest picked', () => {
    const b = warshade();
    put(b, 5, NOVA);
    put(b, 10, DWARF);
    const groups = exclusiveGroups(new BuildRules(gd, b).entries()).map((g) => g.map((e) => e.power.n));
    expect(groups).toContainEqual([NOVA, DWARF]);
    const d = defaults(b);
    expect(d.get(keyOf(b, NOVA))).toBe(true);
    expect(d.get(keyOf(b, DWARF))).toBe(false);
    expect(counted(b, 'hp')).not.toContain('Black Dwarf');
  });

  it('keeps whichever form was picked first on', () => {
    const b = warshade();
    put(b, 5, DWARF);
    put(b, 10, NOVA);
    const d = defaults(b);
    expect(d.get(keyOf(b, DWARF))).toBe(true);
    expect(d.get(keyOf(b, NOVA))).toBe(false);
  });
});

describe('emergency toggles', () => {
  it('finds the untouchable, intangible and self-only toggles from their effects', () => {
    const is = (n: string) => isEmergencyToggle(gd, gd.power(pid(gd, n)));
    for (const n of ['Tanker_Defense.Ice_Armor.Hibernate', 'Pool.Invisibility.Phase_Shift', 'Defender_Buff.Force_Field.Personal_Force_Field', 'Warshade_Defensive.Umbral_Aura.Nebulous_Form']) expect(is(n), n).toBe(true);
    for (const n of ['Tanker_Defense.Invulnerability.Temp_Invulnerability', 'Pool.Fighting.Weave', 'Pool.Leaping.Combat_Jumping', NOVA]) expect(is(n), n).toBe(false);
  });

  it('leaves them out of the totals until switched on', () => {
    const b = build('class_tanker', 'Tanker_Defense.Ice_Armor', 'Tanker_Melee.Super_Strength');
    put(b, 3, 'Tanker_Defense.Ice_Armor.Hibernate');
    expect(defaults(b).get('pick:3')).toBe(false);
    expect(counted(b, 'regen')).not.toContain('Icy Bastion');
    b.picks[3]!.on = true;
    expect(counted(b, 'regen')).toContain('Icy Bastion');
  });
});

describe('Mids files', () => {
  it('keeps only the earliest form Mids counts (Mids counts every toggle)', () => {
    const b = warshade();
    put(b, 5, NOVA);
    put(b, 10, DWARF);
    const { mbd } = exportMbd(gd, map, b);
    for (const e of mbd.PowerEntries) if (e.PowerName) e.StatInclude = true;
    const back = importMbd(gd, map, mbd).build;
    const d = defaults(back);
    const on = (power: string) => back.picks.find((p) => p?.power === pid(gd, power))?.on ?? d.get(keyOf(back, power));
    expect(on(NOVA)).toBe(true);
    expect(on(DWARF)).toBe(false);
  });

  it('keeps a later form Mids counts when the earlier one is off', () => {
    const b = warshade();
    put(b, 5, NOVA);
    put(b, 10, DWARF);
    const { mbd } = exportMbd(gd, map, b);
    for (const e of mbd.PowerEntries) {
      if (e.PowerName.endsWith('Dark_Nova')) e.StatInclude = false;
      if (e.PowerName.endsWith('Black_Dwarf')) e.StatInclude = true;
    }
    const back = importMbd(gd, map, mbd).build;
    expect(back.picks[5]?.on).toBe(false);
    expect(back.picks[10]?.on).toBe(true);
  });

  it('round-trips the defaults unchanged', () => {
    const b = warshade();
    put(b, 5, NOVA);
    put(b, 10, DWARF);
    const back = importMbd(gd, map, exportMbd(gd, map, b).mbd).build;
    expect(back.picks[5]?.on).toBeUndefined();
    expect(back.picks[10]?.on).toBeUndefined();
  });
});
