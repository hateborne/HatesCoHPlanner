/**
 * Forum builds recreated through the planner's own screens, the way a player would.
 *
 * Each test imports a Mids data chunk through Saved builds / Import (the build to recreate), then
 * starts a New Build as a Respec and walks it: every power in respec order (pool and epic sets
 * through Choose a Pool / Epic Power Set), every slot on the respec slot screen, then every
 * enhancement through the overview's enhancement picker. The finished build must match the
 * import power for power, slot for slot and enhancement for enhancement, with nothing flagged.
 *
 * The desktop project clicks; the phone project taps through the one-panel phone layout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BuildRules } from '../src/engine/rules.ts';
import { loadData } from '../tests/helpers/data.ts';
import { gd, Player, RESPEC_TO, shape } from './player.ts';

// builds legal on the patch they open on (tests/buildfixtures.test.ts imports the same files), with
// how many enhancements each holds (so an import that drops some can't pass by recreating less) and
// the game version the import opens them on (none: the default, as for a |MxDz; chunk, which records
// no patch)
const BUILDS = [
  { file: 'symphony-dark-dominator.txt', title: 'Symphony Control / Dark Assault Dominator (|MxDz; chunk)', enhancements: 91 },
  // made before Issue 28, Page 3: opens there after "Open on Issue 28, Page 3 (Dec 16 update)?"
  { file: 'archery-traps-corruptor.txt', title: 'Archery / Traps Corruptor (|MBD; chunk)', enhancements: 92, version: 'i28p3' },
];

test.describe('forum builds, recreated with a respec', () => {
  for (const { file, title, enhancements, version } of BUILDS) {
    test(title, async ({ page }, info) => {
      const me = new Player(page, info.project.name === 'phone');
      await page.goto('./');

      // the build to recreate, read through the planner's own import
      const target = await me.importBuild(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', file), 'utf-8'));
      expect(target.dataVersion).toBe(version ?? gd.core.manifest.dataVersion);
      const vgd = loadData(target.dataVersion); // the build is checked on its own patch's data
      const rules = new BuildRules(vgd, target);
      expect(target.picks.filter(Boolean)).toHaveLength(24);
      expect(rules.entries().reduce((n, e) => n + Math.max(0, e.slots.length - 1), 0)).toBe(67); // every slot a character earns
      expect(rules.entries().flatMap((e) => e.slots.filter((s) => s.enh))).toHaveLength(enhancements);
      expect(rules.issues()).toEqual([]);

      await me.newBuild(target, 'respec');
      await me.choosePowers(target);
      await me.placeSlots(target);
      await me.placeEnhancements(target);

      const made = await me.build();
      expect(made.respecTo).toBe(RESPEC_TO);
      expect(made.dataVersion).toBe(target.dataVersion); // New Build stays on the imported build's version
      expect(shape(vgd, made)).toEqual(shape(vgd, target));
      expect(new BuildRules(vgd, made).issues()).toEqual([]);
    });
  }
});
