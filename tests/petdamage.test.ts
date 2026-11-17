/**
 * Pseudo-pet damage in the power info (getTotalDamage's pet branch, ported from the live clients,
 * decompiled): powers like Burn and Irradiated Ground deal their damage through a pet their
 * EntCreate mod makes, and the game's info window adds the pet's damage to the power's own. The
 * pets come from each version's optional pets/<version>.json, kept beside the version folders.
 * Expected figures were worked out apart from the engine, from the exported files and the rule.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameData, loadGameData, PETS_FOLDER } from '../src/data/gamedata.ts';
import { serverById } from '../src/data/servers.ts';
import type { Effect, Mod, PetsFile, Power } from '../src/data/types.ts';
import { powerInfo, segText } from '../src/engine/powerinfo.ts';
import { evalRequires, type EvalContext } from '../src/engine/requires.ts';
import { dataDir, loadData, loadVersionIndex } from './helpers/data.ts';

const L50 = 49;

/** @return The stats rows of a power's info as { label: text }. */
function stats(gd: GameData, at: string, power: string, enh: Map<number, number> | null): Record<string, string> {
  const a = gd.archetypeByName.get(at.toLowerCase());
  const p = gd.powerByName.get(power.toLowerCase());
  if (!a || !p) throw new Error(`no ${at} or ${power}`);
  return Object.fromEntries(powerInfo(gd, a, p, L50, enh).stats.map((r) => [r.label, segText(r.value)]));
}

/** @return The effect sentences of a power's info as text, notes after " / ". */
function lines(gd: GameData, at: string, power: string, enh: Map<number, number> | null): string[] {
  const a = gd.archetypeByName.get(at.toLowerCase());
  const p = gd.powerByName.get(power.toLowerCase());
  if (!a || !p) throw new Error(`no ${at} or ${power}`);
  return powerInfo(gd, a, p, L50, enh).effects.map((e) => [segText(e.line), ...e.notes.map(segText)].join(' / '));
}

/**
 * Run with the version's pets file changed, then put it back.
 *
 * @param gd The data.
 * @param change Makes the changed file from a deep copy of the loaded one.
 * @param run The checks.
 */
function withPets(gd: GameData, change: (f: PetsFile) => PetsFile | null, run: () => void): void {
  const kept = gd.pets;
  gd.pets = kept ? change(structuredClone({ ...kept, pets: { ...kept.pets }, powers: { ...kept.powers } })) : null;
  try {
    run();
  } finally {
    gd.pets = kept;
  }
}

/** @return An enhancement strength map giving every damage type +95%. */
function damageEnh(gd: GameData): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < 20; i++) {
    const off = gd.attribByName.get(`DamageType${String(i).padStart(2, '0')}`);
    if (off !== undefined) m.set(off, 0.95);
  }
  return m;
}

describe('pseudo-pet damage (Homecoming i28p4)', () => {
  const gd = loadData('i28p4');

  it('loads the version pet file beside the version folders', () => {
    expect(gd.pets?.pets['Brute_Defense.Fiery_Aura.Burn']).toBeDefined();
    expect(gd.pets?.plus).toBeUndefined(); // Homecoming's client adds no activation
  });

  it("Burn: a PseudoPet with its caster's class, 12 ticks of FieryBurn and one front hit", () => {
    // 41.7087 Brute Melee_Damage x (12 x 0.14 + 1.44); its Fiery Embrace groups have chance 0
    const s = stats(gd, 'Class_Brute', 'Brute_Defense.Fiery_Aura.Burn', null);
    expect(s['Average Damage:']).toBe('130.13');
    expect(s['Damage Per Activation Time:']).toBe('64.10'); // over its 2.03s activation
  });

  it('Burn copies the caster\'s enhancements (CopyBoosts)', () => {
    const s = stats(gd, 'Class_Brute', 'Brute_Defense.Fiery_Aura.Burn', damageEnh(gd));
    expect(s['Average Damage:']).toBe('253.76 (130.13)');
  });

  it("Irradiated Ground: its villain def's pet, its class Class_Minion_Pets, one activation (no duration)", () => {
    // 0.0825 x Class_Minion_Pets Melee_Damage 55.6599; only the Brute group passes `arch source.owner>`
    expect(stats(gd, 'Class_Brute', 'Brute_Melee.Radiation_Melee.Irradiated_Ground', null)['Average Damage:']).toBe('4.59');
    expect(stats(gd, 'Class_Brute', 'Brute_Melee.Radiation_Melee.Irradiated_Ground', damageEnh(gd))['Average Damage:']).toBe(
      '8.95 (4.59)',
    );
  });

  it("reads the creator's class for the pet's `source.owner>` groups", () => {
    // a Scrapper's: 0.1238 x 55.6599, plus its 10% critical of the same
    expect(stats(gd, 'Class_Scrapper', 'Scrapper_Melee.Radiation_Melee.Irradiated_Ground', null)['Average Damage:']).toBe('7.58');
  });

  it('shows the pet without CopyBoosts at its base damage, enhanced or not', () => {
    const kept = gd.pets!;
    const burn = kept.pets['Brute_Defense.Fiery_Aura.Burn']!.map(({ boosts: _drop, ...c }) => c);
    gd.pets = { ...kept, pets: { ...kept.pets, 'Brute_Defense.Fiery_Aura.Burn': burn } };
    try {
      expect(stats(gd, 'Class_Brute', 'Brute_Defense.Fiery_Aura.Burn', damageEnh(gd))['Average Damage:']).toBe('130.13');
    } finally {
      gd.pets = kept;
    }
  });

  it('skips a pet that runs a power other than Auto (a real pet, not totalled)', () => {
    const kept = gd.pets!;
    const fiery = 'Redirects.Fiery_Aura.FieryBurn';
    gd.pets = { ...kept, powers: { ...kept.powers, [fiery]: { ...kept.powers[fiery]!, type: 'Click' } } };
    try {
      expect(stats(gd, 'Class_Brute', 'Brute_Defense.Fiery_Aura.Burn', null)['Average Damage:']).toBeUndefined();
    } finally {
      gd.pets = kept;
    }
  });

  it('shows no pet damage without the pet file, as before it existed', () => {
    const kept = gd.pets;
    gd.pets = null;
    try {
      const s = stats(gd, 'Class_Brute', 'Brute_Defense.Fiery_Aura.Burn', null);
      expect(s['Average Damage:']).toBeUndefined();
      expect(s['Activation Time:']).toBe('2.03s');
    } finally {
      gd.pets = kept;
    }
  });

  it('ends on a pet loop in damaged data', () => {
    const kept = gd.pets!;
    const loop: PetsFile = {
      ...kept,
      pets: { ...kept.pets, 'Redirects.Fiery_Aura.FieryBurn': [{ p: ['Redirects.Fiery_Aura.FieryBurn'], pseudo: 1 }] },
    };
    gd.pets = loop;
    try {
      expect(stats(gd, 'Class_Brute', 'Brute_Defense.Fiery_Aura.Burn', null)['Average Damage:']).toMatch(/^\d+\.\d\d$/);
    } finally {
      gd.pets = kept;
    }
  });

  it('leaves a power without pets as it was', () => {
    const power = 'Controller_Control.Gravity_Control.Crushing_Field';
    const withPets = stats(gd, 'Class_Controller', power, null);
    const kept = gd.pets;
    gd.pets = null;
    try {
      expect(withPets).toEqual(stats(gd, 'Class_Controller', power, null));
      expect(withPets['Average Damage:']).toMatch(/^\d+\.\d\d$/);
    } finally {
      gd.pets = kept;
    }
  });
});

describe("pseudo-pet effect lines (the client's power_AddPetEffects)", () => {
  const gd = loadData('i28p4');
  const BURN = 'Brute_Defense.Fiery_Aura.Burn';
  const IG = 'Brute_Melee.Radiation_Melee.Irradiated_Ground';

  it("lists Burn's pet first (its powers last first), its damage ticking for the pet's lifetime", () => {
    expect(lines(gd, 'Class_Brute', BURN, damageEnh(gd))).toEqual([
      // each line's own note from the info file, as in game (the owner's screenshot)
      '81.33 (41.71) fire damage on target / Within 8ft at initial activation', // FieryBurn_FrontDamage: 1.0 x 41.7087
      // each damage group's FieryEmbrace group (chance 0): listed with its tag mode's note
      '36.60 (18.77) fire damage on target / Only using Fiery Embrace / Within 8ft at initial activation', // 0.45 x 41.7087
      '35.79 (18.35) fire damage on target / Within 15ft at initial activation', // and its 0.44 group
      '16.10 (8.26) fire damage on target / Only using Fiery Embrace / Within 15ft at initial activation', // 0.198
      '13 Ticks of 11.39 (5.84) fire damage over 10.00s on target / Every 0.8 seconds for 10 seconds', // FieryBurn: floor(10 / 0.8) + 1 ticks
      '13 Ticks of 5.12 (2.63) fire damage over 10.00s on target / Only using Fiery Embrace / Every 0.8 seconds for 10 seconds', // 0.063
      '10.38 immobilize protection for 1m 40s(1m 40s) on self / Ignores buffs and enhancements / unresistable',
    ]);
  });

  it("lists Irradiated Ground's villain-def pet, its timed effect and its grant", () => {
    expect(lines(gd, 'Class_Brute', IG, damageEnh(gd))).toEqual([
      '8.95 (4.59) fire damage on target',
      '-5.00% defense debuff for 5.00s on target', // the client's name for Defense (the info file)
      // no "Grants power Contaminated": the client lists no grant of a power it keeps out of the inventory
    ]);
  });

  it('shows a villain-def pet enhanced whenever the power is, and the mod\'s own powers only with CopyBoosts', () => {
    const noBoosts = (name: string) => (f: PetsFile) => ({ ...f, pets: { ...f.pets, [name]: f.pets[name]!.map(({ boosts: _b, ...c }) => c) } });
    withPets(gd, noBoosts(IG), () => {
      expect(stats(gd, 'Class_Brute', IG, damageEnh(gd))['Average Damage:']).toBe('4.59'); // the total: base
      expect(lines(gd, 'Class_Brute', IG, damageEnh(gd))[0]).toBe('8.95 (4.59) fire damage on target');
    });
    withPets(gd, noBoosts(BURN), () => {
      expect(lines(gd, 'Class_Brute', BURN, damageEnh(gd))[0]).toBe('41.71 fire damage on target / Within 8ft at initial activation');
    });
  });

  it('counts a pet under a HideFromInfo group but lists nothing of it', () => {
    withPets(
      gd,
      (f) => ({ ...f, pets: { ...f.pets, [BURN]: f.pets[BURN]!.map((c) => ({ ...c, hid: 1 })) } }),
      () => {
        expect(stats(gd, 'Class_Brute', BURN, null)['Average Damage:']).toBe('130.13');
        expect(lines(gd, 'Class_Brute', BURN, null)).toEqual([
          '10.38 immobilize protection for 1m 40s on self / Ignores buffs and enhancements / unresistable',
        ]);
      },
    );
  });

  it("takes a pet's chances as the client does: its own group's, tick chance only on a DoT", () => {
    const FIERY = 'Redirects.Fiery_Aura.FieryBurn';
    // FieryBurn's damage group at 50%: 41.7087 x (12 x 0.14 x 0.5 + 1.44)
    withPets(
      gd,
      (f) => {
        const pp = f.powers[FIERY]!;
        return { ...f, powers: { ...f.powers, [FIERY]: { ...pp, eff: pp.eff!.map((e, i) => (i ? e : { ...e, ch: 0.5 })) } } };
      },
      () => {
        expect(stats(gd, 'Class_Brute', BURN, null)['Average Damage:']).toBe('95.10');
        expect(lines(gd, 'Class_Brute', BURN, null)[4]).toBe('50.00% chance for 13 Ticks of 5.84 fire damage over 10.00s on target / Every 0.8 seconds for 10 seconds');
      },
    );
    // a tick chance on a mod without duration changes nothing; a HideFromInfo group still counts
    withPets(
      gd,
      (f) => {
        const pp = f.powers[FIERY]!;
        const eff = pp.eff!.map((e, i) => (i ? e : { ...e, fl: ['HideFromInfo'], m: e.m!.map((m) => ({ ...m, tc: 0.5 })) }));
        return { ...f, powers: { ...f.powers, [FIERY]: { ...pp, eff } } };
      },
      () => {
        expect(stats(gd, 'Class_Brute', BURN, null)['Average Damage:']).toBe('130.13');
        expect(lines(gd, 'Class_Brute', BURN, null).some((l) => l.includes('Ticks of 5.84'))).toBe(false);
      },
    );
  });

  it("reads the template's own Duration field: a hold timed by a table shows its group's chance", () => {
    // Shadow Field's pet: its hold (type Duration, timed by Melee_Ones, Duration field 0) is in a
    // group of chance 0.05 a tick, its Overpower hold in one of 0.2; the client shows both chances
    const got = lines(gd, 'Class_Controller', 'Controller_Control.Darkness_Control.Shadow_Field', null);
    expect(got).toContain('5.00% chance for 3.00 magnitude hold for 48.00s on target after 0.25s delay');
    expect(got).toContain('20.00% chance for 1.00 magnitude hold for 48.00s on target / Overpower');
  });
});

describe("ExecutePower (the client's getTotalDamage counts what a power executes)", () => {
  const gd = loadData('i28p4');
  const EXEC = gd.attribByName.get('ExecutePower')!;
  /** @return Average Damage of a power object (base and enhanced) for an archetype at 50. */
  const avg = (at: string, p: Power, enh: Map<number, number> | null) =>
    segText(powerInfo(gd, gd.archetypeByName.get(at.toLowerCase())!, p, L50, enh).stats.find((r) => r.label === 'Average Damage:')?.value ?? []);
  /** @return A copy of a power's groups with each executing mod changed (null drops it). */
  const mapExec = (effs: Effect[] | undefined, f: (m: Mod) => Mod | null): Effect[] | undefined =>
    effs?.map((e) => ({
      ...e,
      m: e.m?.flatMap((m) => (m.a.includes(EXEC) ? (f(m) ?? []) : [m])),
      sub: mapExec(e.sub, f),
    }));
  const HAYMAKER = gd.powerByName.get('brute_melee.super_strength.haymaker')!;
  const SMASH = gd.powerByName.get('redirects.super_strength.smash')!;
  const base = (s: string) => Number(s.replace(/^.*\(|\)$/g, ''));
  const enhanced = (s: string) => Number(s.split(' ')[0]);

  it("adds the executed power's own total, whatever the executing group's requirements", () => {
    // Haymaker executes Smash under Unleash Might (a mode the planner never has on): counted anyway
    const own = avg('Class_Brute', { ...HAYMAKER, eff: mapExec(HAYMAKER.eff, () => null), act: mapExec(HAYMAKER.act, () => null) }, damageEnh(gd));
    const smash = avg('Class_Brute', SMASH, damageEnh(gd));
    const all = avg('Class_Brute', HAYMAKER, damageEnh(gd));
    expect(base(all)).toBeCloseTo(base(own) + base(smash), 1);
    expect(enhanced(all)).toBeCloseTo(enhanced(own) + enhanced(smash), 1); // CopyBoosts: enhanced
  });

  it('counts its base damage only without CopyBoosts', () => {
    const noCopy = (m: Mod): Mod => ({ ...m, fl: m.fl?.filter((f) => f !== 'CopyBoosts') });
    const p = { ...HAYMAKER, eff: mapExec(HAYMAKER.eff, noCopy), act: mapExec(HAYMAKER.act, noCopy) };
    const own = avg('Class_Brute', { ...HAYMAKER, eff: mapExec(HAYMAKER.eff, () => null), act: mapExec(HAYMAKER.act, () => null) }, damageEnh(gd));
    expect(enhanced(avg('Class_Brute', p, damageEnh(gd)))).toBeCloseTo(enhanced(own) + base(avg('Class_Brute', SMASH, null)), 1);
  });

  it("runs what a pet's power executes as the pet, each activation", () => {
    // Storm Cell's pet runs Lightning_Proc every second for 60s; each executes a lightning strike
    const CELL = 'Blaster_Ranged.Storm_Blast.Storm_Cell';
    const full = stats(gd, 'Class_Blaster', CELL, null)['Average Damage:']!;
    expect(full).toBe('3753.79');
    withPets(
      gd,
      (f) => ({ ...f, pets: { ...f.pets, [CELL]: f.pets[CELL]!.map((c) => ({ ...c, dur: 1 })) } }),
      () => expect(Number(stats(gd, 'Class_Blaster', CELL, null)['Average Damage:'])).toBeCloseTo(Number(full) / 60, 1),
    );
  });

  it('counts four executions deep, no more, as the client does', () => {
    // Storm Cell's pet power executes E1, which executes E2 ... E5; E(i) deals 2^(i-1) x 0.01 of the
    // Blaster's Ranged_Damage, so the total says which of them counted: E1-E4 is 15 x 0.01
    const PROC = 'Redirects.Storm_Blast.Lightning_Proc';
    const RANGED = 62.5631; // Blaster Ranged_Damage at 50
    const step = (i: number): Effect[] => [
      {
        m: [
          { a: [gd.attribByName.get('DamageType04')!], asp: 'Absolute', t: 'Magnitude', tg: 'Affected', tbl: 'Ranged_Damage', sc: 0.01 * 2 ** (i - 1) },
          ...(i < 5 ? [{ a: [EXEC], asp: 'Strength', t: 'Magnitude', tg: 'Affected', tbl: 'Melee_Ones', sc: 0, pwn: [`T.Chain.E${i + 1}`], fl: ['CopyBoosts'] }] : []),
        ],
      },
    ];
    withPets(
      gd,
      (f) => {
        const pp = f.powers[PROC]!;
        const chain = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`T.Chain.E${i}`, { type: 'Click', eff: step(i) }]));
        const first = (m: Mod): Mod => ({ ...m, pwn: ['T.Chain.E1'] });
        return { ...f, powers: { ...f.powers, ...chain, [PROC]: { ...pp, eff: mapExec(pp.eff, first), act: mapExec(pp.act, first) } } };
      },
      () => {
        const got = Number(stats(gd, 'Class_Blaster', 'Blaster_Ranged.Storm_Blast.Storm_Cell', null)['Average Damage:']);
        expect(got).toBeCloseTo(60 * 0.15 * RANGED, 1); // 60 activations of E1-E4
      },
    );
  });

  it('counts what a PvP-only group executes (the export drops the group; the pets file keeps it)', () => {
    // Whirling Axe executes a power with no damage, so its figure doesn't move: the real data only
    // shows the file carries it
    expect(gd.pets?.exec?.['Brute_Melee.Battle_Axe.Whirling_Axe']).toEqual([{ p: ['Redirects.Battle_Axe.Battle_Axe'] }]);
    const own = Number(avg('Class_Brute', HAYMAKER, null));
    const smash = Number(avg('Class_Brute', SMASH, null));
    withPets(
      gd,
      (f) => ({ ...f, exec: { ...f.exec, [HAYMAKER.n]: [{ p: [SMASH.n], boosts: 1 }] } }),
      () => expect(Number(avg('Class_Brute', HAYMAKER, null))).toBeCloseTo(own + smash, 1),
    );
  });

  it("names a pet's grant the version's own data lacks", () => {
    // Storm Cell's Tempest grants In Storm Cell to its targets (Tide Pool's grants go to the pet
    // itself, which the client doesn't list)
    expect(gd.powerByName.has('temporary_powers.temporary_powers.stormblast_instormcell')).toBe(false);
    const info = gd.info;
    gd.info = null; // the info file's grant rule apart
    try {
      expect(lines(gd, 'Class_Blaster', 'Blaster_Ranged.Storm_Blast.Storm_Cell', null)).toContain('Grants power In Storm Cell');
    } finally {
      gd.info = info;
    }
    // with it, the client lists no grant of a power it keeps out of the inventory (ShowInInventory 0)
    expect(lines(gd, 'Class_Blaster', 'Blaster_Ranged.Storm_Blast.Storm_Cell', null)).not.toContain('Grants power In Storm Cell');
  });
});

describe('the pets file is taken only whole and well formed', () => {
  const raw = (): Record<string, unknown> => JSON.parse(readFileSync(join(dataDir(), PETS_FOLDER, 'i28p4.json'), 'utf-8'));
  const fresh = () => {
    const gd = loadData('i28p4');
    return new GameData({ core: gd.core, powersets: [...gd.setById.values()], powers: [...gd.powerById.values()], boosts: { boosts: gd.boosts, bonusPowers: gd.bonusPowers, sets: gd.boostSets } });
  };

  it('refuses a file with any part malformed', () => {
    const breaks: ((f: Record<string, unknown>) => void)[] = [
      (f) => ((f.pets as Record<string, unknown>)['Brute_Defense.Fiery_Aura.Burn'] = 5),
      (f) => ((f.pets as Record<string, { p: unknown }[]>)['Brute_Defense.Fiery_Aura.Burn']![0]!.p = 'Redirects.Fiery_Aura.FieryBurn'),
      (f) => ((f.powers as Record<string, { eff: { m: { a: unknown }[] }[] }>)['Redirects.Fiery_Aura.FieryBurn']!.eff[0]!.m[0]!.a = 8),
      (f) => ((f.powers as Record<string, { type: unknown }>)['Redirects.Fiery_Aura.FieryBurn']!.type = 1),
      (f) => ((f.classes as Record<string, Record<string, number>>)['Class_Minion_Pets']!['melee_damage'] = 99999),
      (f) => (f.tables = [[1, 'x']]),
      (f) => (f.plus = '1'),
    ];
    for (const b of breaks) {
      const gd = fresh();
      const f = raw();
      b(f);
      expect(gd.setPets(f)).toBe(false);
      expect(gd.pets).toBeNull();
    }
    expect(fresh().setPets(raw())).toBe(true);
  });

  it('finds nothing under a name objects carry anyway', () => {
    const gd = fresh();
    gd.setPets(raw());
    expect(gd.pets!.pets['constructor']).toBeUndefined();
    expect(gd.classTable('constructor', 'toString', 0)).toBe(0);
  });

  it('tells those waiting when it is taken, and stops when asked', () => {
    const gd = fresh();
    let heard = 0;
    const stop = gd.subscribePets(() => heard++);
    gd.setPets({ nope: true });
    expect(heard).toBe(0);
    gd.setPets(raw());
    expect(heard).toBe(1);
    stop();
    gd.setPets(raw());
    expect(heard).toBe(1);
  });
});

describe('pseudo-pet damage on other clients', () => {
  it("i28p3's pet file comes from its own client (its Burn made two pets)", () => {
    const gd = loadData('i28p3');
    expect(gd.pets?.pets['Brute_Defense.Fiery_Aura.Burn']?.map((c) => c.dur)).toEqual([10, 4.5]);
    expect(stats(gd, 'Class_Brute', 'Brute_Melee.Radiation_Melee.Irradiated_Ground', null)['Average Damage:']).toBe('4.59');
  });

  it("Thunderspy's client counts one more activation and its own tables", () => {
    const gd = loadData('ts9-6', 'thunderspy');
    expect(gd.pets?.plus).toBe(1);
    expect(gd.pets?.pets['Brute_Melee.Radiation_Melee.Irradiated_Ground']?.[0]?.cls).toBe('Class_Minion_Pets');
    // its Melee_Damage for Class_Minion_Pets differs from Homecoming's; no duration, so still one activation
    expect(stats(gd, 'Class_Brute', 'Brute_Melee.Radiation_Melee.Irradiated_Ground', null)['Average Damage:']).toBe('2.29');
  });
});

describe('source.owner> in requirements', () => {
  const ctx = (owner?: string): EvalContext => ({
    ownsPower: () => false,
    ownsSet: () => false,
    prop: (n) => (n === 'archetype' ? 'Class_Minion_Pets' : ''),
    ...(owner ? { ownerProp: (n: string) => (n.startsWith('arch') ? owner : 0) } : {}),
  });
  const req = ['arch', 'source.owner>', 'Class_Brute', 'eq'];

  it("reads the creator's class for a pet", () => {
    expect(evalRequires(req, ctx('Class_Brute'))).toBe(true);
    expect(evalRequires(req, ctx('Class_Scrapper'))).toBe(false);
    expect(evalRequires(['arch', 'source.creator>', 'Class_Brute', 'eq'], ctx('Class_Brute'))).toBe(true);
  });

  it('answers 0 without a creator, as it always did', () => {
    expect(evalRequires(req, ctx())).toBe(false);
    expect(evalRequires(['kHitPoints%', 'source.owner>', '0', '=='], ctx())).toBe(true);
  });
});

describe('loading the pet file never holds up a build', () => {
  const server = serverById('homecoming')!;
  const version = loadVersionIndex().versions.find((v) => v.id === 'i28p4')!;
  const serve = (pets: (url: string) => Promise<Response>) =>
    vi.stubGlobal('fetch', async (url: string) => {
      const path = String(url).split('?')[0]!.replace(/^.*?\/data\//, '');
      if (path.startsWith(`${PETS_FOLDER}/`)) return pets(path);
      return new Response(readFileSync(join(dataDir(), path)));
    });
  afterEach(() => vi.unstubAllGlobals());

  it('attaches the file when it arrives', async () => {
    serve(async (path) => new Response(readFileSync(join(dataDir(), path))));
    const gd = await loadGameData(server, '/x/', version);
    await vi.waitFor(() => expect(gd.pets?.pets['Brute_Defense.Fiery_Aura.Burn']).toBeDefined());
  });

  it('opens without it when it is missing, damaged or never answers', async () => {
    for (const pets of [
      async () => new Response('nope', { status: 404 }),
      async () => new Response('{"pets": [1, 2]}'),
      async () => new Response('not json'),
      () => Promise.reject(new Error('offline')),
      () => new Promise<Response>(() => undefined),
    ]) {
      serve(pets);
      const gd = await loadGameData(server, '/x/', version);
      expect(gd.powerByName.has('brute_defense.fiery_aura.burn')).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(gd.pets).toBeNull();
    }
  });

  it('asks for the file under the version hash, beside the version folders', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url));
      const path = String(url).split('?')[0]!.replace(/^.*?\/data\//, '');
      return new Response(readFileSync(join(dataDir(), path)));
    });
    await loadGameData(server, '/x/', version);
    expect(asked).toContain(`/x/data/${PETS_FOLDER}/i28p4.json?v=${version.hash}`);
    expect(asked.filter((u) => u.includes('/i28p4/'))).toHaveLength(4); // the version's own files, as before
    expect(asked.findIndex((u) => u.includes(`/${PETS_FOLDER}/`))).toBe(4); // asked for once they have come
  });

  it('asks for no pets file when the version itself fails to load', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url));
      return new Response('gone', { status: 503 });
    });
    await expect(loadGameData(server, '/x/', version)).rejects.toThrow(/missing/);
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.some((u) => u.includes(`/${PETS_FOLDER}/`))).toBe(false);
  });
});
