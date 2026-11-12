/**
 * What the browser tests share: the game data, a build written out by names for comparison, and
 * the Player that drives the planner's screens (clicks on the desktop, taps on a phone).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { GameData } from '../src/data/gamedata.ts';
import type { Power, Powerset } from '../src/data/types.ts';
import type { Build, SlottedEnh } from '../src/engine/build.ts';
import { enhKind, type EnhKind } from '../src/engine/enhance.ts';
import { BuildRules } from '../src/engine/rules.ts';
import { levelSteps, respecSteps } from '../src/engine/schedule.ts';
import { loadData } from '../tests/helpers/data.ts';

// where the planner keeps this tab's build (src/state/store.ts STORAGE_KEY)
export const STORAGE_KEY = 'hcp.current';
// the respec runs to level 50 (0-based 49), the New Build screen's default
export const RESPEC_TO = 49;
// the phone screens' panels, in the order their tabs are tried
export const POWER_TABS = ['Primary', 'Secondary', 'Pools'];
// the enhancement picker tab each kind of enhancement is listed on
export const PICKER_TAB: Record<EnhKind, string> = {
  Training: 'Training',
  Origin: 'Origin',
  Invention: 'Invention',
  Set: 'Sets',
  Hamidon: 'Special',
  Hydra: 'Special',
  Titan: 'Special',
  DSync: 'Special',
  Synthetic: 'Special',
  Talisman: 'Special',
  Other: 'Special',
};

// the default version's data; ids and names are the same in every version, so it also drives the
// screens for a build that opened on another patch (check such a build with loadData(b.dataVersion))
export const gd = loadData();

/** @return The power set a power belongs to (its full name is Category.Set.Power). */
export function setOf(gd: GameData, p: Power): Powerset {
  const s = gd.setByName.get(p.n.split('.').slice(0, 2).join('.').toLowerCase());
  if (!s) throw new Error(`no power set for ${p.n}`);
  return s;
}

/** @return The values of an enhancement the planner uses: level for IOs, relative level for TO/DO/SO, boosters. */
export function enhShape(gd: GameData, e: SlottedEnh): Record<string, string | number | undefined> {
  const b = gd.power(e.boost);
  return {
    boost: b.n,
    ioLevel: b.bie && !b.bup ? e.ioLevel : undefined,
    rel: b.bie ? undefined : (e.rel ?? 0),
    boosters: b.bb ? (e.boosters ?? 0) : undefined,
  };
}

/**
 * A build as names, for a readable comparison: the character, each pick's power, and each power's
 * slots with their enhancements.
 *
 * @param gd Game data.
 * @param b The build.
 * @param levels Whether each slot's level counts (a leveling build places every slot at its own
 *   level; a respec hands the levels out itself).
 * @return A plain object to compare with toEqual.
 */
export function shape(gd: GameData, b: Build, levels = false) {
  return {
    at: gd.archetype(b.at).n,
    origin: b.origin,
    alignment: b.alignment,
    primary: gd.powerset(b.primary).n,
    secondary: gd.powerset(b.secondary).n,
    picks: b.picks.map((p) => (p ? gd.power(p.power).n : null)),
    powers: new BuildRules(gd, b).entries().map((e) => ({
      key: e.key,
      power: e.power.n,
      slots: e.slots.map((s) => {
        const enh = s.enh ? enhShape(gd, s.enh) : null;
        return levels ? { level: s.level + 1, enh } : enh;
      }),
    })),
  };
}

/** Drives the planner's screens: clicks on the desktop, taps on a phone. */
export class Player {
  // the wizard's forward button: Next in a respec, Finish while leveling (set by newBuild)
  next = 'Next';

  constructor(
    readonly page: Page,
    readonly phone: boolean,
  ) {}

  /** @return The element with this data-testid. */
  id(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /** @return The button with exactly this accessible name (NextButton, InfoButton, MenuBar, plain buttons). */
  button(name: string): Locator {
    return this.page.getByRole('button', { name, exact: true });
  }

  /** Click it (desktop) or tap it (phone). */
  async press(l: Locator): Promise<void> {
    if (this.phone) await l.tap();
    else await l.click();
  }

  /** @return Whether the element shows up within `ms` (false instead of a timeout error). */
  async present(l: Locator, ms: number): Promise<boolean> {
    try {
      await l.first().waitFor({ state: 'attached', timeout: ms });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find an element that may sit on another panel: phones show one panel at a time, so each tab is
   * opened in turn until it appears (the desktop shows every panel at once).
   *
   * @param testId The element's data-testid.
   * @param tabs The tab labels to try, most likely first.
   * @return The element.
   */
  async reveal(testId: string, tabs: string[]): Promise<Locator> {
    const el = this.id(testId);
    if (await el.count()) return el;
    for (const t of this.phone ? tabs : []) {
      await this.press(this.id(`tab:${t}`));
      if (await this.present(el, 500)) return el;
    }
    throw new Error(`${testId} is not on the screen${this.phone ? ` (tabs tried: ${tabs.join(', ')})` : ''}`);
  }

  /** @return This tab's build as the planner saved it. */
  async build(): Promise<Build> {
    const raw = await this.page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEY);
    if (!raw) throw new Error('the planner has no build in this tab');
    return JSON.parse(raw) as Build;
  }

  /**
   * Import a Mids data chunk through Saved builds / Import, from the New Build screen.
   *
   * @param text The chunk as posted (text around it is fine).
   * @return The imported build.
   */
  async importBuild(text: string): Promise<Build> {
    await this.press(this.button(this.phone ? 'Saved / Import' : 'Saved builds / Import'));
    await this.page.getByPlaceholder('Paste a share link').fill(text);
    await this.press(this.button('Import pasted text'));
    return this.imported();
  }

  /**
   * Import a Mids .mbd file through Saved builds / Import / Open .mbd file, from the New Build screen.
   *
   * @param path The file.
   * @return The imported build.
   */
  async importFile(path: string): Promise<Build> {
    await this.press(this.button(this.phone ? 'Saved / Import' : 'Saved builds / Import'));
    await this.page.locator('input[type=file]').setInputFiles(path);
    return this.imported();
  }

  /**
   * Finish an import: accept "Open on <patch>?" when the build was made on a patch the planner
   * doesn't carry, wait for the overview of the imported build, and close the "Imported, with gaps"
   * list if the import left any.
   *
   * A build made on a carried patch (or one that records no patch) opens without the question. The
   * gaps list sits over the overview and would block every click after it; which gaps a fixture
   * may have is tests/buildfixtures.test.ts's to check, so here they are only printed.
   *
   * @return The imported build.
   */
  private async imported(): Promise<Build> {
    const overview = this.button('New Build');
    const open = this.button('Open'); // the confirm dialog's OK (BuildMenu doImport)
    await expect(overview.or(open).first()).toBeVisible();
    const moved = await open.isVisible();
    if (moved) await this.press(open);
    await expect(overview).toBeVisible();
    const who = `[${this.phone ? 'phone' : 'desktop'}]`;
    const gaps = this.page.getByText("couldn't be brought over"); // BuildMenu's tell after an import
    if (await this.present(gaps, 1000)) {
      const list = this.page.locator('.body-text', { hasText: "couldn't be" }).last();
      console.log(`${who} import gaps: ${(await list.innerText()).replace(/\s*\n\s*/g, '; ')}`);
      await this.press(this.button('OK'));
      await expect(gaps).toHaveCount(0);
    }
    const b = await this.build();
    console.log(`${who} imported "${b.name}" on ${b.dataVersion}${moved ? ' (moved there from an older patch)' : ''}`);
    return b;
  }

  /**
   * New Build with the target's origin, alignment, archetype and sets, as a Respec to level 50 or
   * as a leveling build. The screen opens on the current build's choices; each one is chosen again
   * all the same.
   *
   * @param b The build to recreate.
   * @param type The build type.
   */
  async newBuild(b: Build, type: 'respec' | 'leveling'): Promise<void> {
    this.next = type === 'respec' ? 'Next' : 'Finish';
    await this.press(this.button('New Build'));
    const tab = async (t: string) => {
      if (this.phone) await this.press(this.id(`tab:${t}`));
    };
    await tab('Origin');
    await this.press(this.id(`origin:${b.origin}`));
    await this.press(this.id(`align:${b.alignment}`));
    await this.press(this.id(`buildtype:${type}`));
    if (type === 'respec') await expect(this.page.locator('#respec-level')).toHaveValue(String(RESPEC_TO + 1));
    await tab('Archetype');
    await this.press(this.id(`at:${b.at}`));
    await tab('Primary');
    await this.press(this.id(`set:${b.primary}`));
    await tab('Secondary');
    await this.press(this.id(`set:${b.secondary}`));
    await this.page.getByPlaceholder('Build name').fill(b.name);
    await this.press(this.button('Finish'));
    await this.press(this.button('Start new')); // it replaces the imported build
  }

  /**
   * Choose one power on Choose a New Power: from its panel, or through Choose a Pool (Epic) Power
   * Set when its set isn't owned yet.
   *
   * @param b The build being recreated (for which panel holds the power).
   * @param powerId The power.
   */
  async choosePower(b: Build, powerId: number): Promise<void> {
    const set = setOf(gd, gd.power(powerId));
    const panel = set.id === b.primary ? 'Primary' : set.id === b.secondary ? 'Secondary' : 'Pools';
    if (this.phone) await this.press(this.id(`tab:${panel}`));
    const bar = this.id(`power:${powerId}`);
    if (await this.present(bar, 500)) await this.press(bar);
    else {
      const kind = set.n.startsWith('Pool.') ? 'pool' : set.n.startsWith('Epic.') ? 'Epic' : null;
      if (!kind) throw new Error(`${gd.power(powerId).n} is not offered`);
      await this.press(this.button(`Choose from new ${kind} power set`));
      await this.press(this.id(`set:${set.id}`));
      await this.press(this.id(`power:${powerId}`)); // phones switch to "2. Power" on their own
      await this.press(this.button('Finish'));
      await expect(this.id(`set:${set.id}`)).toHaveCount(0); // back on Choose a New Power
    }
    await expect(this.button(this.next)).toBeVisible();
  }

  /**
   * Every power in the respec's order (level 1's secondary before its primary), each with Next.
   *
   * @param b The build to recreate.
   */
  async choosePowers(b: Build): Promise<void> {
    for (const step of respecSteps(levelSteps(gd.core), RESPEC_TO)) {
      for (const k of step.picks) {
        const p = b.picks[k];
        if (!p) throw new Error(`the build has no power at pick ${k}`);
        await this.choosePower(b, p.power);
        await this.press(this.button(this.next));
        await expect(this.button(this.next)).toHaveCount(0); // locked again: on to the next pick
      }
    }
  }

  /**
   * The level-up wizard from level 1 to 50, as a player levels: each level's powers (Finish after
   * each), then that level's slots on the powers the build put them on (Finish).
   *
   * @param b The build to recreate (a leveling build: every slot carries the level it was gained).
   */
  async levelUp(b: Build): Promise<void> {
    const entries = new BuildRules(gd, b).entries();
    for (const step of levelSteps(gd.core)) {
      for (const k of step.picks) {
        const p = b.picks[k];
        if (!p) throw new Error(`the build has no power at pick ${k}`);
        await this.choosePower(b, p.power);
        await this.press(this.button(this.next));
        await expect(this.button(this.next)).toHaveCount(0); // locked again: the next pick or the slots
      }
      if (!step.slots) continue;
      for (const e of entries) {
        const n = e.slots.filter((s, i) => i > 0 && s.level === step.level).length;
        if (!n) continue;
        const bar = await this.reveal(`slotbar:${e.key}`, POWER_TABS);
        for (let i = 0; i < n; i++) await this.press(bar);
      }
      await this.press(this.button(this.next));
      await expect(this.button(this.next)).toHaveCount(0);
    }
    await expect(this.button('New Build')).toBeVisible(); // the overview
  }

  /**
   * The respec slot screen: each power gets the target's slot count, then Next.
   *
   * @param b The build to recreate.
   */
  async placeSlots(b: Build): Promise<void> {
    for (const e of new BuildRules(gd, b).entries()) {
      if (e.slots.length < 2) continue;
      const bar = await this.reveal(`slotbar:${e.key}`, POWER_TABS);
      for (let i = 1; i < e.slots.length; i++) await this.press(bar);
    }
    await this.press(this.button(this.next));
    await expect(this.button('New Build')).toBeVisible(); // the overview
  }

  /**
   * Choose one enhancement in the open picker: its tab, its set and piece (and the attuned
   * version), its level, relative level and boosters.
   *
   * @param e The enhancement.
   */
  async pickEnhancement(e: SlottedEnh): Promise<void> {
    const b = gd.power(e.boost);
    const ref = gd.boostSetOf.get(b.id);
    await this.press(this.id(`tab:${PICKER_TAB[enhKind(gd, b)]}`));
    if (ref) {
      await this.press(this.id(`pickerset:${ref.set.id}`));
      // a set lists each piece once; the other version (attuned) is a check box away
      const listed = ref.set.slots[ref.letter]![0]!;
      await this.press(this.id(`boost:${listed}`));
      if (listed !== b.id) await this.press(this.id('picker:attuned'));
    } else await this.press(this.id(`boost:${b.id}`));
    const level = this.id('picker:level');
    if (e.ioLevel !== undefined && (await level.count())) await level.fill(String(e.ioLevel + 1));
    if (e.rel) await this.id('picker:rel').selectOption(String(e.rel));
    if (e.boosters) await this.id('picker:boosters').selectOption(String(e.boosters));
  }

  /**
   * Every enhancement, slot by slot, from the overview's rings.
   *
   * @param b The build to recreate.
   */
  async placeEnhancements(b: Build): Promise<void> {
    for (const e of new BuildRules(gd, b).entries()) {
      for (const [i, s] of e.slots.entries()) {
        if (!s.enh) continue;
        await this.press(await this.reveal(`ring:${e.key}:${i}`, POWER_TABS));
        await this.pickEnhancement(s.enh);
        await this.press(this.id('picker:place'));
        await expect(this.id('picker:place')).toHaveCount(0);
      }
    }
  }
}
