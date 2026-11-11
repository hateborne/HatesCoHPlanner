/**
 * A forum leveling build recreated through the level-up wizard, the way a player levels: New Build
 * (leveling), then level 1 to 50, each level's powers and then its slots, on the powers and at the
 * levels the build has them. Then every enhancement through the overview's picker. The finished
 * build must match the import, slot levels included, with nothing flagged.
 *
 * The build is a Mids .mbd file (tests/fixtures/builds/README.md), opened with Saved builds /
 * Import / Open .mbd file. The desktop project clicks; the phone project taps.
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BuildRules } from '../src/engine/rules.ts';
import { gd, Player, shape } from './player.ts';

const FILE = 'elec-sonic-stalker-leveling.mbd';

test('Electrical Melee / Sonic Aura Stalker, levelled 1 to 50 (Mids .mbd file)', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await page.goto('./');

  const target = await me.importFile(join(process.cwd(), 'tests', 'fixtures', 'builds', FILE));
  const rules = new BuildRules(gd, target);
  expect(target.respecTo).toBeUndefined(); // a leveling build: every slot keeps its level
  expect(target.picks.filter(Boolean)).toHaveLength(24);
  expect(rules.entries().reduce((n, e) => n + Math.max(0, e.slots.length - 1), 0)).toBe(67);
  expect(rules.entries().flatMap((e) => e.slots.filter((s) => s.enh))).toHaveLength(95);
  expect(rules.issues()).toEqual([]);

  await me.newBuild(target, 'leveling');
  await me.levelUp(target);
  await me.placeEnhancements(target);

  const made = await me.build();
  expect(made.respecTo).toBeUndefined();
  expect(shape(gd, made, /*levels=*/ true)).toEqual(shape(gd, target, /*levels=*/ true));
  expect(new BuildRules(gd, made).issues()).toEqual([]);
});
