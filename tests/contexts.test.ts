/**
 * Requirement contexts (src/engine/context.ts): every context the engine evaluates with is put
 * together from the same few parts, and its target is always given whole. A context copied by hand
 * from the totals' kept saying its target was the caster, which hid Grant Cover's defense from a
 * pet; `aimedAt` keeps nothing of an old target, and nothing in the engine sets one by hand.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aimedAt, nobody, withModes, withOwner, withProps, withSlotted } from '../src/engine/context.ts';
import { evalRequires, evalValue, type EvalContext } from '../src/engine/requires.ts';

// the requirement that tells a power's caster from everyone else (Grant Cover's two groups)
const ON_CASTER = ['entref', 'target>', 'entref', 'source>', 'eq'];
const NOT_ON_CASTER = [...ON_CASTER, '!'];

describe('nobody', () => {
  it('owns nothing, answers 0 for every property unless told, and has no target', () => {
    const ctx = nobody();
    expect([ctx.ownsPower('Pool.Leaping.Combat_Jumping'), ctx.ownsSet('Pool.Leaping'), ctx.prop('level')]).toEqual([false, false, 0]);
    expect(Object.keys(ctx).sort()).toEqual(['ownsPower', 'ownsSet', 'prop']);
    expect(nobody((n) => (n === 'level' ? 1 : 0)).prop('level')).toBe(1);
    // with no target named, a power lands on a foe that is not the caster
    expect(evalRequires(ON_CASTER, ctx)).toBe(false);
    expect(evalRequires(['enttype', 'target>', 'critter', 'eq'], ctx)).toBe(true);
  });
});

describe('aimedAt', () => {
  it('names the target: its type, whether it is the caster, its villain def and its properties', () => {
    const pet = aimedAt(nobody(), { type: 'critter', isSource: false, villain: (n) => n === 'MastermindPets_Droid', prop: (n) => (n === 'group' ? 'Robots' : undefined) });
    expect(evalRequires(NOT_ON_CASTER, pet)).toBe(true);
    expect(evalRequires(ON_CASTER, pet)).toBe(false);
    expect(evalRequires(['enttype', 'target>', 'critter', 'eq'], pet)).toBe(true);
    expect(evalRequires(['MastermindPets_Droid', 'target.VillainName>'], pet)).toBe(true);
    expect(evalRequires(['MastermindPets_Zombie', 'target.VillainName>'], pet)).toBe(false);
    expect(evalRequires(['group', 'target>', 'Robots', 'eq'], pet)).toBe(true);
    const self = aimedAt(nobody(), { type: 'player', isSource: true });
    expect(evalRequires(ON_CASTER, self)).toBe(true);
    expect(evalRequires(['enttype', 'target>', 'player', 'eq'], self)).toBe(true);
  });

  it('keeps nothing of the target a context had (the totals say the target is the caster; a pet is not)', () => {
    const totals = aimedAt(nobody(), { type: 'player', isSource: true, villain: () => true, prop: () => 'Robots' });
    const pet = aimedAt(totals, { type: 'critter', isSource: false });
    expect(pet.targetEntType).toBe('critter');
    expect(pet.targetIsSource).toBe(false);
    expect(pet.targetVillain).toBeUndefined();
    expect(pet.targetProp).toBeUndefined();
    expect(evalRequires(ON_CASTER, pet)).toBe(false);
    expect(evalRequires(NOT_ON_CASTER, pet)).toBe(true);
    expect(evalRequires(['MastermindPets_Droid', 'target.VillainName>'], pet)).toBe(false);
    expect(evalValue(['group', 'target>'], pet)).toBe(0);
    // the context it started from is untouched
    expect([totals.targetEntType, totals.targetIsSource]).toEqual(['player', true]);
  });

  it('leaves everything that is not about the target as it was', () => {
    const who: EvalContext = { ...nobody((n) => (n === 'level' ? 50 : 0)), ownsPower: (n) => n === 'x', inMode: () => true, boostsSlotted: () => 2 };
    const aimed = aimedAt(who, { type: 'critter', isSource: false });
    expect([aimed.ownsPower('x'), aimed.prop('level'), aimed.inMode?.('kMode'), aimed.boostsSlotted?.('Crafted_Aegis_F')]).toEqual([true, 50, true, 2]);
  });
});

describe('the other parts', () => {
  it('withProps answers the named properties anew and the rest as before', () => {
    const ctx = withProps(nobody((n) => (n === 'level' ? 12 : n === 'archetype' ? 'Class_Brute' : 0)), (n) => (n === 'level' ? 50 : undefined));
    expect([ctx.prop('level'), ctx.prop('archetype'), ctx.prop('origin')]).toEqual([50, 'Class_Brute', 0]);
    // 0 is an answer, not "keep the old one"
    expect(withProps(nobody(() => 7), (n) => (n === 'level' ? 0 : undefined)).prop('level')).toBe(0);
  });

  it('withSlotted sets the counts given and keeps the one left out', () => {
    const both = withSlotted(nobody(), { all: () => 3, inPower: () => 1 });
    expect([both.boostsSlotted?.('a'), both.powerBoostsSlotted?.('a')]).toEqual([3, 1]);
    const inPowerOnly = withSlotted(both, { inPower: () => 5 });
    expect([inPowerOnly.boostsSlotted?.('a'), inPowerOnly.powerBoostsSlotted?.('a')]).toEqual([3, 5]);
    // a set bonus's own requirement: only what its power holds
    const bonus = withSlotted(nobody(), { inPower: (n) => (n.toLowerCase() === 'crafted_aegis_f' ? 1 : 0) });
    expect(bonus.boostsSlotted).toBeUndefined();
    expect(evalValue(['Crafted_Aegis_F', 'PowerBoostsSlotted>'], bonus)).toBe(1);
  });

  it('withModes and withOwner add the modes and the creator', () => {
    const ctx = withOwner(withModes(nobody(), (n) => n === 'kDefensiveAdaptation'), (n) => (n === 'arch' ? 'Class_Brute' : 0));
    expect(evalRequires(['kDefensiveAdaptation', 'Source.Mode?'], ctx)).toBe(true);
    expect(evalRequires(['kOffensiveAdaptation', 'Source.Mode?'], ctx)).toBe(false);
    expect(evalRequires(['arch', 'source.owner>', 'Class_Brute', 'eq'], ctx)).toBe(true);
  });
});

describe('the engine', () => {
  /** @return Every source file under a folder. */
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
  const src = files(join(process.cwd(), 'src')).map((f) => ({ name: f.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/'), text: readFileSync(f, 'utf8') }));

  it('sets a target nowhere but in aimedAt', () => {
    const byHand = src.filter((f) => f.name !== 'src/engine/context.ts' && /\b(targetEntType|targetIsSource|targetVillain|targetProp)\s*:\s*[^;]*,/.test(f.text.replace(/^\s*(\/\/|\*|\/\*).*$/gm, '')));
    expect(byHand.map((f) => f.name)).toEqual([]);
  });

  it("builds a character's own answers in one place, and an owner of nothing through nobody", () => {
    const owners = src.filter((f) => /\bownsPower\s*:/.test(f.text)).map((f) => f.name);
    expect(owners.sort()).toEqual(['src/engine/context.ts', 'src/engine/rules.ts']);
  });
});
