import { describe, expect, it } from 'vitest';
import { setExclusive, setPick } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { allowedSetCategories, allowedTypes, boostHelpText, canSlot } from '../src/engine/enhance.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { computeTotals, defaultOn } from '../src/engine/totals.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const P = gd.core.schedule.power;

/** A Bio Armor / Battle Axe tanker with the given picks (pick index -> power full name). */
function tanker(picks: Record<number, string>): Build {
  const at = gd.archetypeByName.get('class_tanker')!;
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: at.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Tanker_Defense.Bio_Organic_Armor'),
    secondary: sid(gd, 'Tanker_Melee.Battle_Axe'),
    pickCount: P.length,
  });
  for (const [i, name] of Object.entries(picks)) b.picks[Number(i)] = { power: pid(gd, name), level: P[Number(i)]!, slots: [] };
  return b;
}

const BIO = 'Tanker_Defense.Bio_Organic_Armor';
const PSI = 'Epic.Tank_Psionic_Mastery';
const base = { 0: `${BIO}.Hardened_Carapace`, 1: 'Tanker_Melee.Battle_Axe.Gash', 4: `${BIO}.Evolution` };

describe('epic pool unlocks (Epic ownPowerNum? N >)', () => {
  const pickAt = (lvl: number) => P.indexOf(lvl - 1);
  it('unlocks the third and fourth powers after one epic power', () => {
    expect(new BuildRules(gd, tanker(base)).powerOption(pid(gd, `${PSI}.Harmonic_Mind`), pickAt(38)).state).toBe('unavailable');
    const r = new BuildRules(gd, tanker({ ...base, [pickAt(35)]: `${PSI}.Mesmerize` }));
    expect(r.powerOption(pid(gd, `${PSI}.Harmonic_Mind`), pickAt(38)).state).toBe('available');
    expect(r.powerOption(pid(gd, `${PSI}.Mental_Blast`), pickAt(41)).state).toBe('available');
    expect(r.powerOption(pid(gd, `${PSI}.Psionic_Tornado`), pickAt(44)).state).toBe('unavailable');
  });
  it('unlocks the fifth power after two epic powers', () => {
    const r = new BuildRules(gd, tanker({ ...base, [pickAt(35)]: `${PSI}.Mesmerize`, [pickAt(38)]: `${PSI}.Dominate` }));
    expect(r.powerOption(pid(gd, `${PSI}.Psionic_Tornado`), pickAt(44)).state).toBe('available');
  });
});

describe('granted powers', () => {
  it('leaves granted powers off the choose-a-power lists', () => {
    const names = new BuildRules(gd, tanker(base)).setOptions(5).flatMap((o) => o.powers.map((p) => p.power.n));
    expect(names).toContain(`${BIO}.Evolution`);
    for (const n of ['Efficient', 'Defensive', 'Offensive']) expect(names).not.toContain(`${BIO}.${n}_Adaptation`);
  });
  it('groups the Adaptations under Adaptation, all off until one is chosen', () => {
    const b = tanker(base);
    const r = new BuildRules(gd, b);
    const members = r.toggleGroups().get(pid(gd, `${BIO}.Evolution`))!;
    expect(members.map((m) => m.dn)).toEqual(['Efficient Adaptation', 'Defensive Adaptation', 'Offensive Adaptation']);
    expect(members.every((m) => !defaultOn(m))).toBe(true);
    expect(computeTotals(gd, r, b).lines.get('dmg.00')?.sources ?? []).toEqual([]);
    const defensive = pid(gd, `${BIO}.Defensive_Adaptation`);
    const b2 = setExclusive(b, members.map((m) => m.id), defensive);
    const dmg = computeTotals(gd, new BuildRules(gd, b2), b2).lines.get('dmg.00')!;
    expect(dmg.sources.map((s) => s.name)).toEqual(['Defensive Adaptation']);
    // the mode it sets turns on Hardened Carapace's Defensive Adaptation bonus (kDefensiveAdaptation Source.Mode?)
    const res = (x: Build) => computeTotals(gd, new BuildRules(gd, x), x).lines.get('res.00')!.value;
    expect(res(b2)).toBeGreaterThan(res(b) + 0.05);
    const offensive = setExclusive(b, members.map((m) => m.id), pid(gd, `${BIO}.Offensive_Adaptation`));
    expect(computeTotals(gd, new BuildRules(gd, offensive), offensive).lines.get('dmg.00')!.value).toBeGreaterThan(0);
    const b3 = setExclusive(b2, members.map((m) => m.id), undefined);
    expect(members.every((m) => b3.granted[m.id]?.on === undefined)).toBe(true);
  });
});

describe('reopening a pick level', () => {
  it('keeps the pick slots and enhancements when the pick was cleared for editing', () => {
    const b = tanker(base);
    const hc = gd.power(b.picks[0]!.power);
    const fits = gd.boosts.find((x) => canSlot(gd, hc, x, 0))!;
    b.picks[0]!.slots = [{ level: 0, enh: { boost: fits.id } }, { level: 2 }, { level: 26 }];
    const cleared = { ...b, picks: b.picks.map((p, i) => (i === 0 ? null : p)) };
    const again = setPick(gd, cleared, 0, b.picks[0]!.power, b.picks[0]);
    expect(again.picks[0]!.slots).toEqual(b.picks[0]!.slots);
  });
});

describe('builds planned short of 50', () => {
  it('keeps the stop level through a share link', async () => {
    const b = { ...tanker(base), endLevel: 19 };
    expect((await decodeShare(await encodeShare(b))).endLevel).toBe(19);
    expect((await decodeShare(await encodeShare(tanker(base)))).endLevel).toBeUndefined();
  });
  it('computes totals at the stop level', () => {
    const b = tanker(base);
    const r = new BuildRules(gd, b);
    expect(computeTotals(gd, r, { ...b, endLevel: 19 }).level).toBe(19);
    expect(computeTotals(gd, r, b).level).toBe(49);
  });
});

describe('power tooltip slot details', () => {
  it('lists Crushing Field the way the game tooltip does', () => {
    const set = gd.setsInCategory('Controller_Control').find((s) => s.dn === 'Gravity Control')!;
    const p = set.p.map((id) => gd.power(id)).find((x) => x.dn === 'Crushing Field')!;
    expect(allowedTypes(gd, p)).toEqual(['Enhance Slow Movement', 'Reduce Endurance Cost', 'Enhance Range', 'Enhance Recharge Speed', 'Enhance Immobilization', 'Enhance Damage', 'Enhance Accuracy']);
    expect(allowedSetCategories(gd, p)).toEqual(['Controller Archetype Sets', 'Universal Damage Sets', 'Slow Movement', 'Immobilize', 'Ranged AoE Damage']);
  });
});

describe('enhancement tooltip text', () => {
  it('fills the help text with the piece value (Invention: Flight Speed at 50)', () => {
    const at = gd.archetypeByName.get('class_blaster')!;
    const fly = gd.boosts.find((b) => b.n === 'Boosts.Crafted_Fly.Crafted_Fly')!;
    expect(boostHelpText(gd, at, { boost: fly.id, ioLevel: 49 }, 49)).toBe('Increases flight speed by 42.4%.');
    expect(fly.cat).toBe('Invention');
    expect(fly.bcm).toBeUndefined(); // "You may not combine this Enhancement with any others."
  });
});

describe('totals sections', () => {
  it('sums set bonuses per set (the user Blaster link: six Decimation in Burst)', async () => {
    const LINK = 'eJwdzMtOwkAAQNE71BmeIowUCgq0WCwVW-y6nX_T-Ds-EhUXJkYTF8b_MUaJojI5yV1eIQTSBe_egGKtRVT63mSlRbT1ucmHFpF61yI6L4ClESiBokKFGjXOCgfujERJGjRo0iTjxpRRZVq08FmQcWuqqCo-AQGLf9emjqrTocM-I0acFtvwm-_AW9jGaaPRvIa7sM5dlEuXLh4eIT95D6dHSMyF6aP6DBjYjc9LuAdf-RA1JCSyYi7NmNKYgOd0gppwYCVkPKVT5JRDK-ExnSFnxBxZD-kcOefYSrgyKazyE-APA8cpuQ';
    const b = await decodeShare(LINK);
    const t = computeTotals(gd, new BuildRules(gd, b), b);
    const g = t.setGroups.find((x) => x.set.dn === 'Decimation')!;
    expect(g.counts).toEqual([6]);
    const stat = (label: string) => g.stats.find((s) => s.label === label)?.value ?? NaN;
    expect(stat('Energy (Res)')).toBeCloseTo(0.015, 6);
    expect(stat('Negative Energy (Res)')).toBeCloseTo(0.015, 6);
    expect(stat('Mez (Res)')).toBeCloseTo(0.1, 6); // 2.5% at (2) + 7.5% at (6)
    expect(stat('Max HP')).toBeCloseTo(0.01125, 4);
  });
  it('reads perception bonuses as a share of the base radius', () => {
    const b = tanker(base);
    const t = computeTotals(gd, new BuildRules(gd, b), b);
    expect(t.perception).toBeCloseTo(500 * (1 + (t.lines.get('perc')?.value ?? 0)), 6);
    expect(t.speeds.run).toBeGreaterThanOrEqual(1);
  });
});
