/**
 * The set finder, the way a player uses it, on the desktop and the phone layout: a forum build is
 * imported, the finder is opened from the overview (the phone's menu), a search is run for one
 * priority, the first swap is looked at and kept, the shopping list shows what it needs, the
 * changed build opens in a new tab, and the swap is applied to this build. The pieces the row
 * named must be the ones the build then holds, at the levels and in the slots it named. On the
 * phone a long press stands in for hover text: on the row it names the pieces, on a tick box and
 * on the shopping list's bar and rings it shows their hint, and it never also does what a tap
 * does. The shopping list stays in the browser until it is cleared.
 *
 * A pane whose code can't be downloaded closes with a notice, and opens on the next try; while
 * the code is on its way a line says so, and Escape gives the wait up (a failure after that says
 * nothing). A Thunderspy build gets no finder: no button on its overview and no row in its phone
 * menu.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { setPick } from '../src/engine/actions.ts';
import { newBuild, type Build } from '../src/engine/build.ts';
import { BuildRules, startingSets } from '../src/engine/rules.ts';
import { encodeShare } from '../src/io/share.ts';
import { loadData } from '../tests/helpers/data.ts';
import { gd, Player, POWER_TABS, setOf, STORAGE_KEY } from './player.ts';

// a level 50 build on the default game version, full of enhancements (tests/fixtures/builds/README.md)
const FILE = 'symphony-dark-dominator.txt';
// the phone menu's row for the finder, by its hover text
const MENU_ROW_TITLE = 'Rank the sets this build could slot';

/** What a result row's id says the swap does (swapId in src/state/finder.ts). */
interface RowSwap {
  key: string; // the power's entry in the build
  set: number; // the set's id
  pieces: RowPiece[]; // the enhancement each slot gets
}

/** One piece of a swap: where it goes and what it is. */
interface RowPiece {
  slot: number; // the slot's index in the power
  boost: number; // the enhancement's id
  level: number | null; // its level (0-based) when it is crafted; null for an attuned or fixed piece
}

/** @return The swap a result row's data-testid names. */
function rowSwap(testId: string): RowSwap {
  const [key, set, pieces] = testId.replace(/^finder:swap:/, '').split('|');
  return {
    key: key!,
    set: Number(set),
    pieces: pieces!.split(',').map((p) => {
      const [slot, boost, level] = p.split(':');
      return { slot: Number(slot), boost: Number(boost), level: level ? Number(level) : null };
    }),
  };
}

/** @return The enhancement and level each of the swap's slots holds in a build (null: empty, or no such power). */
function held(b: Build, swap: RowSwap): ([number, number | null] | null)[] {
  const entry = new BuildRules(gd, b).entries().find((e) => String(e.key) === swap.key);
  return swap.pieces.map((p) => {
    const enh = entry?.slots[p.slot]?.enh;
    return enh ? [enh.boost, enh.ioLevel ?? null] : null;
  });
}

/** @return What the swap's slots hold once it is in: each piece and its level. */
function placed(swap: RowSwap): [number, number | null][] {
  return swap.pieces.map((p) => [p.boost, p.level]);
}

/**
 * Phone: rest a finger on an element for longer than the planner's long press (src/ui/press.ts),
 * then lift it.
 *
 * The touch goes through the browser's own touch input, so whatever the browser makes of the
 * release (a click, a context menu) reaches the page as it would from a finger.
 *
 * @param l The element; its middle is touched.
 * @param slide How far down (px) the finger slides right after touching. Past the planner's 10 px
 *   it is a scroll, not a long press.
 */
async function hold(l: Locator, slide = 0): Promise<void> {
  const page = l.page();
  await l.scrollIntoViewIfNeeded();
  const box = (await l.boundingBox())!;
  const at = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
  if (slide) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x, y: at.y + slide }] });
  await page.waitForTimeout(700);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touch.detach();
  // after a long press the planner swallows the next click for a moment (the one a release can make): let that pass
  await page.waitForTimeout(500);
}

/** @return The build a tab holds, as the planner saved it. */
async function buildOf(page: Page): Promise<Build> {
  const raw = await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY);
  if (!raw) throw new Error('the planner has no build in this tab');
  return JSON.parse(raw) as Build;
}

/** Open the finder: its button on the desktop overview, its row in the phone's menu. */
async function openFinder(me: Player): Promise<void> {
  if (me.phone) {
    await me.press(me.button('Menu'));
    await me.press(me.page.getByTitle(MENU_ROW_TITLE));
  } else await me.press(me.id('finder:open'));
  // the statistics have loaded and the form is up
  await expect(me.id('finder:goal:0')).toBeVisible();
}

test('a set is found, kept, listed for shopping and applied', async ({ page, context }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  /** Open one of the phone pane's tabs (the desktop shows every part at once). */
  const tab = async (label: string) => {
    if (me.phone) await me.press(me.id(`tab:${label}`));
  };
  // what the page's Content-Security-Policy refused, in this tab and the one "Open as new build"
  // opens (only a built site has a policy: npm run e2e:built)
  const blocked: string[] = [];
  context.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) blocked.push(m.text());
  });
  // phone: the tooltip a long press opens, and a tap on it to close it
  const tip = page.getByRole('tooltip');
  const closeTip = async () => {
    await me.press(tip);
    await expect(tip).toHaveCount(0);
  };
  await page.goto('./Homecoming/'); // the site root asks for a server once there is more than one
  const before = await me.importBuild(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', FILE), 'utf-8'));
  expect(before.dataVersion).toBe(gd.core.manifest.dataVersion);

  // Search is off until a priority is picked, and says why
  await openFinder(me);
  const search = me.id('finder:search');
  await expect(search).toBeDisabled();
  await expect(me.id('finder:invalid')).toBeVisible();
  // a phone has no hover text: a long press on a tick box shows its hint, and ticks nothing
  if (me.phone) {
    const attuned = me.id('finder:attuned');
    await expect(attuned).not.toBeChecked();
    await hold(page.locator('label', { has: attuned }));
    await expect(tip).toContainText('Place attuned pieces');
    await closeTip();
    await expect(attuned).not.toBeChecked();
  }
  await me.id('finder:goal:0').selectOption('recharge');
  await me.id('finder:importance:0').selectOption('high');
  await expect(me.id('finder:invalid')).toHaveCount(0);
  await expect(search).toBeEnabled();
  await me.press(search); // a phone moves to its Results tab

  // the first result: its gains and losses show, then it is kept
  const first = page.locator('[data-testid^="finder:swap:"]').first();
  await expect(first).toBeVisible({ timeout: 120_000 });
  const rowId = (await first.getAttribute('data-testid'))!;
  const swap = rowSwap(rowId);
  const set = gd.boostSetById.get(swap.set)!;
  expect(set).toBeDefined();
  // every piece is one of the set's, for a slot the power has (one piece can do: a unique piece, or one more of a set the power holds)
  const slots = new BuildRules(gd, before).entries().find((e) => String(e.key) === swap.key)!.slots;
  for (const p of swap.pieces) {
    expect(gd.boostSetOf.get(p.boost)?.set.id).toBe(swap.set);
    expect(slots[p.slot]).toBeDefined();
  }
  // a long press on the row names the pieces, and does not also select the row as a tap would
  if (me.phone) {
    const name = first.getByText(set.dn, { exact: true });
    const keepSelected = me.id('finder:keepselected'); // off until a row is selected
    await expect(keepSelected).toBeDisabled();
    // a finger that slides is scrolling: no tooltip
    await hold(name, /*slide=*/ 30);
    await expect(tip).toHaveCount(0);
    await hold(name);
    for (const p of swap.pieces) await expect(tip).toContainText(gd.power(p.boost).dn);
    await closeTip();
    await expect(keepSelected).toBeDisabled();
  }
  await me.press(first);
  await expect(me.id('finder:gains')).toBeVisible();
  await expect(me.id('finder:losses')).toBeVisible();
  await me.press(me.id(rowId.replace('finder:swap:', 'finder:keep:')));
  await expect(me.id('finder:kept').getByTestId(rowId)).toBeVisible();
  // the box went to the Kept list with its row: the keyboard's place goes with it
  if (!me.phone) await expect(me.id('finder:kept').getByTestId(rowId.replace('finder:swap:', 'finder:keep:'))).toBeFocused();
  // the list is ranked again around the kept swap: wait it out
  await tab('Search');
  await expect(search).toBeEnabled({ timeout: 120_000 });

  // the shopping list: the set with its pieces, what they need, and on the desktop the auction house lines
  if (me.phone) await tab('List');
  else await me.press(me.id('finder:shopping'));
  await expect(me.id(`shop:set:${swap.set}`)).toBeVisible();
  // the recipes loaded: a crafted piece is listed by its recipe and salvage, any other as an enhancement to buy
  const wasHeld = held(before, swap);
  const fresh = swap.pieces.filter((p, i) => wasHeld[i]?.[0] !== p.boost);
  expect(fresh.length).toBeGreaterThan(0);
  if (fresh.some((p) => p.level !== null)) {
    await expect(me.id('shop:recipes')).toBeVisible({ timeout: 30_000 });
    await expect(me.id('shop:salvage')).toBeVisible();
  }
  if (fresh.some((p) => p.level === null)) await expect(me.id('shop:buy')).toBeVisible({ timeout: 30_000 });
  await expect(me.id('shop:norecipes')).toHaveCount(0);
  await expect(me.id('shop:lines')).toHaveCount(me.phone ? 0 : 1);
  // the whole set is marked owned by its bar: nothing is left to get; a click on a piece takes it back.
  // On a phone a long press on either says what a tap would do, and marks nothing.
  const bar = me.id(`shop:bar:${swap.set}`);
  const piece = me.id('shop:piece:0');
  if (me.phone) {
    await hold(bar);
    await expect(tip).toContainText('Tap to mark every piece as owned');
    await closeTip();
    await expect(me.id('shop:done')).toHaveCount(0);
  }
  await me.press(bar);
  await expect(me.id('shop:done')).toBeVisible();
  if (me.phone) {
    await hold(piece);
    await expect(tip).toContainText('tap to mark it as still needed');
    await closeTip();
    await expect(me.id('shop:done')).toBeVisible();
  }
  await me.press(piece);
  await expect(me.id('shop:done')).toHaveCount(0);
  if (!me.phone) await me.press(me.id('shop:back'));

  // "Open as new build": a share link to this site, opening the changed build in a new tab
  await tab('Kept (1)');
  const link = me.id('finder:newbuild');
  // this site's own address for Homecoming, and nothing else before the code
  await expect(link).toHaveAttribute('href', /#b=/);
  const href = new URL((await link.getAttribute('href'))!);
  expect(href.origin).toBe(new URL(page.url()).origin);
  expect(href.pathname).toBe('/HatesCoHPlanner/Homecoming/');
  expect(href.search).toBe('');
  expect(href.hash).toMatch(/^#b=[\w-]+$/);
  const opening = context.waitForEvent('page');
  await me.press(link);
  const other = await opening;
  await expect(other.getByRole('button', { name: 'New Build', exact: true })).toBeVisible({ timeout: 60_000 });
  expect(held(await buildOf(other), swap)).toEqual(placed(swap));
  await other.close();
  // this tab's build is as it was
  expect(held(await me.build(), swap)).toEqual(held(before, swap));

  // "Apply to this build" asks first, then the build holds the pieces and the pane is gone
  await me.press(me.id('finder:apply'));
  await expect(page.getByText('Apply the kept swaps').last()).toBeVisible(); // game text is drawn twice (its outline)
  // the question's own button (a phone's pane has an Apply button of its own under it)
  await me.press(page.getByRole('button', { name: 'Apply', exact: true }).and(page.locator(':not([data-testid="finder:apply"])')));
  await expect(me.id('finder:goal:0')).toHaveCount(0);
  await expect.poll(async () => held(await me.build(), swap)).toEqual(placed(swap));
  const after = await me.build();
  expect(new BuildRules(gd, after).issues()).toEqual(new BuildRules(gd, before).issues());

  // the list outlives the pane and the applied swap, until it is cleared
  await openFinder(me);
  if (me.phone) await tab('List');
  else await me.press(me.id('finder:shopping'));
  await expect(me.id(`shop:set:${swap.set}`)).toBeVisible();
  await me.press(me.id('shop:clear'));
  await expect(page.getByText('Clear the shopping list').last()).toBeVisible();
  await me.press(me.button('Clear'));
  await expect(me.id('shop:empty')).toBeVisible();

  // Escape closes the pane (from the desktop's list it goes back to the search first)
  await page.keyboard.press('Escape');
  if (!me.phone) {
    await expect(me.id('finder:goal:0')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await expect(me.id('finder:close')).toHaveCount(0);
  expect(blocked).toEqual([]);
});

test('a set finder that cannot be downloaded says so, and opens on the next try', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  const tip = page.getByRole('tooltip');
  await page.goto('./Homecoming/');
  const b = await me.importBuild(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', FILE), 'utf-8'));
  // the pane's code is held back, then refused
  let refuse!: () => void;
  const held = new Promise<void>((done) => (refuse = done));
  await page.route(/SetFinder/, async (route) => {
    await held;
    await route.abort();
  });
  if (me.phone) {
    await me.press(me.button('Menu'));
    await me.press(page.getByTitle(MENU_ROW_TITLE));
    // while it downloads the overview is still the screen in view: a long press on a power shows its tooltip
    const power = new BuildRules(gd, b).entries().find((e) => setOf(gd, e.power).id === b.primary)!;
    await hold(await me.reveal(`bar:${power.key}`, POWER_TABS));
    await expect(tip).toContainText(power.power.dn);
    await me.press(tip);
    await expect(tip).toHaveCount(0);
  } else await me.press(me.id('finder:open'));
  // the wait is said on screen (it takes no clicks: the long press above went through it)
  await expect(me.id('finder:wait')).toBeVisible();
  refuse();
  await expect(me.id('finder:wait')).toHaveCount(0);
  // the notice (the desktop also holds an unseen copy of it, to measure it)
  await expect(page.getByText("The set finder couldn't load").last()).toBeVisible();
  await expect(me.id('finder:close')).toHaveCount(0);
  await expect(tip).toHaveCount(0);
  // the next opening asks for the code again
  await page.unroute(/SetFinder/);
  await openFinder(me);
});

test('the wait for the set finder can be given up, and a failure after that says nothing', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await page.goto('./Homecoming/');
  await me.importBuild(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', FILE), 'utf-8'));
  let refuse!: () => void;
  const held = new Promise<void>((done) => (refuse = done));
  let refused!: () => void;
  const over = new Promise<void>((done) => (refused = done));
  await page.route(/SetFinder/, async (route) => {
    await held;
    await route.abort();
    refused();
  });
  if (me.phone) {
    await me.press(me.button('Menu'));
    await me.press(page.getByTitle(MENU_ROW_TITLE));
  } else await me.press(me.id('finder:open'));
  await expect(me.id('finder:wait')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(me.id('finder:wait')).toHaveCount(0);
  // the download fails once nobody waits for it: no notice
  refuse();
  await over;
  await page.waitForTimeout(500);
  await expect(page.getByText("The set finder couldn't load")).toHaveCount(0);
  // and the next opening works
  await page.unroute(/SetFinder/);
  await openFinder(me);
});

test('a Thunderspy build gets no set finder', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  const ts = loadData(undefined, 'thunderspy');
  const at = ts.archetypeByName.get('class_blaster')!;
  const primary = startingSets(ts, at.cats.pri, at)[0]!;
  const secondary = startingSets(ts, at.cats.sec, at)[0]!;
  /** @return A power of the set a level 1 character can pick. */
  const firstOf = (set: typeof primary) => set.p[set.av.findIndex((level) => level === 0)]!;
  // a level 1 character, planned no further: its link opens on the overview
  let b = newBuild({
    server: 'thunderspy',
    dataVersion: ts.core.manifest.dataVersion,
    name: 'No finder here',
    at: at.id,
    origin: ts.core.origins[0]!.id,
    alignment: 'Hero',
    primary: primary.id,
    secondary: secondary.id,
    pickCount: 24,
  });
  b = setPick(ts, b, 0, firstOf(primary));
  b = setPick(ts, b, 1, firstOf(secondary));
  b = { ...b, endLevel: 0 };
  await page.goto(`./Thunderspy/#b=${await encodeShare(b)}`);
  // the build's overview
  await expect(me.button('New Build')).toBeVisible({ timeout: 60_000 });
  expect((await me.build()).server).toBe('thunderspy');
  if (me.phone) {
    await me.press(me.button('Menu'));
    await expect(page.getByText(/^Sound: /)).toBeVisible(); // the menu is open
    await expect(page.getByTitle(MENU_ROW_TITLE)).toHaveCount(0);
  } else await expect(me.id('finder:open')).toHaveCount(0);
});
