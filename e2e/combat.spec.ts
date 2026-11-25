/**
 * The totals' Out of Combat switch on the desktop and the phone layout: off when a build opens, on
 * it the totals count what a fight stops (a travel power's speed), and it is part of neither the
 * link nor the saved build, so a reload or a shared link opens with it off again.
 */
import { expect, test } from '@playwright/test';
import { Player, STORAGE_KEY } from './player.ts';

// a Homecoming Blaster with Flares, Targeting Drone, Field Operative, Stealth, Afterburner and Super Speed
const LINK = './Homecoming/#b=eJxjZGRk4BZlYJD4bMPAwNAAIu6qMDIwHFdhZmDoU2FlYDisws7A8M-akwEbYM00sigwYQAASRcIeg';

test('the Out of Combat switch: off on every visit, never in the link or the saved build', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  // the overview: the switch on the desktop, the Totals tab on a phone
  const opened = () => expect(me.id('totals:outofcombat').or(me.id('tab:Totals')).first()).toBeAttached({ timeout: 15000 });
  await page.goto(LINK);
  await opened();
  const sw = await me.reveal('totals:outofcombat', ['Totals']);
  await expect(sw).not.toBeChecked();

  // the totals panel's text (Base, open by default), which holds the stealth Stealth adds only out of combat
  const panel = page.locator('.body-text').filter({ hasText: 'Max HP' }).first();
  const inCombat = await panel.innerText();
  const url = page.url();
  const saved = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);

  await me.press(sw);
  await expect(sw).toBeChecked();
  await expect.poll(() => panel.innerText()).not.toBe(inCombat);
  expect(page.url()).toBe(url);
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe(saved);

  await page.reload();
  await opened();
  const again = await me.reveal('totals:outofcombat', ['Totals']);
  await expect(again).not.toBeChecked();
  await expect.poll(() => page.locator('.body-text').filter({ hasText: 'Max HP' }).first().innerText()).toBe(inCombat);
});
