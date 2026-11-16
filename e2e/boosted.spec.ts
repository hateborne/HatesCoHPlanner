/**
 * A forum build recreated with its enhancements boosted and attuned at random, on the desktop and
 * the phone layout: the picker's level, booster and attuned controls, which the forum builds in
 * recreate.spec.ts barely use. The finished build must match the plan, and its share link must
 * open the same build in a new tab.
 *
 * Each set a power holds gets one treatment; the sets are shuffled with a seeded random number and
 * dealt the treatments in turn, so every run uses all three:
 * - boost: the crafted pieces with boosters;
 * - attune: the attuned version of each piece;
 * - boost, then attune: +1 to +5 boosters chosen on the crafted piece first, then Attuned ticked.
 *   The game data marks attuned pieces as not boostable, so the planner must drop the boosters.
 * The sets with a boostable piece are dealt before the rest, so each treatment gets its share of
 * them. Every boosted piece (common IOs and other pieces outside a set too), in a shuffled order,
 * takes the next of +1, +2, +3, +4, +5, +0, so any run holds each of +1 to +5. Set HCP_E2E_SEED to
 * repeat a run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Build, SlottedEnh } from '../src/engine/build.ts';
import { setEnh } from '../src/engine/actions.ts';
import { defaultLevel } from '../src/engine/enhance.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { gd, Player, POWER_TABS, shape, STORAGE_KEY } from './player.ts';

const FILE = 'symphony-dark-dominator.txt';
// the enhancements the build holds (tests/fixtures/builds)
const ENHANCEMENTS = 91;
// the highest booster level (Enhancement Booster +5)
const MAX_BOOSTERS = 5;

type Treatment = 'boost' | 'attune' | 'boost, then attune';
const TREATMENTS: Treatment[] = ['boost', 'attune', 'boost, then attune'];

/** One enhancement to place: its slot, what the planner should end up holding, and how to get there. */
interface Placement {
  key: string; // the power's entry key (pick:<i> or grant:<power id>)
  slot: number; // the slot's index on the power
  enh: SlottedEnh; // the enhancement the slot should hold
  boostFirst?: number; // boost, then attune: the boosters set on the crafted piece before Attuned is ticked
}

/** @return A seeded random number generator (mulberry32), uniform in [0, 1). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffle a list in place (Fisher-Yates) with a seeded random number generator. */
function shuffle<T>(list: T[], rand: () => number): void {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
}

/** @return The crafted (variant 0) and attuned (variant 1) versions of a set piece, when it has them. */
function versions(boost: number): { crafted: number; attuned?: number } {
  const ref = gd.boostSetOf.get(boost);
  if (!ref) return { crafted: boost };
  const v = ref.set.slots[ref.letter]!;
  return { crafted: v[0]!, attuned: v[1] };
}

/**
 * Deal the treatments: group each power's enhancements by set, shuffle the groups that can be
 * attuned (those with a boostable piece first), give them the treatments in turn, boost everything
 * else, then deal the boosted pieces their boosters.
 *
 * @param b The imported build.
 * @param rand The seeded random number generator.
 * @return The build the planner should end up with, the placements in overview order, and a log.
 */
function plan(b: Build, rand: () => number): { want: Build; placements: Placement[]; log: string[] } {
  interface Group {
    key: string;
    power: string;
    name: string;
    slots: number[];
    treatment?: Treatment;
  }
  const groups: Group[] = [];
  const enhOf = new Map<string, SlottedEnh>();
  for (const e of new BuildRules(gd, b).entries()) {
    const byName = new Map<string, Group>();
    e.slots.forEach((s, i) => {
      if (!s.enh) return;
      enhOf.set(`${e.key}:${i}`, s.enh);
      const ref = gd.boostSetOf.get(s.enh.boost);
      const name = ref ? ref.set.dn : 'pieces outside a set';
      let g = byName.get(name);
      if (!g) byName.set(name, (g = { key: e.key, power: e.power.dn, name, slots: [] }));
      g.slots.push(i);
    });
    groups.push(...byName.values());
  }
  const versionsAt = (g: Group, i: number) => versions(enhOf.get(`${g.key}:${i}`)!.boost);
  const boostable = (g: Group, i: number) => !!gd.power(versionsAt(g, i).crafted).bb;
  // only sets with an attuned version can take every treatment; the rest are boosted (when they can
  // be). Those with a boostable piece are dealt first, so boost and boost-then-attune both get some
  const attunable = groups.filter((g) => g.slots.some((i) => versionsAt(g, i).attuned !== undefined));
  const withBoostable = attunable.filter((g) => g.slots.some((i) => boostable(g, i)));
  const others = attunable.filter((g) => !withBoostable.includes(g));
  shuffle(withBoostable, rand);
  shuffle(others, rand);
  [...withBoostable, ...others].forEach((g, i) => (g.treatment = TREATMENTS[i % TREATMENTS.length]));

  // the pieces placed crafted (as the loop below decides), and of those the boostable ones, which
  // take the next of +1 .. +5, +0 in a shuffled order: any five of them hold each of +1 to +5
  const staysCrafted = (g: Group, i: number) => (g.treatment ?? 'boost') === 'boost' || versionsAt(g, i).attuned === undefined;
  const boosted = groups.flatMap((g) => g.slots.filter((i) => staysCrafted(g, i) && boostable(g, i)).map((i) => `${g.key}:${i}`));
  shuffle(boosted, rand);
  const boostersOf = new Map(boosted.map((k, n) => [k, (n + 1) % (MAX_BOOSTERS + 1)]));

  let want = b;
  const placements: Placement[] = [];
  const log: string[] = [];
  for (const g of groups) {
    const treatment = g.treatment ?? 'boost';
    const notes: string[] = [];
    g.slots.forEach((i) => {
      const was = enhOf.get(`${g.key}:${i}`)!;
      const { crafted, attuned } = versions(was.boost);
      const piece = gd.power(crafted);
      let enh: SlottedEnh;
      let boostFirst: number | undefined;
      if (treatment === 'boost' || attuned === undefined) {
        // the crafted piece at the build's level, with its boosters when the game allows them
        const boosters = boostersOf.get(`${g.key}:${i}`) ?? 0;
        enh = { ...was, boost: crafted, ioLevel: was.boost === crafted ? was.ioLevel : defaultLevel(gd, piece), boosters };
        notes.push(piece.bb ? `+${boosters}` : 'not boostable');
      } else {
        enh = { boost: attuned };
        if (treatment === 'boost, then attune' && piece.bb) boostFirst = 1 + Math.floor(rand() * MAX_BOOSTERS);
        notes.push(boostFirst !== undefined ? `+${boostFirst} then attuned` : 'attuned');
      }
      want = setEnh(want, g.key, i, enh, 0);
      placements.push({ key: g.key, slot: i, enh, boostFirst });
    });
    log.push(`${g.power} / ${g.name}: ${g.treatment ?? 'boost (no attuned version)'} [${notes.join(', ')}]`);
  }
  // overview order: power by power, slot by slot
  const order = new Map(new BuildRules(gd, want).entries().map((e, i) => [e.key, i]));
  placements.sort((x, y) => order.get(x.key)! - order.get(y.key)! || x.slot - y.slot);
  return { want, placements, log };
}

test('Symphony / Dark Dominator, enhancements boosted and attuned at random', async ({ page }, info) => {
  const seed = Number(process.env.HCP_E2E_SEED) || Math.floor(Math.random() * 2 ** 31);
  info.annotations.push({ type: 'seed', description: String(seed) });
  const me = new Player(page, info.project.name === 'phone');
  await page.goto('./Homecoming/'); // the site root asks for a server once there is more than one

  const target = await me.importBuild(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'builds', FILE), 'utf-8'));
  const { want, placements, log } = plan(target, seeded(seed));
  console.log(`[${info.project.name}] seed ${seed}\n  ${log.join('\n  ')}`);
  // the plan has all of it, whatever the seed: boosters from +1 to +5, attuned pieces, and boosters
  // dropped by Attuned
  expect(placements).toHaveLength(ENHANCEMENTS);
  const used = new Set(placements.map((p) => p.enh.boosters ?? 0));
  for (let n = 1; n <= MAX_BOOSTERS; n++) expect(used.has(n), `a piece with +${n}`).toBe(true);
  expect(placements.some((p) => gd.power(p.enh.boost).bup && p.boostFirst === undefined)).toBe(true);
  expect(placements.some((p) => (p.boostFirst ?? 0) > 0)).toBe(true);
  // and the game allows every piece of it
  expect(new BuildRules(gd, want).issues()).toEqual([]);

  await me.newBuild(want, 'respec');
  await me.choosePowers(want);
  await me.placeSlots(want);
  for (const p of placements) {
    await me.press(await me.reveal(`ring:${p.key}:${p.slot}`, POWER_TABS));
    if (p.boostFirst === undefined) await me.pickEnhancement(p.enh);
    else {
      // the crafted piece with its boosters, then the attuned version: the boosters can't come along
      const crafted = versions(p.enh.boost).crafted;
      await me.pickEnhancement({ boost: crafted, ioLevel: defaultLevel(gd, gd.power(crafted)), boosters: p.boostFirst });
      await expect(me.id('picker:boosters')).toHaveValue(String(p.boostFirst));
      await me.press(me.id('picker:attuned'));
      await expect(me.id('picker:attuned')).toBeChecked();
      await expect(me.id('picker:boosters')).toHaveCount(0);
    }
    await me.press(me.id('picker:place'));
    await expect(me.id('picker:place')).toHaveCount(0);
  }

  const made = await me.build();
  expect(shape(gd, made)).toEqual(shape(gd, want));
  expect(new BuildRules(gd, made).issues()).toEqual([]);

  // the address bar's share link (written 300 ms after the last change) opens the same build in a new tab
  await page.waitForTimeout(1500);
  expect(page.url()).toMatch(/#b=/);
  const tab = await page.context().newPage();
  await tab.goto(page.url());
  await expect(tab.getByRole('button', { name: 'New Build', exact: true })).toBeVisible();
  const linked = JSON.parse((await tab.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY)) ?? 'null') as Build | null;
  expect(linked && shape(gd, linked)).toEqual(shape(gd, want));
});
