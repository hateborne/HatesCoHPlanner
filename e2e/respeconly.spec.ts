/**
 * New Build plans Arachnos Soldiers and Widows as Respec builds only, on the desktop and the phone
 * layout: picking one while Leveling is ticked shows Respec and says why, Leveling is greyed for
 * it, another archetype gets the player's own Build Type back, the respec level moves up to 24,
 * and Finish starts a Respec build to that level.
 */
import { expect, test } from '@playwright/test';
import type { Build } from '../src/engine/build.ts';
import { respecOnlyNote, startingSets } from '../src/engine/rules.ts';
import { gd, Player, STORAGE_KEY } from './player.ts';

test('Arachnos builds are planned as Respec builds only', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  const soldier = gd.archetypeByName.get('class_arachnos_soldier')!;
  const blaster = gd.archetypeByName.get('class_blaster')!;
  const note = respecOnlyNote(gd, soldier)!;
  const tab = async (t: string) => {
    if (me.phone) await me.press(me.id(`tab:${t}`));
  };
  const level = page.locator('#respec-level');
  const ok = me.button('OK');
  await page.goto('./Homecoming/'); // the site root asks for a server once there is more than one

  // Leveling ticked, then the Soldier: Respec, and the note says why
  await tab('Origin');
  await me.press(me.id('buildtype:leveling'));
  await expect(level).toHaveCount(0);
  await tab('Archetype');
  await me.press(me.id(`at:${soldier.id}`));
  await expect(page.getByText(note.text).first()).toBeVisible();
  await me.press(ok);
  await expect(ok).toHaveCount(0);
  await tab('Origin');
  await expect(level).toHaveValue('50');
  await expect(me.id('buildtype:leveling')).toHaveAttribute('title', note.text);
  // the greyed Leveling takes no click
  await me.press(me.id('buildtype:leveling'));
  await expect(level).toHaveValue('50');

  // another archetype: Leveling again, as the player chose
  await tab('Archetype');
  await me.press(me.id(`at:${blaster.id}`));
  await tab('Origin');
  await expect(level).toHaveCount(0);

  // a Respec to 10, then the Soldier: Respec was the choice, so no note, and the level moves up to 24
  await me.press(me.id('buildtype:respec'));
  await level.fill('10');
  await level.press('Enter');
  await expect(level).toHaveValue('10');
  await tab('Archetype');
  await me.press(me.id(`at:${soldier.id}`));
  await tab('Origin');
  await expect(level).toHaveValue('24');
  await expect(ok).toHaveCount(0);

  // Finish starts a Respec build to 24
  await me.press(me.id(`origin:${gd.core.origins[0]!.id}`));
  await tab('Primary');
  await me.press(me.id(`set:${startingSets(gd, soldier.cats.pri, soldier)[0]!.id}`));
  await tab('Secondary');
  await me.press(me.id(`set:${startingSets(gd, soldier.cats.sec, soldier)[0]!.id}`));
  await page.getByPlaceholder('Build name').fill('Respec only');
  await me.press(me.button('Finish'));
  // the respec's first power screen, with its counter
  await expect(page.getByText(/Powers Remaining: \d+/).first()).toBeVisible();
  await expect.poll(async () => {
    const b = JSON.parse((await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)) ?? 'null') as Build | null;
    return b && { at: b.at, respecTo: b.respecTo };
  }).toEqual({ at: soldier.id, respecTo: 23 });
});
