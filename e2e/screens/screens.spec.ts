/**
 * The screenshot check: the planner's screens, on the desktop and the phone layout, compared pixel
 * for pixel with pictures taken before a change. It is the net under changes that must not move
 * anything on screen (a refactor of the screens), where the other tests look at builds and numbers.
 *
 * The pictures are taken on main (--update-snapshots) and compared on the branch, on the same
 * machine: they are kept in .screens/, which git ignores, and mean nothing on another machine
 * (fonts and the browser draw a little differently there). `npm run e2e` never runs this spec
 * (e2e/screens.config.ts), and screens/taken.ts keeps the pictures honest.
 *
 * What it walks:
 * - the server list;
 * - with a villain, a hero and a Praetorian build (each skin): the overview (every tab on a phone),
 *   a power's tooltip (desktop), the enhancement picker, the phone's menu and level log, the set
 *   finder, a power reopened from the overview, and a level's slot screen reopened from the
 *   overview, with the totals pane at its side and its info box (desktop);
 * - with the villain build: New Build (every tab on a phone), its "start a new build?" question,
 *   the saved builds and import menu, the Support box, the set finder with a swap kept and its
 *   shopping list, the first power and slot screens of a leveling build, and the first power and the
 *   slot screens of a respec;
 * - in a respec of the villain build: Choose a Pool Power Set and Choose an Epic Power Set (with the
 *   patron pools), at the first pick that offers each, before and after a set is chosen;
 * - with a Mastermind: the totals' Pets and Minions and a pet's pane;
 * - with a Thunderspy build: the overview, the enhancement picker and a power reopened.
 *
 * A screen that scrolls is pictured a screenful at a time, to its end.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { serverById } from '../../src/data/servers.ts';
import { skinOf } from '../../src/engine/build.ts';
import { levelSteps, respecSteps } from '../../src/engine/schedule.ts';
import { loadVersionIndex } from '../../tests/helpers/data.ts';
import { gd, Player, POWER_TABS, RESPEC_TO } from '../player.ts';

// the overview's fourth tab on a phone, beside the power tabs
const TOTALS_TAB = 'Totals';
// New Build's tabs on a phone
const SETUP_TABS = ['Origin', 'Archetype', 'Primary', 'Secondary'];
// how much larger the window is made, for a moment, to have the page drawn again
const REDRAW_PX = 40;
// how long a picture that differed waits before its second look
const SECOND_LOOK_MS = 1000;
// the most screenfuls one scrolling screen is pictured in: more than this is a walk gone wrong
const MAX_PARTS = 40;
// what a power's tooltip says, on the overview or on a slot screen: its picture waits for it
const TOOLTIP_TEXT = /Hold SHIFT for the advanced tooltip\.|Allowed Enhancements:/;
// the set finder's priority the kept swap is searched with
const FINDER_GOAL = 'recharge';
// how long the set finder may search, and a version's pets file may take to arrive
const SLOW_MS = 60_000;

// one build per skin, from the golden numbers' builds: the screens are drawn in the build's skin
const SKINS = [
  { skin: 'villain', build: 'forum/symphony-dark-dominator' },
  { skin: 'hero', build: 'forum/archery-bio-sentinel' },
  { skin: 'praetorian', build: 'link/praetorian-corruptor' },
] as const;
// the build most walks use
const VILLAIN = SKINS[0].build;
// a build whose powers make pets
const PETS = 'archetype/Class_Mastermind';
// a Thunderspy build
const THUNDERSPY = 'archetype/Class_Tanker';

/**
 * The link that opens one of the golden numbers' builds (tests/fixtures/golden/).
 *
 * @param name The build's name there.
 * @param server The server whose builds are read (its default game version's).
 * @return The link, from the site's root.
 */
function link(name: string, server = 'homecoming'): string {
  const version = loadVersionIndex(server).default;
  const file = join('tests', 'fixtures', 'golden', server, version, 'builds.json');
  const builds = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as Record<string, string>) : {};
  const code = builds[name];
  if (!code) throw new Error(`The screenshot check opens the build "${name}" of ${file}, which is not there: write the golden numbers for ${version}, or name another build in e2e/screens/screens.spec.ts.`);
  return `./${serverById(server)!.path}/#b=${code}`;
}

// how many times each walk's page has loaded: every walk opens one address, once
const loads = new WeakMap<Page, number>();
test.beforeEach(({ page }) => {
  loads.set(page, 0);
  page.on('load', () => loads.set(page, (loads.get(page) ?? 0) + 1));
});

/**
 * Wait until the page has what it asked for and has drawn it.
 *
 * @param page The page.
 * @throws When the page has loaded a second time: the dev server reloads it when a file of the
 *   checkout changes, the planner then opens on the build's overview, and the pictures after that
 *   would be of the wrong screen (taking the pictures, nothing else would notice).
 */
async function settle(page: Page): Promise<void> {
  if ((loads.get(page) ?? 0) > 1) throw new Error('The page loaded again in the middle of a walk (did a file of the checkout change while it ran?). Run it again.');
  // everything the page asked for has arrived (a version's optional files change a tooltip when they do)
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(scrolledOut);
  await redraw(page);
}

/**
 * In the page: wait until nothing is scrolling any more. A phone's row of tabs glides to the tab
 * just pressed, and a picture (or the redraw, which stops a glide where it is) must not catch it
 * on its way.
 *
 * @return A promise kept once every element has stayed where it is for a few frames (or after
 *   three seconds of frames, whatever still moves then).
 */
function scrolledOut(): Promise<void> {
  const places = () => [...document.querySelectorAll('*')].map((el) => `${el.scrollLeft}:${el.scrollTop}`).join();
  return new Promise((done) => {
    let last = places();
    let same = 0;
    let frame = 0;
    const next = () => {
      const now = places();
      same = now === last ? same + 1 : 0;
      last = now;
      frame += 1;
      if (same >= 4 || frame >= 180) done();
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  });
}

/** Wait two frames: what the page has is drawn, and a change made by the last click is on screen. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/**
 * Make the page draw itself again from nothing: its window is made a little larger and put back.
 *
 * The browser does not draw a screen the same to the last pixel every time it loads: the round
 * edges of frames and scaled pictures come out a few steps of a colour different, in a few dozen
 * pixels (16 loads of one overview gave four different pictures). Drawn again in one go, the 16
 * were the same to the last bit, so every picture is taken of a page drawn again.
 *
 * A list that was scrolled is put back where it was: some go back to their top when the window's
 * size changes (the enhancement picker's).
 *
 * @param page The page.
 */
async function redraw(page: Page): Promise<void> {
  const size = page.viewportSize();
  if (!size) return;
  // each scrolled element's place among the page's elements, and how far it was scrolled each way
  const scrolled = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap((el, at) => (el.scrollTop > 0 || el.scrollLeft > 0 ? [[at, el.scrollLeft, el.scrollTop]] : [])));
  await page.setViewportSize({ width: size.width + REDRAW_PX, height: size.height + REDRAW_PX });
  await frames(page);
  await page.setViewportSize(size);
  await frames(page);
  if (!scrolled.length) return;
  await page.evaluate((places) => {
    const all = document.querySelectorAll('*');
    for (const [at, left, top] of places) {
      const el = all[at!];
      if (!el) continue;
      el.scrollLeft = left!;
      el.scrollTop = top!;
    }
  }, scrolled);
  await frames(page);
}

/**
 * In the page: move everything that scrolls, and is not covered, a screenful on.
 *
 * @return Whether anything moved (false once every list is at its end).
 */
function scrollOn(): boolean {
  let moved = false;
  for (const el of document.querySelectorAll<HTMLElement>('*')) {
    const room = el.scrollHeight - el.clientHeight;
    if (room <= 1 || el.clientHeight === 0) continue;
    const flow = getComputedStyle(el).overflowY;
    if (flow !== 'auto' && flow !== 'scroll' && el !== document.scrollingElement) continue;
    // not a list under a pop-up: what is on top at its middle is its own
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!top || !el.contains(top)) continue;
    const from = el.scrollTop;
    el.scrollTop = Math.min(room, from + el.clientHeight);
    if (el.scrollTop === from) continue;
    // where it was, for scrollBack
    el.dataset.screensTop ??= String(from);
    moved = true;
  }
  return moved;
}

/** In the page: put everything scrollOn moved back where it was. */
function scrollBack(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-screens-top]')) {
    el.scrollTop = Number(el.dataset.screensTop);
    delete el.dataset.screensTop;
  }
}

/**
 * Hold the page as it stands to a picture on record.
 *
 * A picture that differs is looked at once more after a pause, and only that second look counts:
 * once in some hundreds of pictures the browser was caught before a screen was fully drawn, where
 * a change to the screens differs both times. The second look is soft: a picture that differs
 * fails the walk at its end, so one run shows every picture that does.
 *
 * @param page The page.
 * @param file The picture's file name.
 */
async function hold(page: Page, file: string): Promise<void> {
  try {
    await expect(page).toHaveScreenshot(file);
    return;
  } catch {
    // looked at again below
  }
  await page.waitForTimeout(SECOND_LOOK_MS);
  await settle(page);
  await expect.soft(page).toHaveScreenshot(file);
}

/**
 * Take the picture of the page as it stands and hold it to the one on record, then the same for
 * each further screenful of whatever scrolls on it (`name-part2`, `name-part3`, ...).
 *
 * @param page The page.
 * @param name The picture's name.
 * @param hovering Whether the pointer stays where it is, for a picture of what it hovers
 *   (default: it is put in the corner first, so no bar glows under a pointer left by the last click).
 *   Such a picture is of the page as it stands only: scrolling would end the hover.
 */
async function shot(page: Page, name: string, hovering = false): Promise<void> {
  if (!hovering) await page.mouse.move(1, 1);
  await settle(page);
  await hold(page, `${name}.png`);
  if (hovering) return;
  let part = 1;
  while (await page.evaluate(scrollOn)) {
    part += 1;
    if (part > MAX_PARTS) throw new Error(`${name}: still scrolling after ${MAX_PARTS} screenfuls`);
    await settle(page);
    await hold(page, `${name}-part${part}.png`);
  }
  if (part === 1) return;
  await page.evaluate(scrollBack);
  await settle(page);
}

/**
 * Take a picture of each of a screen's tabs on a phone, or one of the whole screen on the desktop.
 *
 * @param me The driver.
 * @param name The screen's name.
 * @param tabs Its phone tabs.
 */
async function shotEach(me: Player, name: string, tabs: readonly string[]): Promise<void> {
  if (!me.phone) return shot(me.page, name);
  for (const tab of tabs) {
    await me.press(me.id(`tab:${tab}`));
    await shot(me.page, `${name}-${tab.toLowerCase()}`);
  }
}

/**
 * Open a link's build and wait for its overview.
 *
 * @param me The driver.
 * @param to The link.
 */
async function openBuild(me: Player, to: string): Promise<void> {
  await me.page.goto(to);
  await expect(me.button('New Build')).toBeVisible();
  await expect(me.page.locator('[data-testid^="bar:"]').first()).toBeVisible();
}

/**
 * Open the set finder from the overview: its button on the desktop, the menu's row on a phone.
 *
 * @param me The driver.
 */
async function openFinder(me: Player): Promise<void> {
  if (me.phone) {
    await me.press(me.page.getByLabel('Menu', { exact: true }));
    await me.press(me.page.getByText('Set Finder', { exact: true }).last());
  } else {
    await me.press(me.id('finder:open'));
  }
  await expect(me.id('finder:group')).toBeVisible();
}

test('the server list', async ({ page }) => {
  await page.goto('./'); // the site's root asks which server, once there is more than one
  await expect(page.getByRole('dialog', { name: 'Choose a server' })).toBeVisible();
  await shot(page, 'server-list');
});

for (const { skin, build } of SKINS) {
  test(`${skin}: the overview and what opens from it`, async ({ page }, info) => {
    const me = new Player(page, info.project.name === 'phone');
    await openBuild(me, link(build));
    expect(skinOf((await me.build()).alignment)).toBe(skin);
    await shotEach(me, `${skin}-overview`, [...POWER_TABS, TOTALS_TAB]);
    if (me.phone) await me.press(me.id(`tab:${POWER_TABS[0]}`));

    if (!me.phone) {
      // a power's tooltip (phones have no hover)
      await page.locator('[data-testid^="bar:"]').first().hover();
      await expect(page.getByText(TOOLTIP_TEXT).first()).toBeVisible();
      await shot(page, `${skin}-overview-tooltip`, /*hovering=*/ true);
    }

    // the enhancement picker, from the first slot
    await me.press(page.locator('[data-testid^="ring:"]').first());
    await expect(me.id('picker:place')).toBeAttached();
    await shot(page, `${skin}-picker`);
    await page.keyboard.press('Escape');
    await expect(me.id('picker:place')).toHaveCount(0);

    if (me.phone) {
      // the menu
      await me.press(page.getByLabel('Menu', { exact: true }));
      await expect(page.getByText('Set Finder', { exact: true }).last()).toBeVisible();
      await shot(page, `${skin}-menu`);
      await page.keyboard.press('Escape');
    }

    // the set finder
    await openFinder(me);
    await shot(page, `${skin}-finder`);
    await page.keyboard.press('Escape');
    await expect(me.id('finder:group')).toHaveCount(0);

    // a power reopened from its bar: Choose a New Power, with the build's power chosen
    await me.press(page.locator('[data-testid^="bar:"]').first());
    await expect(me.button('Cancel')).toBeVisible();
    await shotEach(me, `${skin}-power-reopened`, POWER_TABS);
    await me.press(me.button('Cancel'));
    await expect(me.button('New Build')).toBeVisible();

    // a level's slots reopened: its orb on the desktop, its line in the level log on a phone
    if (me.phone) {
      await me.press(page.getByRole('button', { name: /^1 - \d+$/ }));
      await expect(page.getByLabel('Level 3 slots', { exact: true })).toBeVisible();
      await shot(page, `${skin}-level-log`);
      await me.press(page.getByLabel('Level 3 slots', { exact: true }));
    } else {
      await me.press(page.getByLabel('Level 3', { exact: true }));
    }
    await expect(me.button('Cancel')).toBeVisible();
    await expect(page.getByText('Slots Available', { exact: false }).first()).toBeVisible();
    await shotEach(me, `${skin}-slots-reopened`, POWER_TABS);
    // the totals pane a level-up screen keeps behind the tab at its side
    await me.press(page.getByLabel('Show totals', { exact: true }));
    await expect(me.id('totals:outofcombat')).toBeVisible();
    await shot(page, `${skin}-side-totals`);
    await me.press(page.getByLabel('Hide totals', { exact: true }));
    await expect(me.id('totals:outofcombat')).toHaveCount(0);
    if (!me.phone) {
      // the info box, filled by the power under the pointer
      await page.locator('[data-testid^="slotbar:"]').first().hover();
      await expect(page.getByText(TOOLTIP_TEXT).first()).toBeVisible();
      await shot(page, `${skin}-slots-info-box`, /*hovering=*/ true);
    }
    await me.press(me.button('Cancel'));
    await expect(me.button('New Build')).toBeVisible();
  });
}

test('New Build, its question, the saved builds menu and the Support box', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await openBuild(me, link(VILLAIN));

  // the Support box: its button in the bottom bar, its row in a phone's menu
  if (me.phone) await me.press(page.getByLabel('Menu', { exact: true }));
  await me.press(page.getByText('Support HateCoHPlanner', { exact: true }).last());
  await expect(page.getByRole('dialog', { name: 'Support HateCoHPlanner' })).toBeVisible();
  await shot(page, 'support');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Support HateCoHPlanner' })).toHaveCount(0);

  await me.press(me.button('New Build'));
  await expect(page.getByPlaceholder('Build name')).toBeVisible();
  await shotEach(me, 'new-build', SETUP_TABS);

  // Finish over a build asks before it replaces it
  await me.press(me.button('Finish'));
  await expect(me.button('Start new')).toBeVisible();
  await shot(page, 'start-new-question');
  await page.keyboard.press('Escape');
  await expect(me.button('Start new')).toHaveCount(0);

  await me.press(me.button(me.phone ? 'Saved / Import' : 'Saved builds / Import'));
  await expect(page.getByPlaceholder('Paste a share link')).toBeVisible();
  await shot(page, 'build-menu');
});

test('the set finder with a swap kept, and its shopping list', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await openBuild(me, link(VILLAIN));
  await openFinder(me);
  // one priority, searched to the end (a phone moves to its Results tab), and its first swap kept;
  // a swap can be kept, and kept ones let go, once the list has been ranked
  await me.id('finder:goal:0').selectOption(FINDER_GOAL);
  await me.press(me.id('finder:search'));
  const keep = page.locator('[data-testid^="finder:keep:"]').first();
  await expect(keep).toBeEnabled({ timeout: SLOW_MS });
  await keep.check();
  // ranked again: the Search button is back (desktop), the Kept tab counts the swap (phone)
  await expect(me.phone ? me.id('tab:Kept (1)') : me.id('finder:search')).toBeEnabled({ timeout: SLOW_MS });
  await shot(page, 'finder-kept');
  // the shopping list: a screen of its own on the desktop, the List tab on a phone
  if (me.phone) await me.press(me.id('tab:Kept (1)'));
  if (me.phone) await shot(page, 'finder-kept-tab');
  await me.press(me.phone ? me.id('tab:List') : me.id('finder:shopping'));
  await expect(me.id('shop:sets')).toBeVisible();
  await shot(page, 'shopping');
});

test('the first power and slot screens of a leveling build', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await openBuild(me, link(VILLAIN));
  const build = await me.build();
  await me.newBuild(build, 'leveling');
  await expect(me.id(`power:${build.picks[0]!.power}`).or(me.id(`tab:${POWER_TABS[0]}`)).first()).toBeAttached();
  await shotEach(me, 'level-1-power', POWER_TABS);
  // level by level, as the build has it, to the first level that gives slots
  for (const step of levelSteps(gd.core)) {
    for (const pick of step.picks) {
      await me.choosePower(build, build.picks[pick]!.power);
      await me.press(me.button(me.next));
      await expect(me.button(me.next)).toHaveCount(0);
    }
    if (!step.slots) continue;
    await expect(page.getByText('Slots Available', { exact: false }).first()).toBeVisible();
    await shotEach(me, 'first-slots', POWER_TABS);
    break;
  }
});

test('the first power and the slot screens of a respec', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await openBuild(me, link(VILLAIN));
  const build = await me.build();
  await me.newBuild(build, 'respec');
  await expect(page.getByText(/Powers Remaining: \d+/).first()).toBeVisible();
  await shotEach(me, 'respec-first-power', POWER_TABS);
  await me.choosePowers(build);
  await expect(page.getByText('Slots Available', { exact: false }).first()).toBeVisible();
  await shotEach(me, 'respec-slots', POWER_TABS);
});

test('Choose a Pool Power Set and Choose an Epic Power Set', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await openBuild(me, link(VILLAIN));
  const build = await me.build();
  // a respec of the build, pick by pick: each screen is pictured at the first pick that offers it,
  // where every pool (level 4) or epic and patron pool (level 35) is still open
  await me.newBuild(build, 'respec');
  const kinds = ['pool', 'Epic'];
  for (const step of respecSteps(levelSteps(gd.core), RESPEC_TO)) {
    for (const pick of step.picks) {
      // phones: the way in is on the Pools tab
      if (me.phone) await me.press(me.id('tab:Pools'));
      const kind = kinds[0]!;
      const way = me.button(`Choose from new ${kind} power set`);
      if (await me.present(way, 300)) {
        await me.press(way);
        // phones: the sets and a set's powers are a tab each
        if (me.phone) await me.press(me.id(`tab:1. ${kind === 'pool' ? 'Pool' : 'Epic'} set`));
        const sets = page.locator('[data-testid^="set:"]');
        await expect(sets.first()).toBeVisible();
        await shot(page, `${kind.toLowerCase()}-sets`);
        await me.press(sets.first());
        if (me.phone) await me.press(me.id('tab:2. Power'));
        await expect(page.locator('[data-testid^="power:"]').first()).toBeVisible();
        await shot(page, `${kind.toLowerCase()}-set-chosen`);
        await me.press(me.button('Back'));
        await expect(sets).toHaveCount(0);
        kinds.shift();
        if (!kinds.length) return;
      }
      await me.choosePower(build, build.picks[pick]!.power);
      await me.press(me.button(me.next));
      await expect(me.button(me.next)).toHaveCount(0);
    }
  }
  throw new Error(`the respec never offered: ${kinds.join(', ')}`);
});

test("the totals' Pets and Minions and a pet's pane", async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await openBuild(me, link(PETS));
  // the desktop overview shows its totals beside the powers; a phone keeps them on a tab
  if (me.phone) await me.press(me.id(`tab:${TOTALS_TAB}`));
  // the section is folded until its heading is pressed; the pets arrive with the version's pets file
  const heading = page.locator('.title-text', { hasText: 'Pets and Minions' }).first();
  await expect(heading).toBeVisible({ timeout: SLOW_MS });
  await me.press(heading);
  const pet = page.locator('[data-testid^="pet:"]').first();
  await expect(pet).toBeVisible();
  await shot(page, 'pets');
  await me.press(pet);
  await expect(me.id('pet-pane')).toBeVisible();
  await shot(page, 'pet-pane');
});

test('a Thunderspy build: the overview, the picker and a power reopened', async ({ page }, info) => {
  const me = new Player(page, info.project.name === 'phone');
  await openBuild(me, link(THUNDERSPY, 'thunderspy'));
  expect((await me.build()).server).toBe('thunderspy');
  await shotEach(me, 'thunderspy-overview', [...POWER_TABS, TOTALS_TAB]);
  if (me.phone) await me.press(me.id(`tab:${POWER_TABS[0]}`));

  await me.press(page.locator('[data-testid^="ring:"]').first());
  await expect(me.id('picker:place')).toBeAttached();
  await shot(page, 'thunderspy-picker');
  await page.keyboard.press('Escape');
  await expect(me.id('picker:place')).toHaveCount(0);

  await me.press(page.locator('[data-testid^="bar:"]').first());
  await expect(me.button('Cancel')).toBeVisible();
  await shotEach(me, 'thunderspy-power-reopened', POWER_TABS);
});
