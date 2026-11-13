import { describe, expect, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { setPick } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { evalRequires } from '../src/engine/requires.ts';
import { BuildRules, isPatronSet, patronArcNote } from '../src/engine/rules.ts';
import { loadData, pid } from './helpers/data.ts';

const gd = loadData();
const PATRON = /(Leviathan|Mace|Mu|Soul)_Mastery$/;
// the first pick at level 35 (0-based 34), where the epic and Patron pools open
const EPIC_PICK = gd.core.schedule.power.findIndex((lv) => lv >= 34);

/** @return A new build of an archetype, on its first primary and secondary sets. */
function buildFor(g: GameData, atName: string): Build {
  const at = g.archetypeByName.get(atName)!;
  return newBuild({
    name: 'Patron',
    at: at.id,
    origin: g.core.origins[0]!.id,
    alignment: 'Villain',
    primary: g.setsInCategory(at.cats.pri)[0]!.id,
    secondary: g.setsInCategory(at.cats.sec)[0]!.id,
    dataVersion: g.core.manifest.dataVersion,
    pickCount: g.core.schedule.power.length,
    server: g.server,
  });
}

/** @return The Patron sets an archetype's level-35 epic screen offers, by name. */
function offered(atName: string): string[] {
  const rules = new BuildRules(gd, buildFor(gd, atName));
  return rules
    .newSetChoices('epic', EPIC_PICK)
    .filter((c) => PATRON.test(c.set.n) && c.block === null)
    .map((c) => c.set.n);
}

describe('Patron Power Pools', () => {
  it('are offered at level 35 to every archetype the game has them for', () => {
    // the game data's Patron sets, by every archetype their first power asks for (Controllers
    // share the Dominator sets: `$archetype @Class_Dominator == $archetype @Class_Controller == ||`)
    const byAt = new Map<string, string[]>();
    for (const s of gd.setsInCategory('Epic').filter((x) => PATRON.test(x.n))) {
      for (const tok of gd.power(s.p[0]!).br ?? []) {
        if (!tok.startsWith('@Class_')) continue;
        const at = tok.slice(1).toLowerCase();
        byAt.set(at, [...(byAt.get(at) ?? []), s.n]);
      }
    }
    expect(byAt.size).toBeGreaterThanOrEqual(9);
    expect(byAt.get('class_controller')?.length).toBe(4);
    for (const [at, sets] of byAt) expect(offered(at).sort(), at).toEqual(sets.sort());
  });

  it('are the only epic pools of Arachnos Soldiers and Widows, and Kheldians get none at all', () => {
    // the wiki: Warshades, Peacebringers, Arachnos Soldiers and Widows get no Ancillary Power Pools
    for (const at of ['class_arachnos_soldier', 'class_arachnos_widow']) {
      const epics = new BuildRules(gd, buildFor(gd, at)).newSetChoices('epic', EPIC_PICK).map((c) => c.set.n);
      expect(epics.length, at).toBe(4);
      expect(epics.every((n) => PATRON.test(n)), at).toBe(true);
    }
    for (const at of ['class_peacebringer', 'class_warshade']) {
      expect(new BuildRules(gd, buildFor(gd, at)).newSetChoices('epic', EPIC_PICK), at).toEqual([]);
    }
  });

  it('offer their first two powers at 35 and the rest at 38, 41 and 44', () => {
    const rules = new BuildRules(gd, buildFor(gd, 'class_controller'));
    const set = gd.setByName.get('epic.controller_mace_mastery')!;
    const states = set.p.map((p) => rules.powerOption(p, EPIC_PICK));
    expect(states.map((o) => o.state)).toEqual(['available', 'available', 'unavailable', 'unavailable', 'unavailable']);
    expect(set.av).toEqual([34, 34, 37, 40, 43]);
  });

  it('take the one epic pool a build has', () => {
    const b = setPick(gd, buildFor(gd, 'class_controller'), EPIC_PICK, pid(gd, 'Epic.Controller_Mace_Mastery.Scorpion_Shield'));
    const rules = new BuildRules(gd, b);
    const next = EPIC_PICK + 1;
    const others = rules.newSetChoices('epic', next).filter((c) => c.set.n !== 'Epic.Controller_Mace_Mastery');
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((c) => c.block !== null)).toBe(true);
    expect(rules.issues().filter((i) => i.message.includes('Scorpion Shield'))).toEqual([]);
  });

  it('are found from their accolade check: the 31 Patron sets and nothing else', () => {
    const all = gd.core.archetypes.flatMap((a) => [a.cats.pri, a.cats.sec, a.cats.pool, a.cats.epic]);
    const sets = [...new Set(all)].flatMap((c) => gd.setsInCategory(c));
    const patron = sets.filter((s) => isPatronSet(gd, s)).map((s) => s.n);
    expect(patron.length).toBe(31);
    expect(patron.every((n) => PATRON.test(n))).toBe(true);
    expect(sets.filter((s) => PATRON.test(s.n) && !isPatronSet(gd, s))).toEqual([]);
  });

  it("never let another archetype's Patron powers in, not even the last three (no class check of their own)", () => {
    const own = setPick(gd, buildFor(gd, 'class_controller'), EPIC_PICK, pid(gd, 'Epic.Controller_Mace_Mastery.Scorpion_Shield'));
    const rules = new BuildRules(gd, own);
    const foreign = gd.setsInCategory('Epic').filter((s) => isPatronSet(gd, s) && !(gd.power(s.p[0]!).br ?? []).includes('@Class_Controller'));
    expect(foreign.length).toBeGreaterThan(20);
    for (let pick = EPIC_PICK + 1; pick < gd.core.schedule.power.length; pick++) {
      for (const s of foreign) {
        for (const p of s.p) expect(rules.powerOption(p, pick).state, `${gd.power(p).n} at pick ${pick}`).not.toBe('available');
        expect(rules.newSetChoices('epic', pick).find((c) => c.set.id === s.id)?.block ?? 'not listed').not.toBeNull();
      }
    }
  });

  it('tell hero builds choosing one that the arc is villain content, and nobody else', () => {
    const mace = gd.setByName.get('epic.controller_mace_mastery')!;
    const fire = gd.setByName.get('epic.fire_mastery')!;
    const hero = buildFor(gd, 'class_controller');
    const note = patronArcNote(gd, { ...hero, alignment: 'Hero' }, mace)!;
    expect(note.text).toMatch(/^Mace Mastery is a Patron pool\..*switch to villain/);
    // "Patron pool" links to the wiki's page, the first time it appears
    expect(note.link).toEqual({ phrase: 'Patron pool', href: 'https://homecoming.wiki/wiki/Patron_Power_Pools' });
    expect(note.text.indexOf(note.link.phrase)).toBe('Mace Mastery is a '.length);
    expect(patronArcNote(gd, { ...hero, alignment: 'Hero' }, fire)).toBeNull();
    expect(patronArcNote(gd, { ...hero, alignment: 'Villain' }, mace)).toBeNull();
    expect(patronArcNote(gd, { ...hero, alignment: 'Praetorian' }, mace)).toBeNull();
  });

  it('count only the Patron accolades as earned, no other badge', () => {
    const rules = new BuildRules(gd, buildFor(gd, 'class_brute'));
    const ctx = rules.ctx(EPIC_PICK, new Set());
    for (const badge of ['SpidersKissPatron', 'TheStingerPatron', 'BloodInTheWaterPatron', 'MiragePatron']) {
      expect(evalRequires([badge, 'Owned?'], ctx), badge).toBe(true);
    }
    expect(evalRequires(['VetSprints', 'Owned?'], ctx)).toBe(false);
    expect(evalRequires(['Beta_AutoLevel50', 'Owned?'], ctx)).toBe(false);
  });
});
