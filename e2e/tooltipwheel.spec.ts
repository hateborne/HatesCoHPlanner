/**
 * A tall Advanced tooltip on the desktop (Hail of Bullets, with Dual Pistols' ammo lines) is cut to
 * the stage and scrolls with the mouse wheel and Page Up / Page Down; a wheel gesture stays on it to
 * its end, and after a rest the wheel goes to the screen under it again (routeWheel in
 * src/ui/floating.ts). Phones have no hover tooltips: their long-press tooltip scrolls by touch.
 */
import { expect, test, type Page } from '@playwright/test';
import { WHEEL_LATCH_MS } from '../src/ui/floating.ts';
import { gd, Player } from './player.ts';

/** @return The tooltip box's scroll position and sizes. */
const box = (page: Page) =>
  page
    .locator('.scroll-y')
    .filter({ hasText: 'Only using Incendiary Ammo' })
    .evaluate((el) => ({ top: el.scrollTop, shown: el.clientHeight, full: el.scrollHeight }));

test('a tall power tooltip scrolls with the wheel, then lets the screen have it', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'phones have no hover tooltips');
  const me = new Player(page, false);
  const at = gd.archetypeByName.get('class_sentinel')!;
  const primary = gd.setsInCategory(at.cats.pri).find((s) => s.n === 'Sentinel_Ranged.Dual_Pistols')!;
  const secondary = gd.setsInCategory(at.cats.sec)[0]!;
  const hob = gd.powerByName.get('sentinel_ranged.dual_pistols.hail_of_bullets')!;
  await page.goto('./Homecoming/');

  // New Build: a Sentinel with Dual Pistols, then Choose a New Power at level 1
  await me.press(me.id(`origin:${gd.core.origins[0]!.id}`));
  await me.press(me.id('align:Hero'));
  await me.press(me.id('buildtype:leveling'));
  await me.press(me.id(`at:${at.id}`));
  await me.press(me.id(`set:${primary.id}`));
  await me.press(me.id(`set:${secondary.id}`));
  await page.getByPlaceholder('Build name').fill('Tooltip wheel');
  await me.press(me.button('Finish'));
  const startNew = me.button('Start new');
  if (await me.present(startNew, 1000)) await me.press(startNew);
  const bar = me.id(`power:${hob.id}`);
  await expect(bar).toBeVisible();

  // Advanced tooltips
  const tips = page.getByRole('button', { name: /^Tooltips:/ });
  for (let i = 0; i < 3 && !(await tips.textContent())?.includes('Advanced'); i++) await tips.click();
  await expect(tips).toContainText('Advanced');

  // whether the wheel turns reach the screen (a later listener sees the box's preventDefault)
  await page.evaluate(() => {
    const w = window as unknown as { wheelTaken: boolean[] };
    w.wheelTaken = [];
    window.addEventListener('wheel', (e) => w.wheelTaken.push(e.defaultPrevented), { passive: true });
  });
  const taken = () => page.evaluate(() => (window as unknown as { wheelTaken: boolean[] }).wheelTaken.splice(0));

  await bar.hover();
  const first = await box(page);
  expect(first.full).toBeGreaterThan(first.shown + 1); // cut short
  expect(first.top).toBe(0);

  // one gesture down: the box scrolls to its end and keeps the whole gesture
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 200);
  const end = await box(page);
  expect(end.top + end.shown).toBeGreaterThanOrEqual(end.full - 1);
  expect(await taken()).toEqual(Array(30).fill(true));

  // after a rest, a turn down past the end goes to the screen
  await page.waitForTimeout(WHEEL_LATCH_MS + 150);
  await page.mouse.wheel(0, 200);
  expect(await taken()).toEqual([false]);

  // Page Up scrolls the box back; at its top Page Up is left alone
  await page.waitForTimeout(WHEEL_LATCH_MS + 150);
  for (let i = 0; i < 4; i++) await page.keyboard.press('PageUp');
  expect((await box(page)).top).toBe(0);
  await page.keyboard.press('PageDown');
  expect((await box(page)).top).toBeGreaterThan(0);
});
