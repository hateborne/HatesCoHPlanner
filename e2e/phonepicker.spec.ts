/**
 * The phone layout's long presses and the enhancement picker's phone extras, on a forum build:
 * a power's long-press info with its slotted bonuses; the picker's categories in one
 * row that scrolls sideways; a long press on a set's name (its bonuses, in a box that closes
 * without closing the picker); a long press on a piece (ticks Select several).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import { LONG_MS } from '../src/ui/press.ts';
import { Player } from './player.ts';

const FILE = 'symphony-dark-dominator.txt';

// how long the planner swallows clicks after a long press lifts (press.ts: the click the release makes)
const SWALLOW_MS = 400;

/**
 * Hold a finger on an element for longer than a long press takes, then lift it, and wait until
 * the planner takes taps again.
 */
async function longPress(l: Locator): Promise<void> {
  await l.scrollIntoViewIfNeeded();
  await l.evaluate(async (el, ms) => {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, pointerType: 'touch', pointerId: 7, isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', at));
    await new Promise((done) => setTimeout(done, ms));
    el.dispatchEvent(new PointerEvent('pointerup', at));
  }, LONG_MS + 150);
  await l.page().waitForTimeout(SWALLOW_MS + 100);
}

test('phone: slotted bonuses, the scrolling categories and the long presses in the picker', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'the phone layout only');
  const me = new Player(page, true);
  await page.goto('./Homecoming/');
  await me.importBuild(readFileSync(join('tests', 'fixtures', 'builds', FILE), 'utf-8'));
  const tip = page.getByRole('tooltip');

  // a slotted power's info: the detailed numbers, with a bonus beside those its enhancements change;
  // a power with two slots at least, for the picker below
  const second = page.locator('[data-testid^="ring:pick:"][data-testid$=":1"]').first();
  const key = (await second.getAttribute('data-testid'))!.split(':').slice(1, 3).join(':');
  const ring = me.id(`ring:${key}:0`);
  await longPress(me.id(`bar:${key}`));
  await expect(tip).toContainText('Power Type:');
  await expect(me.id('tip:bonus').first()).toHaveText(/^\d+\.\d\d%$/);
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);

  // the picker: every category can be reached in the one row
  await ring.tap();
  const strip = me.id('tabstrip');
  await expect(strip).toBeVisible();
  const tabs = strip.locator('[data-testid^="tab:"]');
  await tabs.last().tap();
  await expect(tabs.last()).toBeInViewport();
  await me.press(me.id('tab:Sets'));
  await expect(me.id('picker:sets')).toBeVisible();

  // a set's name: its bonuses, closed again without closing the picker
  const set = page.locator('[data-testid^="pickerset:"]').first();
  await longPress(set);
  await expect(tip).toContainText('Set Bonus:');
  await expect(tip.locator('[data-bonus]').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tip).toHaveCount(0);
  await expect(me.id('picker:place')).toBeVisible();
  await me.press(me.id('picker:cancel'));

  // two empty slots, so there is room for several pieces
  for (const r of [ring, second]) {
    await r.tap();
    await me.press(me.id('picker:remove'));
    await expect(me.id('picker:place')).toHaveCount(0);
  }

  // a piece: a long press ticks Select several with the piece in, and a tap then adds another
  await ring.tap();
  await me.press(me.id('tab:Sets'));
  await set.tap();
  await expect(me.id('picker:several')).not.toBeChecked();
  const pieces = page.locator('[data-testid^="boost:"]');
  await longPress(pieces.first());
  await expect(me.id('picker:several')).toBeChecked();
  await expect(me.id('picker:place')).toBeEnabled();
  await pieces.nth(1).tap();
  await expect(page.locator('[data-testid^="picker:piece:"]')).toHaveCount(2);

  // the set's bonuses now count both chosen pieces: its two-piece bonus is newly earned
  await longPress(set);
  await expect(tip.locator('[data-bonus="new"]').first()).toBeVisible();
});
