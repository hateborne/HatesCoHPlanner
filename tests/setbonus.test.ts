/**
 * Set bonuses start at two pieces of a set in one power. A unique piece's own global effect (Luck
 * of the Gambler's +7.5% recharge) is stored as a one-piece bonus entry, but it is no set bonus:
 * the totals count it under the piece's name and Set Bonuses never lists it as a "(1)".
 */
import { describe, expect, it } from 'vitest';
import { newBuild, type Build, type SlottedEnh } from '../src/engine/build.ts';
import { BuildRules, type BuildEntry } from '../src/engine/rules.ts';
import { earnedBonuses, isPieceGlobal } from '../src/engine/setbonus.ts';
import { computeTotals } from '../src/engine/totals.ts';
import { loadData, loadVersionIndex, pid, sid } from './helpers/data.ts';

const gd = loadData();
const P = gd.core.schedule.power;
const GLOBAL = 'Set_Bonus.Global_Bonus.Luck_of_the_Gambler';

/** A new level-50 Fire/Fire Blaster. */
function blaster(): Build {
  return newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: gd.archetypeByName.get('class_blaster')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: P.length,
  });
}

/** Put a power in pick i with Luck of the Gambler pieces by letter, at level 50. */
function put(b: Build, i: number, power: string, letters: string): void {
  const enh = (l: string): SlottedEnh => ({ boost: pid(gd, `Boosts.Crafted_Luck_of_the_Gambler_${l}.Crafted_Luck_of_the_Gambler_${l}`), ioLevel: 49 });
  b.picks[i] = { power: pid(gd, power), level: P[i]!, slots: letters.split('').map((l) => ({ level: P[i]!, enh: enh(l) })) };
}

const lotgGroup = (b: Build) => computeTotals(gd, new BuildRules(gd, b), b).setGroups.find((g) => g.set.n === 'Luck_of_the_Gambler');

describe('one piece of a set earns no set bonus', () => {
  it('stores only unique pieces\' globals as one-piece entries, each gated on its piece', () => {
    for (const set of gd.boostSets) {
      for (const bn of set.bon.filter(isPieceGlobal)) {
        expect(bn.min, set.n).toBe(1);
        expect(bn.req, set.n).toContain('PowerBoostsSlotted>');
      }
    }
  });

  it('a lone ordinary piece earns nothing and is not listed', () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', 'A');
    const bon = earnedBonuses(gd, new BuildRules(gd, b).entries());
    expect(bon.filter((x) => x.set.n === 'Luck_of_the_Gambler')).toEqual([]);
    expect(lotgGroup(b)).toBeUndefined();
  });

  it('a lone global piece keeps its +7.5% recharge but is no set bonus', () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', 'F');
    put(b, 4, 'Pool.Fighting.Weave', 'F');
    const rules = new BuildRules(gd, b);
    const bon = earnedBonuses(gd, rules.entries()).filter((x) => x.set.n === 'Luck_of_the_Gambler');
    expect(bon.map((x) => [x.power.n, x.slotted, x.global])).toEqual([
      [GLOBAL, 1, true],
      [GLOBAL, 1, true],
    ]);
    const t = computeTotals(gd, rules, b);
    // no set bonus at all: the set is not listed
    expect(t.setGroups.find((g) => g.set.n === 'Luck_of_the_Gambler')).toBeUndefined();
    // the piece's own effect still counts, under the piece's name: 2 x 7.5%
    const rech = t.lines.get('rech')!;
    expect(rech.value).toBeCloseTo(0.15, 6);
    const piece = 'Luck of the Gambler: Defense/Increased Global Recharge Speed';
    expect(rech.sources.map((s) => s.name)).toEqual([piece, piece]);
    expect(bon.map((x) => x.piece?.n)).toEqual(['Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F', 'Boosts.Crafted_Luck_of_the_Gambler_F.Crafted_Luck_of_the_Gambler_F']);
  });

  // every published version: every piece of every set (crafted, attuned, superior...) alone in a
  // power that takes the set earns no set bonus, only its own global if it has one
  for (const { id } of loadVersionIndex().versions) {
    it(`no lone piece of any set earns a set bonus or a listing (${id})`, () => {
      const vd = loadData(id);
      const VP = vd.core.schedule.power;
      const blank = () =>
        newBuild({
          dataVersion: vd.core.manifest.dataVersion,
          at: vd.archetypeByName.get('class_blaster')!.id,
          origin: vd.core.origins[0]!.id,
          alignment: 'Hero',
          primary: sid(vd, 'Blaster_Ranged.Fire_Blast'),
          secondary: sid(vd, 'Blaster_Support.Fire_Manipulation'),
          pickCount: VP.length,
        });
      const withPiece = (power: number, boost?: number): Build => {
        const b = blank();
        b.picks[3] = { power, level: VP[3]!, slots: [{ level: VP[3]!, ...(boost !== undefined ? { enh: { boost, ioLevel: 49 } } : {}) }] };
        return b;
      };
      // the power's build entry, made once per power; each piece then swaps in its one slot
      const entries = new Map<number, BuildEntry>();
      const entryOf = (power: number): BuildEntry => {
        let e = entries.get(power);
        if (!e) entries.set(power, (e = new BuildRules(vd, withPiece(power)).entries().find((x) => x.key === 'pick:3')!));
        return e;
      };
      let pieces = 0;
      const globalSets = new Set<string>(); // sets whose global piece was seen earning its global
      for (const set of vd.boostSets) {
        const power = set.elig[0];
        if (power === undefined) continue;
        for (const variants of set.slots) {
          for (const boost of variants) {
            const one: BuildEntry = { ...entryOf(power), slots: [{ level: VP[3]!, enh: { boost, ioLevel: 49 } }] };
            const bon = earnedBonuses(vd, [one]).filter((x) => x.set.id === set.id);
            pieces++;
            expect(bon.filter((x) => !x.global).map((x) => x.power.n), `${vd.power(boost).n} alone`).toEqual([]);
            if (bon.length === 0) continue;
            // a global is named after the piece that earns it
            expect(bon.map((x) => x.piece?.id), `${vd.power(boost).n} alone`).toEqual(bon.map(() => boost));
            globalSets.add(set.n);
            const b = withPiece(power, boost);
            const t = computeTotals(vd, new BuildRules(vd, b), b);
            expect(t.setGroups.find((g) => g.set.id === set.id), `${vd.power(boost).n} alone`).toBeUndefined();
          }
        }
      }
      expect(pieces).toBeGreaterThan(1000);
      // every set with a piece global really earned it from its lone piece (none skipped as ineffective)
      expect([...globalSets].sort()).toEqual(vd.boostSets.filter((s) => s.bon.some(isPieceGlobal)).map((s) => s.n).sort());
    });
  }

  it('lists only the powers with two or more pieces: (3), not (3) (1) (1)', () => {
    const b = blaster();
    put(b, 3, 'Pool.Leaping.Combat_Jumping', 'ABF');
    put(b, 4, 'Pool.Fighting.Weave', 'F');
    put(b, 5, 'Pool.Leadership.Defense', 'F');
    put(b, 6, 'Pool.Flight.Combat_Flight', 'C');
    const rules = new BuildRules(gd, b);
    const t = computeTotals(gd, rules, b);
    const g = t.setGroups.find((x) => x.set.n === 'Luck_of_the_Gambler')!;
    expect(g.counts).toEqual([3]);
    // the (2) and (3) bonuses of the one 3-piece power; the globals add no stat to the set
    const twoThree = earnedBonuses(gd, rules.entries()).filter((x) => x.set.n === 'Luck_of_the_Gambler' && !x.global);
    expect(twoThree.map((x) => x.power.n)).toEqual(['Set_Bonus.Set_Bonus.Improved_Regeneration_4', 'Set_Bonus.Set_Bonus.Increased_Health_2']);
    expect(g.stats.map((s) => s.label)).not.toContain('Recharge');
    // three globals (Combat Jumping, Weave, Maneuvers): 3 x 7.5%
    expect(t.lines.get('rech')?.value).toBeCloseTo(0.225, 6);
    expect(t.lines.get('regen')?.sources.map((s) => s.name)).toContain('Luck of the Gambler (3)');
  });
});
