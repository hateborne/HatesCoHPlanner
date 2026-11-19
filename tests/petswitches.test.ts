/**
 * The pet pane's switches (Build.petOn): kept in saved builds and share links, checked like the rest
 * of a build from outside, and the pet upgrades' own switch (on by default, kept on by a Mids import).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setPetOn } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { petPowerDefault, petPowerOn } from '../src/engine/petstats.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { defaultsOf, isPetUpgrade } from '../src/engine/totals.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { exportMbd, importMbd, type Mbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, pid, sid, withHenchmen } from './helpers/data.ts';

const gd = withHenchmen(loadData());
const P = gd.core.schedule.power;
const FORCE_SHIELD = 'Mastermind_Pets.Protector.Force_Shield';

/** A Robotics / Force Field Mastermind with Battle Drones and Force Bolt (the link below was made from it). */
function bots(): Build {
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    name: 'Bots',
    at: gd.archetypeByName.get('class_mastermind')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Villain',
    primary: sid(gd, 'Mastermind_Summon.Robotics'),
    secondary: sid(gd, 'Mastermind_Buff.Force_Field'),
    pickCount: P.length,
  });
  b.picks[0] = { power: pid(gd, 'Mastermind_Summon.Robotics.Battle_Drones'), level: 0, slots: [{ level: 0 }] };
  b.picks[1] = { power: pid(gd, 'Mastermind_Buff.Force_Field.Force_Bolt'), level: 0, slots: [{ level: 0 }] };
  return b;
}

describe('pet switches in share links', () => {
  // made by the encoder before pet switches existed, from bots()
  const BEFORE = 'eJxjZGdkWss0i4nFKb-kmEHinyoDAyMDwycNMIULsGYaWRSYMAAAAOAGxg';

  it('leaves the code of a build without them as it was, and opens a link made before them as the same build', async () => {
    expect(await encodeShare(bots())).toBe(BEFORE);
    const old = await decodeShare(BEFORE);
    expect(old).toEqual(bots());
    expect(old.petOn).toBeUndefined();
  });

  it('round-trips them, on and off', async () => {
    const b = setPetOn(setPetOn(bots(), FORCE_SHIELD, true), 'Mastermind_Pets.Thug_Lt.Maneuvers', false);
    const back = await decodeShare(await encodeShare(b));
    expect({ ...back.petOn }).toEqual({ [FORCE_SHIELD]: true, 'Mastermind_Pets.Thug_Lt.Maneuvers': false });
    expect({ ...back, petOn: undefined }).toEqual({ ...b, petOn: undefined });
  });

  it('refuses a link with a pet power name past the limit as damaged', async () => {
    const b = setPetOn(bots(), `${'A'.repeat(100)}.${'B'.repeat(100)}`, true);
    await expect(decodeShare(await encodeShare(b))).rejects.toThrow(/damaged/);
  });
});

describe('pet switches in builds from outside', () => {
  it('keeps the well-formed ones only, and no more than 64', () => {
    const raw = {
      ...bots(),
      petOn: {
        [FORCE_SHIELD]: true,
        'not a name': true,
        __proto__name: false,
        'Mastermind_Pets.Medic.Med_Kit': 'yes',
        ...Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Pets.Power.P${i}`, false])),
      },
    };
    const kept = checkBuild(gd, raw).build!.petOn!;
    expect(kept[FORCE_SHIELD]).toBe(true);
    expect(Object.keys(kept)).not.toContain('not a name');
    expect(Object.keys(kept)).not.toContain('Mastermind_Pets.Medic.Med_Kit');
    expect(Object.keys(kept)).toHaveLength(64);
    expect(checkBuild(gd, { ...bots(), petOn: [1, 2] }).build!.petOn).toBeUndefined();
  });
});

describe('a pet power switch', () => {
  const shield = gd.henchmen!.powers[FORCE_SHIELD]!;
  const maneuvers = gd.henchmen!.powers['Mastermind_Pets.Thug_Lt.Maneuvers']!;

  it('starts on for autos, toggles and click buffs a pet can keep up, and stores only a change', () => {
    const howl = gd.henchmen!.powers['Mastermind_Pets.Howler_Wolf_2.Howl'] ?? gd.power(pid(gd, 'Mastermind_Pets.Howler_Wolf_2.Howl'));
    const stimulant = gd.henchmen!.powers['Mastermind_Pets.Medic_3.Stimulant'] ?? gd.power(pid(gd, 'Mastermind_Pets.Medic_3.Stimulant'));
    expect(petPowerDefault(gd, maneuvers)).toBe(true); // an auto
    expect(petPowerDefault(gd, shield)).toBe(true); // 240 s, recharging in 8 s
    expect(petPowerDefault(gd, stimulant)).toBe(true); // 90 s, recharging in 30 s
    expect(petPowerDefault(gd, howl)).toBe(false); // 15 s, recharging in 60 s
    const off = setPetOn(bots(), FORCE_SHIELD, false);
    expect(petPowerOn(gd, off, shield)).toBe(false);
    expect(petPowerOn(gd, off, maneuvers)).toBe(true);
    expect(setPetOn(off, FORCE_SHIELD, undefined).petOn).toBeUndefined();
  });
});

describe('a pet upgrade\'s switch', () => {
  const map = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', gd.core.manifest.dataVersion, 'mids-map.json'), 'utf-8')) as MidsMap;
  const equip = pid(gd, 'Mastermind_Summon.Robotics.Equip_Robot');

  it('is on by default, and a Mids import keeps it so', () => {
    expect(isPetUpgrade(gd, gd.power(equip))).toBe(true);
    expect(isPetUpgrade(gd, gd.power(pid(gd, 'Mastermind_Summon.Robotics.Battle_Drones')))).toBe(false);
    const b = bots();
    b.picks[2] = { power: equip, level: P[2]!, slots: [{ level: P[2]! }] };
    const key = new BuildRules(gd, b).entries().find((e) => e.power.id === equip)!.key;
    expect(defaultsOf(gd, new BuildRules(gd, b).entries()).get(key)).toBe(true);
    // Mids leaves clicks out of its stats: the import keeps the upgrade at its default
    const mbd = exportMbd(gd, map, b).mbd;
    for (const e of mbd.PowerEntries) if (e.PowerName.endsWith('Equip_Robot')) e.StatInclude = false;
    const back = importMbd(gd, map, JSON.parse(JSON.stringify(mbd)) as Mbd).build;
    expect(back.picks.find((p) => p?.power === equip)?.on).toBeUndefined();
  });
});
