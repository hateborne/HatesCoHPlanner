/**
 * The set finder's two ways into the build overview, on the desktop and the phone layout.
 *
 * 1. "Select powers..." puts the pane out of the way so the powers to consider are picked on the
 *    overview: nothing there answers meanwhile but the power bars (and the phone's tabs), a bar's
 *    press picks its power, and Done brings the pane back with the picked power as its search.
 * 2. Desktop: the copy keys over a slotted enhancement copy the auction house search for that one
 *    enhancement, its recipe and that recipe's salvage (phones have no hover).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { checkRecipes, RECIPES_FOLDER } from '../src/data/recipes.ts';
import { itemSearch } from '../src/engine/finder/shopping.ts';
import { dataDir } from '../tests/helpers/data.ts';
import { gd, Player } from './player.ts';

const CHUNK = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', 'symphony-dark-dominator.txt'), 'utf-8');

test('set finder: powers are picked on a still overview, and the copy keys copy one enhancement', async ({ page, context }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await page.goto('./Homecoming/'); // the site root asks for a server once there is more than one
  const build = await me.importBuild(CHUNK);
  expect(build.dataVersion).toBe(gd.core.manifest.dataVersion);
  const bars = page.locator('[data-testid^="bar:"]');
  await expect(bars.first()).toBeVisible();

  // the pane: its button on the desktop, the menu's row on a phone
  const menu = page.getByLabel('Menu', { exact: true });
  if (me.phone) {
    await me.press(menu);
    await me.press(page.getByText('Set Finder', { exact: true }).last());
  } else {
    await me.press(me.id('finder:open'));
  }
  await page.getByTestId('finder:group').selectOption('__pick');
  // (the box's own element takes no room: its Done button is what shows)
  const box = me.button('Done');
  await expect(box).toBeVisible();
  await expect(me.id('finder:picking')).toHaveCount(1);
  await expect(me.id('finder:group')).toHaveCount(0);

  // nothing but the bars answers: the build's name, the level orbs or log, the phone's menu
  const before = await me.build();
  if (me.phone) {
    await menu.tap();
    await expect(page.getByText('Finish selecting powers first: press Done.').first()).toBeVisible();
    await expect(page.getByText('Set Finder', { exact: true })).toHaveCount(0);
  } else {
    await page.getByRole('button', { name: 'New Build', exact: true }).click();
    await page.getByRole('button', { name: 'Origin / Alignment', exact: true }).click({ force: true });
    await page.locator('[data-testid^="ring:"]').first().click();
  }
  await expect(box).toBeVisible();
  await expect(bars.first()).toBeVisible();
  await expect(page.getByPlaceholder('Paste a share link')).toHaveCount(0);
  expect(await me.build()).toEqual(before);

  // a bar picks its power and lets it go again
  const picked = page.locator('[data-testid^="picked:"]');
  await me.press(bars.first());
  await expect(picked).toHaveCount(1);
  await me.press(bars.first());
  await expect(picked).toHaveCount(0);
  await me.press(bars.first());
  await expect(picked).toHaveCount(1);
  // a phone's tabs still turn, to reach every bar
  if (me.phone) {
    await me.press(me.id('tab:Secondary'));
    await expect(picked).toHaveCount(0);
    await me.press(me.id('tab:Primary'));
    await expect(picked).toHaveCount(1);
  }

  // Done: the pane is back, kept to the one power
  await me.press(box);
  await expect(box).toHaveCount(0);
  await expect(me.id('finder:powersnote')).toContainText('Only the power you picked is searched.');
  expect(await me.build()).toEqual(before);
  await me.press(me.id('finder:close'));
  await expect(me.id('finder:group')).toHaveCount(0);

  if (me.phone) return;
  // the copy keys over a slot: a set's piece that a recipe makes
  const version = gd.core.manifest.dataVersion;
  const recipes = checkRecipes(JSON.parse(readFileSync(join(dataDir(), RECIPES_FOLDER, `${version}.json`), 'utf-8')))!;
  let target: { ring: string; text: string } | undefined;
  build.picks.forEach((p, i) =>
    p?.slots.forEach((s, j) => {
      const lines = s.enh ? itemSearch(gd, recipes, { boost: s.enh.boost, level: s.enh.ioLevel ?? null }) : [];
      // with salvage after its name: a crafted piece
      if (!target && lines.length === 1 && lines[0]!.includes(', ')) target = { ring: `ring:pick:${i}:${j}`, text: lines[0]! };
    }),
  );
  expect(target).toBeDefined();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => navigator.clipboard.writeText('untouched'));
  await me.id(target!.ring).hover();
  // the recipes are asked for as the slot is pointed at; keys pressed before they are in copy when they arrive
  await page.keyboard.press('Control+C');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(target!.text);
  // off every slot, the keys are the browser's again
  await page.evaluate(() => navigator.clipboard.writeText('untouched'));
  await page.mouse.move(5, 5);
  await page.keyboard.press('Control+C');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('untouched');
});
