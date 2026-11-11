import type { GameData } from '../../src/data/gamedata.ts';
import { addSlot, setPick } from '../../src/engine/actions.ts';
import { newBuild, type Alignment, type Build } from '../../src/engine/build.ts';
import { BuildRules, MAX_BOUGHT_SLOTS } from '../../src/engine/rules.ts';

/**
 * Level a new build from 1 to 50 the way a player clicking the first choice on every screen would:
 * each pick takes the first available power of the primary, the secondary, their branch sets, the
 * pools and epics already owned, then a new pool or epic; each slot level puts its slots on the
 * first powers that can take one.
 *
 * @param gd Game data.
 * @param at Archetype full name ("Class_Blaster").
 * @param primary Primary powerset id.
 * @param secondary Secondary powerset id.
 * @param alignment Alignment (default Hero).
 * @return The build, every pick made and every slot placed.
 * @throws When some pick has nothing available.
 */
export function walkTo50(gd: GameData, at: string, primary: number, secondary: number, alignment: Alignment = 'Hero'): Build {
  const arch = gd.archetypeByName.get(at.toLowerCase());
  if (!arch) throw new Error(`no archetype ${at}`);
  let b = newBuild({ dataVersion: gd.core.manifest.dataVersion, at: arch.id, origin: gd.core.origins[0]!.id, alignment, primary, secondary, pickCount: gd.core.schedule.power.length });
  for (let i = 0; i < gd.core.schedule.power.length; i++) {
    const r = new BuildRules(gd, b);
    const first = (ids: readonly number[]) => ids.find((p) => !gd.power(p).auto && r.powerOption(p, i).state === 'available');
    const owned = r.ownedSets(r.ownedAt(r.pickLevel(i), i));
    const sets = [
      gd.powerset(primary),
      gd.powerset(secondary),
      ...gd.setsInCategory(arch.cats.pri).filter((s) => s.spa),
      ...gd.setsInCategory(arch.cats.sec).filter((s) => s.spa),
      ...[arch.cats.pool, arch.cats.epic].flatMap((c) => gd.setsInCategory(c)).filter((s) => owned.has(s.id)),
    ];
    let pick: number | undefined;
    for (const s of sets) if (pick === undefined) pick = first(s.p);
    for (const kind of ['pool', 'epic'] as const) {
      for (const c of pick === undefined ? r.newSetChoices(kind, i) : []) if (pick === undefined && !c.block) pick = first(c.set.p);
    }
    if (pick === undefined) throw new Error(`${at}: nothing to pick at pick ${i + 1}`);
    b = setPick(gd, b, i, pick);
  }
  // slots planned from one rules view (a new one per slot recomputes the granted powers every time);
  // BuildRules.issues() is what checks the result
  const r = new BuildRules(gd, b);
  const entries = r.entries();
  const count = new Map(entries.map((e) => [e.key, e.slots.length]));
  for (let level = 0; level <= 49; level++) {
    for (let n = r.slotsGranted(level); n > 0; n--) {
      const e = entries.find((x) => x.level <= level && r.slottable(x.power) && count.get(x.key)! < Math.min(x.power.maxB ?? 0, MAX_BOUGHT_SLOTS + 1));
      if (!e) break;
      count.set(e.key, count.get(e.key)! + 1);
      b = addSlot(b, e.key, level, e.level);
    }
  }
  return b;
}
