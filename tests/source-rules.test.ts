/**
 * Rules ported from the game engine, pinned with values worked out by hand from the engine's
 * formulas on the committed data. CI can't see the engine source, so each test names the source
 * function its numbers come from, and the comments show the arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { GameData } from '../src/data/gamedata.ts';
import { newBuild, type Build, type SlottedEnh } from '../src/engine/build.ts';
import { effectiveness, enhValues, powerStrength } from '../src/engine/enhance.ts';
import { evalRequires, type EvalContext } from '../src/engine/requires.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { earnedBonuses } from '../src/engine/setbonus.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const P = gd.core.schedule.power;
const FT = 21; // ft/s per 1.0 of speed

/** A new level-50 build of an archetype with the given primary and secondary. */
function build(at: string, primary: string, secondary: string): Build {
  return newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: gd.archetypeByName.get(at.toLowerCase())!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, primary),
    secondary: sid(gd, secondary),
    pickCount: P.length,
  });
}
const blaster = () => build('Class_Blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Fire_Manipulation');

/** Put a power in pick i, its pieces in its free slot and slots gained at its own level. */
function put(b: Build, i: number, power: string, pieces: SlottedEnh[] = [], on?: boolean): void {
  b.picks[i] = { power: pid(gd, power), level: P[i]!, slots: pieces.map((enh) => ({ level: P[i]!, enh })), on };
}
/** A set piece or IO by its short name ("Crafted_Luck_of_the_Gambler_A"), at level 50 when it has levels. */
const io = (short: string): SlottedEnh => ({ boost: pid(gd, `Boosts.${short}.${short}`), ioLevel: 49 });
const totals = (b: Build) => computeTotals(gd, new BuildRules(gd, b), b);
const pieceIssues = (b: Build) => new BuildRules(gd, b).issues().filter((x) => x.slot !== undefined);

describe('current values are the class base x (1 + mods), capped (character_attribs.c CalcCur; character_mods.c ClampMax, ClampCur)', () => {
  it("multiplies Fly's class base of 1.5: 86.5 ft/s at 50 (adding gave 68.2)", () => {
    const b = blaster();
    put(b, 3, 'Pool.Flight.Fly');
    // Fly: Melee_SpeedFlying 1.365 x 1.1788 = +1.609062; Swift (Fitness): 1.365 x 0.1 = +0.1365
    // 1.5 x (1 + 1.609062 + 0.1365) = 4.118343, under the cap of 4.095 + 2.0475 (Fly) + 1 (Afterburner)
    const fly = totals(b).speeds.fly;
    expect(fly).toBeCloseTo(4.118343, 6);
    expect(fly * FT).toBeCloseTo(86.485, 3);
  });

  it("raises the run cap with Super Speed's Maximum mod, never past the class MaxMax", () => {
    const b = blaster();
    put(b, 3, 'Pool.Speed.Super_Speed');
    // Super Speed: Melee_SpeedRunning 3.5 x 1; Swift: 3.5 x 0.1. 1 x (1 + 3.5 + 0.35) = 4.85
    expect(totals(b).speeds.run).toBeCloseTo(4.85, 6);

    // three level-50 Run IOs: 1 x (1 + 3.5 x (1 + s) + 0.35) is past the class maximum of 6.46,
    // which Super Speed raises by 1.938 to 8.398 (the class MaxMax)
    const run3 = [io('Crafted_Run'), io('Crafted_Run'), io('Crafted_Run')];
    put(b, 3, 'Pool.Speed.Super_Speed', run3);
    const ss = gd.power(pid(gd, 'Pool.Speed.Super_Speed'));
    const s = powerStrength(gd, gd.archetype(b.at), ss, run3, 49).post.get(gd.attribByName.get('SpeedRunning')!) ?? 0;
    const run = 1 + 3.5 * (1 + s) + 0.35;
    expect(run).toBeGreaterThan(6.46);
    expect(run).toBeLessThan(8.398);
    expect(totals(b).speeds.run).toBeCloseTo(run, 6);

    // Speed of Sound as well: its own +1.938 would make 10.336, held at the MaxMax of 8.398 (176.4 ft/s)
    put(b, 5, 'Pool.Experimentation.Speed_of_Sound', run3);
    expect(totals(b).speeds.run).toBeCloseTo(8.398, 6);
  });

  it('caps regeneration in absolute units: 0.25 x (1 + 10.65) is under the Scrapper maximum of 7.5', () => {
    const b = build('Class_Scrapper', 'Scrapper_Melee.Broad_Sword', 'Scrapper_Defense.Regeneration');
    put(b, 0, 'Scrapper_Melee.Broad_Sword.Slash');
    put(b, 1, 'Scrapper_Defense.Regeneration.Fast_Healing');
    put(b, 11, 'Scrapper_Defense.Regeneration.Integration');
    put(b, 14, 'Scrapper_Defense.Regeneration.Instant_Healing', [], /*on=*/ true);
    const t = totals(b);
    // Instant Healing 6 + 2, Integration 1 + 0.5, Fast Healing 0.75, Health 0.4
    expect(t.lines.get('regen')!.value).toBeCloseTo(10.65, 6);
    // 0.25 x 11.65 = 2.9125 (of 7.5): / 0.6 x 1338.62 / 100 = 64.98 HP/s. Comparing 1 + 10.65 with
    // 7.5 instead held it at 750%: 41.83 HP/s.
    expect(t.regenPerSec).toBeCloseTo(64.979, 3);
    expect(t.regenPerSecRaw).toBeCloseTo(t.regenPerSec, 9);
  });

  it('gives a fresh level-50 Blaster 7.03 HP/s and 2.08 end/s (Health +40%, Stamina +25%)', () => {
    const t = totals(blaster());
    expect(t.hpMax).toBeCloseTo(1204.76, 2);
    expect(t.regenPerSec).toBeCloseTo((0.25 * 1.4) / 0.6 * 12.0476, 4); // 7.0278
    expect(t.recovPerSec).toBeCloseTo(1.25 / 0.6, 4); // 2.0833
  });
});

describe('set bonuses count distinct pieces that work at the level (boostset.c boostset_FindBonuses)', () => {
  const lotgBonuses = (b: Build, level = 49) => earnedBonuses(gd, new BuildRules(gd, b).entries(), level).filter((x) => x.set.n === 'Luck_of_the_Gambler');
  const twoPiece = 'Set_Bonus.Set_Bonus.Improved_Regeneration_4';

  it('counts a crafted and an attuned copy of one piece once', () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Crafted_Luck_of_the_Gambler_A'), io('Attuned_Luck_of_the_Gambler_A')]);
    const bon = lotgBonuses(b);
    expect(bon.every((x) => x.slotted === 1)).toBe(true);
    expect(bon.some((x) => x.power.n === twoPiece)).toBe(false);
  });

  it('drops crafted pieces too high for an exemplar level; attuned ones always count', () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Crafted_Luck_of_the_Gambler_A'), io('Crafted_Luck_of_the_Gambler_B')]);
    expect(lotgBonuses(b, 49).some((x) => x.power.n === twoPiece)).toBe(true);
    // a level-50 IO works from level 47 (0-based 46): at 30 neither piece counts
    expect(lotgBonuses(b, 29)).toEqual([]);
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Attuned_Luck_of_the_Gambler_A'), io('Attuned_Luck_of_the_Gambler_B')]);
    expect(lotgBonuses(b, 29).some((x) => x.power.n === twoPiece)).toBe(true);
  });

  it("leaves out PvP-only bonuses: Gladiator's Armor A-F in Tough earns 7 of its 12", () => {
    const b = blaster();
    put(b, 3, 'Pool.Fighting.Boxing');
    put(b, 5, 'Pool.Fighting.Tough', 'ABCDEF'.split('').map((l) => io(`Crafted_Gladiators_Armor_${l}`)));
    const bon = earnedBonuses(gd, new BuildRules(gd, b).entries()).filter((x) => x.set.n === 'Gladiators_Armor');
    expect(bon).toHaveLength(7);
    expect(bon.some((x) => x.power.n.startsWith('Set_Bonus.PVP_Set_Bonus.'))).toBe(false);
  });
});

describe('enhancement slot rules (boost.c power_ValidBoostSlotRequired; powers.c power_BoostCheckRequires)', () => {
  it('flags one set piece twice in a power (any of its versions)', () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Crafted_Luck_of_the_Gambler_A'), io('Attuned_Luck_of_the_Gambler_A')]);
    expect(pieceIssues(b).map((x) => [x.key, x.slot, x.message])).toEqual([
      ['pick:3', 0, 'Set piece slotted twice'],
      ['pick:3', 1, 'Set piece slotted twice'],
    ]);
  });

  it('flags a unique piece in two powers (BoostsSlotted> counts the whole character)', () => {
    const b = build('Class_Tanker', 'Tanker_Defense.Invulnerability', 'Tanker_Melee.Super_Strength');
    put(b, 0, 'Tanker_Defense.Invulnerability.Resist_Physical_Damage', [io('Crafted_Steadfast_Protection_B')]);
    put(b, 1, 'Tanker_Melee.Super_Strength.Jab');
    put(b, 2, 'Tanker_Defense.Invulnerability.Temp_Invulnerability', [io('Attuned_Steadfast_Protection_B')]);
    const dn = (n: string) => gd.power(pid(gd, n)).dn;
    expect(pieceIssues(b).map((x) => [x.key, x.message])).toEqual([
      ['pick:0', `Unique, also slotted in ${dn('Tanker_Defense.Invulnerability.Temp_Invulnerability')}`],
      ['pick:2', `Unique, also slotted in ${dn('Tanker_Defense.Invulnerability.Resist_Physical_Damage')}`],
    ]);
  });

  it('treats the stealth pieces of the travel sets as one unique', () => {
    const b = blaster();
    const sprint = pid(gd, 'Inherent.Inherent.Sprint');
    b.granted[sprint] = { slots: [{ level: 0, enh: io('Crafted_Celerity_C') }] };
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Crafted_Unbounded_Leap_C')]);
    expect(pieceIssues(b).map((x) => x.message.startsWith('Unique, also slotted in'))).toEqual([true, true]);
  });

  it('asks level 50 of very rare and superior pieces', () => {
    const b = blaster();
    put(b, 0, 'Blaster_Ranged.Fire_Blast.Flares', [io('Crafted_Apocalypse_A')]);
    expect(pieceIssues(b)).toEqual([]);
    expect(pieceIssues({ ...b, endLevel: 39 }).map((x) => x.message)).toEqual(['Needs level 50']);
  });

  it('keeps archetype origin pieces to their archetype', () => {
    const b = build('Class_Corruptor', 'Corruptor_Ranged.Fire_Blast', 'Corruptor_Buff.Kinetics');
    put(b, 0, 'Corruptor_Ranged.Fire_Blast.Flares');
    const r = new BuildRules(gd, b);
    const flares = r.entries().find((e) => e.key === 'pick:0')!;
    expect(r.slotRefusal(flares, 0, gd.power(io('Attuned_Blasters_Wrath_A').boost))).toBe('Only for Blaster');
  });

  it('allows a piece the game allows, and refuses its second copy elsewhere', () => {
    const b = blaster();
    const sup = io('Superior_Attuned_Superior_Blasters_Wrath_A');
    put(b, 0, 'Blaster_Ranged.Fire_Blast.Flares', [sup]);
    put(b, 2, 'Blaster_Ranged.Fire_Blast.Fire_Blast');
    const r = new BuildRules(gd, b);
    expect(pieceIssues(b)).toEqual([]);
    const [flares, blast] = ['pick:0', 'pick:2'].map((k) => r.entries().find((e) => e.key === k)!);
    expect(r.slotRefusal(flares!, 0, gd.power(sup.boost))).toBeNull();
    expect(r.slotRefusal(blast!, 0, gd.power(sup.boost))).toBe(`Unique, also slotted in ${flares!.power.dn}`);
  });
});

describe('requirement evaluator', () => {
  const ctx = (all: number, inPower: number): EvalContext => ({
    ownsPower: () => false,
    ownsSet: () => false,
    prop: () => 0,
    boostsSlotted: () => all,
    powerBoostsSlotted: () => inPower,
  });
  it('asks BoostsSlotted> of the whole character and PowerBoostsSlotted> of the power', () => {
    expect(evalRequires(['X', 'BoostsSlotted>', '1', '>='], ctx(1, 0))).toBe(true);
    expect(evalRequires(['X', 'PowerBoostsSlotted>', '1', '>='], ctx(1, 0))).toBe(false);
    expect(evalRequires(['X', 'PowerBoostsSlotted>', '1', '>='], ctx(0, 1))).toBe(true);
  });
});

describe('rules pinned from the data', () => {
  it('allows one specialized pool (the set buy requirement and its message)', () => {
    const b = blaster();
    put(b, 13, 'Pool.Sorcery.Mystic_Flight');
    const exp = gd.powerset(sid(gd, 'Pool.Experimentation'));
    expect(new BuildRules(gd, b).newSetBlock(exp, 15)).toBe('You can only have one Specialized power pool in your build.');
  });

  it('uses IOs from three levels below theirs; attuned pieces from their set minimum (boost.c boost_Effectiveness)', () => {
    const dmg = gd.power(pid(gd, 'Boosts.Crafted_Damage.Crafted_Damage'));
    expect(effectiveness(gd, dmg, { boost: dmg.id, ioLevel: 49 }, 45)).toBe(0);
    expect(effectiveness(gd, dmg, { boost: dmg.id, ioLevel: 49 }, 46)).toBe(1);
    const lotg = gd.power(io('Attuned_Luck_of_the_Gambler_A').boost);
    expect(effectiveness(gd, lotg, { boost: lotg.id }, 20)).toBe(0);
    expect(effectiveness(gd, lotg, { boost: lotg.id }, 21)).toBe(1);
  });

  it('keeps the archetype limits at 50', () => {
    const at = (n: string) => gd.archetypeByName.get(n)!;
    expect(GameData.attrAt(at('class_blaster').maxMax, 'HitPoints', 49)).toBeCloseTo(1847.3, 1);
    expect(GameData.attrAt(at('class_blaster').resMax, 'DamageType00', 49)).toBeCloseTo(0.75, 6);
    expect(GameData.attrAt(at('class_tanker').resMax, 'DamageType00', 49)).toBeCloseTo(0.9, 6);
    expect(GameData.attrAt(at('class_brute').resMax, 'DamageType00', 49)).toBeCloseTo(0.9, 6);
    expect(GameData.attrAt(at('class_scrapper').max, 'Regeneration', 49)).toBeCloseTo(7.5, 6);
    expect(GameData.attrAt(at('class_blaster').maxMax, 'SpeedRunning', 49)).toBeCloseTo(8.398, 6);
  });

  it("charges a toggle's endurance per second, less its End Reduction", () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping');
    expect(totals(b).endUsePerSec).toBeCloseTo(0.0325 / 0.5, 6); // 0.065
    // a level-50 End Reduction IO: +42.38% (under ED): 0.065 / 1.4238 = 0.04565
    put(b, 3, 'Pool.Leaping.Combat_Jumping', [io('Crafted_Endurance_Discount')]);
    expect(totals(b).endUsePerSec).toBeCloseTo(0.065 / 1.42384, 4);
  });

  it('makes superior archetype origin pieces 1.25 x the regular ones', () => {
    const b = blaster();
    const at = gd.archetype(b.at);
    const flares = gd.power(pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'));
    const reg = enhValues(gd, at, flares, io('Attuned_Blasters_Wrath_A'), 49);
    const sup = enhValues(gd, at, flares, io('Superior_Attuned_Superior_Blasters_Wrath_A'), 49);
    expect(sup).toHaveLength(reg.length);
    sup.forEach((s, i) => expect(s.value / reg[i]!.value).toBeCloseTo(1.25, 3));
  });
});
