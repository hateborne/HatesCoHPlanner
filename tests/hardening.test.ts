/**
 * Behaviours added after the adversarial review: the enhancement lock on picks (including powers
 * a pick grants), checking builds from outside the app, game versions in links and saved builds,
 * and the Mids power on/off round trip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_GAME_VERSION, normalizeVersion, resolveVersion, type GameVersions } from '../src/data/versions.ts';
import { pickHoldsEnhancements } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { defaultOn } from '../src/engine/totals.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { exportMbd, importMbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const P = gd.core.schedule.power;
const VERSION = gd.core.manifest.dataVersion;

/** A Peacebringer with Gleaming Bolt / Incandescence at 1 and Bright Nova at pick 6. */
function peacebringer(): Build {
  const b = newBuild({
    dataVersion: VERSION,
    name: 'Nova',
    at: gd.archetypeByName.get('class_peacebringer')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Peacebringer_Offensive.Luminous_Blast'),
    secondary: sid(gd, 'Peacebringer_Defensive.Luminous_Aura'),
    pickCount: P.length,
  });
  b.picks[0] = { power: pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Gleaming_Bolt'), level: P[0]!, slots: [{ level: 0 }] };
  b.picks[1] = { power: pid(gd, 'Peacebringer_Defensive.Luminous_Aura.Incandescence'), level: P[1]!, slots: [{ level: 0 }] };
  b.picks[5] = { power: pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Bright_Nova'), level: P[5]!, slots: [{ level: P[5]! }] };
  return b;
}
const DMG = () => pid(gd, 'Boosts.Crafted_Damage.Crafted_Damage');

describe('changing a pick that holds enhancements', () => {
  it('is locked by an enhancement in the pick itself', () => {
    const b = peacebringer();
    expect(pickHoldsEnhancements(gd, b, 0)).toBe(false);
    b.picks[0]!.slots[0]!.enh = { boost: DMG(), ioLevel: 49 };
    expect(pickHoldsEnhancements(gd, b, 0)).toBe(true);
  });
  it('is locked by an enhancement in a power the pick grants (Bright Nova -> Bright Nova Bolt)', () => {
    const b = peacebringer();
    b.granted[pid(gd, 'Peacebringer_Offensive.Luminous_Blast.Bright_Nova_Bolt')] = { slots: [{ level: P[5]!, enh: { boost: DMG(), ioLevel: 49 } }] };
    expect(b.picks[5]!.slots.some((s) => s.enh)).toBe(false);
    expect(pickHoldsEnhancements(gd, b, 5)).toBe(true);
    expect(pickHoldsEnhancements(gd, b, 0)).toBe(false); // other picks stay editable
  });
});

describe('checking builds from outside the app', () => {
  it('rejects what it cannot repair', () => {
    expect(checkBuild(gd, null).build).toBeNull();
    expect(checkBuild(gd, { ...peacebringer(), at: 999999 }).build).toBeNull();
    expect(checkBuild(gd, { ...peacebringer(), primary: 999999 }).build).toBeNull();
    expect(checkBuild(gd, { ...peacebringer(), origin: 999999 }).build).toBeNull();
  });
  it('repairs unknown powers / enhancements, extra slots and the pick count', () => {
    const b = peacebringer();
    b.endLevel = 49;
    b.picks[2] = { power: 999999, level: P[2]!, slots: [] };
    b.picks[0]!.slots = Array.from({ length: 8 }, (_, i) => ({ level: i, enh: i === 1 ? { boost: 999999 } : undefined }));
    const c = checkBuild(gd, { ...b, picks: [...b.picks, null, null] });
    expect(c.build).not.toBeNull();
    expect(c.build!.picks).toHaveLength(P.length);
    expect(c.build!.picks[2]).toBeNull();
    expect(c.build!.picks[0]!.slots).toHaveLength(6);
    expect(c.build!.picks[0]!.slots[1]!.enh).toBeUndefined();
    expect(c.fixes.length).toBeGreaterThanOrEqual(3);
  });
  it('treats an unfinished build as stopped before its first missing pick', () => {
    const b = peacebringer(); // picks 1, 2 and 6: pick 3 (index 2) is the first missing
    const c = checkBuild(gd, b);
    expect(c.build!.endLevel).toBe(P[2]! - 1);
    expect(checkBuild(gd, { ...b, picks: b.picks.map(() => null) }).build).toBeNull();
  });
  it('ties the checked build to the data it was checked against', () => {
    expect(checkBuild(gd, { ...peacebringer(), dataVersion: '20261017-f94d0e09' }).build!.dataVersion).toBe(VERSION);
  });
});

describe('game versions', () => {
  const vs: GameVersions = { default: 'i28p4', versions: [{ id: 'i28p4', label: 'Issue 28, Page 4', hash: 'x' }] };
  it('maps builds from before versions existed to Issue 28, Page 4', () => {
    expect(LEGACY_GAME_VERSION).toBe('i28p4');
    expect(normalizeVersion(undefined)).toBe('i28p4');
    expect(normalizeVersion('20261017-f94d0e09')).toBe('i28p4');
    expect(normalizeVersion('i29p1')).toBe('i29p1');
  });
  it('opens a build on its own version, else the default with a note', () => {
    expect(resolveVersion(vs, 'i28p4')).toEqual({ version: vs.versions[0] });
    expect(resolveVersion(vs, undefined)).toEqual({ version: vs.versions[0] });
    expect(resolveVersion(vs, 'i99p9')).toEqual({ version: vs.versions[0], missing: 'i99p9' });
  });
  it('carries the version in share links; links made before that open as Issue 28, Page 4', async () => {
    const b = { ...peacebringer(), dataVersion: 'i29p1' };
    expect((await decodeShare(await encodeShare(b))).dataVersion).toBe('i29p1');
    // the user's Blaster link, made before links carried a version
    const OLD = 'eJwdzMtOwkAAQNE71BmeIowUCgq0WCwVW-y6nX_T-Ds-EhUXJkYTF8b_MUaJojI5yV1eIQTSBe_egGKtRVT63mSlRbT1ucmHFpF61yI6L4ClESiBokKFGjXOCgfujERJGjRo0iTjxpRRZVq08FmQcWuqqCo-AQGLf9emjqrTocM-I0acFtvwm-_AW9jGaaPRvIa7sM5dlEuXLh4eIT95D6dHSMyF6aP6DBjYjc9LuAdf-RA1JCSyYi7NmNKYgOd0gppwYCVkPKVT5JRDK-ExnSFnxBxZD-kcOefYSrgyKazyE-APA8cpuQ';
    expect((await decodeShare(OLD)).dataVersion).toBe(LEGACY_GAME_VERSION);
  });
});

describe('Mids power on/off', () => {
  const map = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', VERSION, 'mids-map.json'), 'utf-8')) as MidsMap;
  it('round-trips switched-off powers and leaves defaults alone', () => {
    const b = peacebringer();
    b.endLevel = 49;
    const toggle = pid(gd, 'Peacebringer_Defensive.Luminous_Aura.Incandescence');
    expect(defaultOn(gd.power(toggle))).toBe(true);
    b.picks[1]!.on = false;
    const back = importMbd(gd, map, exportMbd(gd, map, b).mbd).build;
    expect(back.picks[1]!.on).toBe(false);
    expect(back.picks[0]!.on).toBeUndefined(); // still the default, not written as an override
  });
  it('exports a toggle left at its default (on) as included, not switched off', () => {
    const b = peacebringer();
    b.endLevel = 49;
    const { mbd } = exportMbd(gd, map, b);
    const row = mbd.PowerEntries.find((p) => /incandescence$/i.test(p.PowerName));
    expect(row).toBeDefined();
    expect(row!.StatInclude).toBe(true);
  });
});
