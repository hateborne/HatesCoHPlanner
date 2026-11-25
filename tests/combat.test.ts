/**
 * The totals' combat state (src/engine/combat.ts): in combat by default, so a bonus a fight stops
 * isn't counted; the Out of Combat switch counts it. Both ways a power says so are read: a group's
 * requirement on the time since an event (pool Stealth's defense) and a mod's suppression (Hide,
 * travel speed), whose event numbers differ by server and by patch. Also what reads the totals: the
 * pet cards, the damage in a power's info, and the set finder's travel state.
 */
import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { SERVERS } from '../src/data/servers.ts';
import type { Effect } from '../src/data/types.ts';
import { damageBoost } from '../src/engine/boost.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { combatHooks, VERSION_EVENTS, type CombatState } from '../src/engine/combat.ts';
import { petEntries } from '../src/engine/petcards.ts';
import { evalRequires } from '../src/engine/requires.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { loadData, loadVersionIndex, pid, sid, withHenchmen } from './helpers/data.ts';

const gd = loadData();
const ts = loadData(undefined, 'thunderspy');

/**
 * A level-50 character with powers in its first picks, each switched on.
 *
 * @param d Game data.
 * @param at Archetype (lower-cased class name).
 * @param primary Primary set full name.
 * @param secondary Secondary set full name.
 * @param powers Full names of the powers to pick.
 * @return The build.
 */
function build(d: GameData, at: string, primary: string, secondary: string, powers: string[]): Build {
  const b = newBuild({
    dataVersion: d.core.manifest.dataVersion,
    at: d.archetypeByName.get(at)!.id,
    origin: d.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(d, primary),
    secondary: sid(d, secondary),
    pickCount: d.core.schedule.power.length,
  });
  powers.forEach((p, i) => (b.picks[i] = { power: pid(d, p), level: d.core.schedule.power[i]!, slots: [], on: true }));
  return b;
}

/** @return What one source gives a totals line, in a combat state (summed over its groups). */
function from(d: GameData, b: Build, key: string, name: string, outOfCombat?: CombatState): number {
  const t = outOfCombat === undefined ? computeTotals(d, new BuildRules(d, b), b) : computeTotals(d, new BuildRules(d, b), b, 49, outOfCombat);
  const sum = (t.lines.get(key)?.sources ?? []).filter((s) => s.name === name).reduce((a, s) => a + s.value, 0);
  return Math.round(sum * 1e4) / 1e4;
}

/** @return A level-50 Stalker with Willpower's Hide. */
const hider = (d: GameData) => build(d, 'class_stalker', 'Stalker_Melee.Broad_Sword', 'Stalker_Defense.Willpower', ['Stalker_Defense.Willpower.Hide']);

describe('Homecoming', () => {
  const blaster = build(gd, 'class_blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Gadgets', [
    'Blaster_Ranged.Fire_Blast.Flares',
    'Blaster_Support.Gadgets.Targeting_Drone',
    'Blaster_Support.Gadgets.Cloaking_Device',
    'Pool.Invisibility.Stealth',
    'Pool.Flight.Afterburner',
    'Pool.Speed.Super_Speed',
  ]);

  it('the totals are in combat unless asked', () => {
    expect(from(gd, blaster, 'def.03', 'Stealth')).toBe(from(gd, blaster, 'def.03', 'Stealth', false));
    expect(from(gd, blaster, 'def.03', 'Evasive Maneuvers')).toBe(0);
  });

  it("pool Stealth's defense out of combat (a requirement on the time since attacking)", () => {
    expect(from(gd, blaster, 'def.03', 'Stealth', false)).toBe(0.0175);
    expect(from(gd, blaster, 'def.03', 'Stealth', true)).toBe(0.0875);
    expect(from(gd, blaster, 'stealth', 'Stealth', false)).toBe(0);
    expect(from(gd, blaster, 'stealth', 'Stealth', true)).toBe(55);
  });

  it("Evasive Maneuvers' defense stops in combat (a suppression)", () => {
    expect(from(gd, blaster, 'def.02', 'Evasive Maneuvers', true)).toBe(0.105);
  });

  it("Targeting Drone's +60% damage only out of combat (the Engagement mode)", () => {
    expect(from(gd, blaster, 'dmg.00', 'Targeting Drone', false)).toBe(0.2);
    expect(from(gd, blaster, 'dmg.00', 'Targeting Drone', true)).toBe(0.8);
  });

  it("a travel power's speed stops after an attack, so in combat it is gone", () => {
    expect(from(gd, blaster, 'run', 'Super Speed', false)).toBe(0);
    expect(from(gd, blaster, 'run', 'Super Speed', true)).toBe(3.5);
  });

  it('Hide: 1.875% in combat; out of it 5.625% and 39.375% to AoE', () => {
    const b = hider(gd);
    expect(from(gd, b, 'def.03', 'Hide', false)).toBe(0.0188);
    expect(from(gd, b, 'def.02', 'Hide', false)).toBe(0.0188);
    expect(from(gd, b, 'def.03', 'Hide', true)).toBe(0.0563);
    expect(from(gd, b, 'def.02', 'Hide', true)).toBe(0.3938);
  });

  it("a mission object's click is no part of a fight: Cloak of Darkness's stealth counts in combat", () => {
    const b = build(gd, 'class_brute', 'Brute_Melee.Dark_Melee', 'Brute_Defense.Dark_Armor', ['Brute_Defense.Dark_Armor.Cloak_of_Darkness']);
    expect(from(gd, b, 'stealth', 'Cloak of Darkness', false)).toBe(35.5);
    expect(from(gd, b, 'stealth', 'Cloak of Darkness', true)).toBe(35.5);
  });
});

describe('Thunderspy (its own event numbers)', () => {
  const b = build(ts, 'class_blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation', ['Blaster_Ranged.Fire_Blast.Flares', 'Pool.Invisibility.Stealth']);

  it("pool Stealth's suppressed defense", () => {
    expect(from(ts, b, 'def.03', 'Stealth', false)).toBe(0.0175);
    expect(from(ts, b, 'def.03', 'Stealth', true)).toBe(0.035);
  });
});

describe('Issue 28 Page 3 (one event fewer than Page 4)', () => {
  const p3 = loadData('i28p3');

  it("Hide's out-of-combat defense is suppressed in combat by p3's own numbers", () => {
    expect(from(p3, hider(p3), 'def.02', 'Hide', false)).toBe(0.0188);
    expect(from(p3, hider(p3), 'def.02', 'Hide', true)).toBe(0.3938);
  });

  it("p3's event 37 is a mission object's click (p4's 37 is Defeated)", () => {
    expect(VERSION_EVENTS.i28p3![37]).toBe('MissionObjectClick');
    expect(VERSION_EVENTS.i28p4![37]).toBe('Defeated');
    expect(VERSION_EVENTS.i28p4![38]).toBe('MissionObjectClick');
  });
});

/** @return The names of the events a power's suppressions name, by a version's numbers ("#n": none). */
function supNames(d: GameData, power: string, names: readonly string[]): Set<string> {
  const out = new Set<string>();
  const walk = (effs: Effect[] | undefined) => {
    for (const e of effs ?? []) {
      for (const m of e.m ?? []) for (const s of (m.sup ?? []) as { Event: number }[]) out.add(names[s.Event] ?? `#${s.Event}`);
      walk(e.sub);
    }
  };
  const p = d.power(pid(d, power));
  walk(p.eff);
  walk(p.act);
  return out;
}

// per server, a power whose suppressions are known and events they name
const KNOWN: Record<string, [string, string[]]> = {
  homecoming: ['Stalker_Defense.Willpower.Hide', ['Attacked', 'Damaged', 'MissionObjectClick']],
  thunderspy: ['Pool.Invisibility.Stealth', ['Attacked', 'HitByFoe', 'MissionObjectClick']],
};

describe("every published version's event numbers", () => {
  for (const server of SERVERS) {
    for (const v of loadVersionIndex(server.id).versions) {
      it(`${server.id} ${v.id}: read from its own client, and they fit its data`, () => {
        // a new version: read its client's kPowerEvent table (docs/game-rules.md, "Combat state")
        const names = VERSION_EVENTS[v.id];
        expect(names, `VERSION_EVENTS has no entry for ${v.id}`).toBeDefined();
        const d = loadData(v.id, server.id);
        // a known power's suppressions name the events they should
        const [power, events] = KNOWN[server.id]!;
        const named = supNames(d, power, names!);
        for (const n of events) expect(named.has(n), `${v.id} ${power}: ${[...named].join(', ')}`).toBe(true);
        // and every suppression in the data names an event the list has
        for (const p of d.powerById.values()) for (const n of supNames(d, p.n, names!)) expect(n.startsWith('#'), `${v.id} ${p.n}: ${n}`).toBe(false);
      });
    }
  }
});

describe('what reads the totals', () => {
  it("a Mastermind's Genin hide out of combat only: the pet's own suppressed stealth", () => {
    const hc = withHenchmen(gd);
    const b = newBuild({
      dataVersion: hc.core.manifest.dataVersion,
      at: hc.archetypeByName.get('class_mastermind')!.id,
      origin: hc.core.origins[0]!.id,
      alignment: 'Villain',
      primary: sid(hc, 'Mastermind_Summon.Ninjas'),
      secondary: sid(hc, 'Mastermind_Buff.Force_Field'),
      pickCount: hc.core.schedule.power.length,
    });
    b.picks[0] = { power: pid(hc, 'Mastermind_Summon.Ninjas.Call_Genin'), level: 0, slots: [{ level: 0 }] };
    const stealth = (out: boolean) => {
      const genin = petEntries(hc, new BuildRules(hc, b), b, 49, out).find((e) => e.name === 'Genin')!.card();
      return (genin.stats.lines.get('stealth')?.sources ?? []).reduce((a, x) => a + x.value, 0);
    };
    expect(stealth(false)).toBe(0);
    expect(stealth(true)).toBeGreaterThan(0);
  });

  it("a power's info reads the damage boost of the state it is asked for (cached apart)", () => {
    const b = build(gd, 'class_blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Gadgets', ['Blaster_Ranged.Fire_Blast.Flares', 'Blaster_Support.Gadgets.Targeting_Drone']);
    const rules = new BuildRules(gd, b);
    const smash = gd.attribByName.get('DamageType00')!;
    const inFight = damageBoost(gd, rules, 49, false).str.get(smash)!;
    const outOfIt = damageBoost(gd, rules, 49, true).str.get(smash)!;
    expect(outOfIt - inFight).toBeCloseTo(0.6, 4);
    expect(damageBoost(gd, rules, 49, false).str.get(smash)).toBe(inFight);
  });

  it("the set finder's travel state: speed as out of combat, a fight's defense not", () => {
    const b = build(gd, 'class_blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Gadgets', ['Blaster_Ranged.Fire_Blast.Flares', 'Pool.Flight.Afterburner', 'Pool.Speed.Super_Speed']);
    expect(from(gd, b, 'run', 'Super Speed', 'travel')).toBe(3.5);
    expect(from(gd, b, 'def.02', 'Evasive Maneuvers', 'travel')).toBe(0);
    expect(from(gd, hider(gd), 'def.02', 'Hide', 'travel')).toBe(0.0188);
  });
});

describe('the requirement context', () => {
  const tokens = (s: string) => s.split(' ');
  it("reads the time since a fight's event, and leaves the rest as before", () => {
    const inFight = { ...combatHooks('homecoming', 'i28p4', false) } as never;
    const outOfIt = { ...combatHooks('homecoming', 'i28p4', true) } as never;
    const ctx = (h: object) => ({ ownsPower: () => false, ownsSet: () => false, prop: () => 0, ...h });
    expect(evalRequires(tokens('Attacked source.EventTimeSince> 10 >'), ctx(inFight))).toBe(false);
    expect(evalRequires(tokens('Attacked source.EventTimeSince> 10 >'), ctx(outOfIt))).toBe(true);
    // not a fight's event: 0 for the source, long ago for the target, in either state
    expect(evalRequires(tokens('NearGround source.EventTimeSince> 1 >='), ctx(outOfIt))).toBe(false);
    expect(evalRequires(tokens('Held target.EventTimeSince> 5 >'), ctx(inFight))).toBe(true);
  });

  it("a suppression stops a mod only for a fight's event, numbered by the version", () => {
    const hc = (out: CombatState) => combatHooks('homecoming', 'i28p4', out);
    // Homecoming 21 is Damaged, 38 MissionObjectClick; Thunderspy 21 is Held
    expect(hc(false).suppressed([{ Event: 21, Seconds: 8, Always: 1 }])).toBe(true);
    expect(hc(false).suppressed([{ Event: 38, Seconds: 8, Always: 1 }])).toBe(false);
    expect(combatHooks('thunderspy', 'ts9-6', false).suppressed([{ Event: 21, Seconds: 3, Always: 1 }])).toBe(false);
    expect(hc(true).suppressed([{ Event: 2, Seconds: 8, Always: 1 }])).toBe(false);
    // i28p3's 37 is MissionObjectClick: not a fight's
    expect(combatHooks('homecoming', 'i28p3', false).suppressed([{ Event: 37, Seconds: 8, Always: 1 }])).toBe(false);
    // a version not yet listed reads with its server's latest numbers
    expect(combatHooks('homecoming', 'i99p9', false).suppressed([{ Event: 21, Seconds: 8, Always: 1 }])).toBe(true);
    // a server whose events aren't known suppresses nothing; nor does an event past the list's end
    expect(combatHooks('elsewhere', 'x1', false).suppressed([{ Event: 2, Seconds: 8, Always: 1 }])).toBe(false);
    expect(hc(false).suppressed([{ Event: 999, Seconds: 8, Always: 1 }])).toBe(false);
    expect(hc(false).suppressed([{ Event: 2, Seconds: 0, Always: 1 }])).toBe(false);
  });

  it("'travel' lets a speed or stealth mod through, not one that changes anything else", () => {
    const hooks = combatHooks('homecoming', 'i28p4', 'travel', new Set([1, 2]));
    const sup = [{ Event: 1, Seconds: 4, Always: 1 }];
    expect(hooks.suppressed(sup, [1])).toBe(false);
    expect(hooks.suppressed(sup, [1, 3])).toBe(true);
    expect(hooks.suppressed(sup)).toBe(true);
    expect(hooks.sinceEvent('Attacked')).toBe(0);
  });
});
