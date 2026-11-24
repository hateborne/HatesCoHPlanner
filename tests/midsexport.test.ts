/**
 * Mids export and import keep every power and piece they can (Homecoming): pieces Mids names its
 * own way (its Shrapnel is the game's Artillery), pieces Mids has no record of (a stand-in goes to
 * Mids, the exact piece comes back in the planner through the share link in the build comment),
 * powers Mids names otherwise or that the game has swapped names of, edits made in Mids, and the
 * planner's own exports from before.
 */
import { describe, expect, it, vi } from 'vitest';

// brotli-wasm's default (web) build fetches its .wasm, which Node can't: use its Node build
vi.mock('brotli-wasm', async () => {
  const { createRequire } = await import('node:module');
  const pkg: unknown = createRequire(import.meta.url)('brotli-wasm');
  return { default: Promise.resolve(pkg) };
});
import { newBuild, type Build, type Slot } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { buildToMxDz, exportMbd, importMbd, importMidsText, linkedBuild, mbdToChunk, type Mbd } from '../src/io/mids.ts';
import { PLANNER_APP } from '../src/io/midsPatches.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, loadMidsMapFile, pid, sid } from './helpers/data.ts';

const gd = loadData('i28p4');
const map = loadMidsMapFile('i28p4');

// a Dark Blast / Ice Manipulation Blaster (i28p4) from a player's report (re-encoded from a hand copy
// of the link, so it may differ from the player's by a byte), with attuned Thunderstrike, Touch of
// the Nictus, Unbreakable Guard, Luck of the Gambler and Reactive Defenses, and an Artillery piece
const REPORTED =
  'eJwl0U1rE1EUBuD3zE3uTDKZNMkkbWwdW-O06Zik9hYXwjA_yJ1_QuhCiosStWCzsApWXCilaKsxxBorfrTqwu9QXIsLURAE9RxdvA9zhznn3nuGSMEeB6qdBNB4oGB1OfcVUvc42wr6rsJ-DBAOKmT2YkKK-j4ZpydsMdk7zGrCn6qhT0G2UyQ_97lAQW51FPk2V-V_l8m8iNPQ6V2PTGEg7DClvtBjyl1mJbGh7b6Dcs_B6BZHGlaXuFf1SoZqz-MMVOaPQ2b8l_CDuZS40O5Q4fAnzkeFIx847znvFB6HnkXeW979WTwCa6TjkpkSXoZF4Gnsg3xZXkgq0JWfNqa-c77ZOHqT7_Qf7IdjSI-t8CGO3cowj2zmIRNuM-3kEHTpK38ZfhGW-R4zcuyZN0VmmKPgSTwBPXG7QKYuk6vL5OoyuUguHZ11qL4bB9CBVEQX-d3xtnBe4AamuZ4lczmZhDXZ5S5NOfJmowZVG9ho7thodW3shdNQ0689tG64aF13sdGYRWq2zfUnloUl4RyzHjZgNRbzFJhXHgWb4RysucUSGVmajXAe1vy_5RrP17oa8b9f47JrESwM-EEf8P5In144debkwl_aT3kX';

/** @return Every pick's slotted pieces, by full name, in order ('-' for an empty slot). */
const slotted = (b: Build): string[][] =>
  // a pick stored without slots still has its base slot (the link's Kick), which Mids writes out
  b.picks.filter((p) => p).map((p) => (p!.slots.length ? p!.slots.map((s) => (s.enh ? gd.power(s.enh.boost).n : '-')) : ['-']));

/** @return The pick holding a power. */
const pickOf = (b: Build, name: string) => b.picks.find((p) => p?.power === pid(gd, name))!;

const reported = async () => checkBuild(gd, await decodeShare(REPORTED)).build!;

/** @return The .mbd as a Mids user without the planner's link would have it: no comment, no planner app name. */
const asMids = (m: Mbd): Mbd => {
  const c = JSON.parse(JSON.stringify(m)) as Mbd;
  delete c.BuiltWith;
  delete c.Comment;
  return c;
};

/** @return A copy of a .mbd. */
const copyOf = (m: Mbd): Mbd => JSON.parse(JSON.stringify(m)) as Mbd;

/** @return The planner's .mbd export of a build, with its share link in the comment as the menu writes it. */
const exported = async (b: Build) => exportMbd(gd, map, b, `https://hateborne.github.io/HatesCoHPlanner/Homecoming/#b=${await encodeShare(b)}`);

/** @return A .mbd read as the planner's import reads a file: with the build behind its comment's link. */
const reopen = async (m: Mbd) => importMbd(gd, map, m, { link: await linkedBuild(gd, m) });

/**
 * A build of an archetype with the given powers picked (in order, each at its pick's level) and
 * the given pieces slotted in the first.
 */
function build(at: string, primary: string, secondary: string, powers: string[], pieces: string[] = [], origin = 'Science'): Build {
  const a = gd.archetypeByName.get(at.toLowerCase())!;
  const b = newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    at: a.id,
    origin: gd.core.origins.find((o) => o.n === origin)!.id,
    alignment: 'Hero',
    primary: sid(gd, primary),
    secondary: sid(gd, secondary),
    pickCount: gd.core.schedule.power.length,
  });
  powers.forEach((n, i) => {
    const level = gd.core.schedule.power[i]!;
    const slots: Slot[] = i === 0 && pieces.length ? pieces.map((x) => ({ level, enh: { boost: pid(gd, x) } })) : [{ level }];
    b.picks[i] = { power: pid(gd, n), level, slots };
  });
  return b;
}

describe('Mids export of set pieces', () => {
  it('exports Artillery under Mids name and reads it back', async () => {
    const b = await reported();
    const { mbd } = exportMbd(gd, map, b);
    const uids = mbd.PowerEntries.flatMap((p) => p.SlotEntries.map((s) => s.Enhancement?.Uid));
    expect(uids).toContain('Crafted_Shrapnel_A');
    expect(slotted(importMbd(gd, map, asMids(mbd)).build).flat()).toContain('Boosts.Crafted_Artillery_A.Crafted_Artillery_A');
  });

  it('exports an attuned piece of an ordinary set as crafted, with the share link in the comment', async () => {
    const b = await reported();
    const { mbd, warnings } = await exported(b);
    expect(warnings.filter((w) => /no such enhancement/.test(w))).toEqual([]);
    const moon = mbd.PowerEntries.find((p) => p.PowerName === 'Blaster_Ranged.Dark_Blast.Moonbeam')!;
    expect(moon.SlotEntries[0]!.Enhancement).toMatchObject({ Uid: 'Crafted_Thunderstrike_A', IoLevel: 49 });
    expect(mbd.Comment).toBe(`Hate's CoH Planner build: https://hateborne.github.io/HatesCoHPlanner/Homecoming/#b=${await encodeShare(b)}\r\ni28p4`);
    expect(JSON.stringify(mbd)).not.toMatch(/Planner(Enh|Power)/);
    // one warning per set, naming how many pieces
    expect(warnings.filter((w) => w.startsWith('Thunderstrike:'))).toEqual([
      'Thunderstrike: Mids has no attuned version of this set, so its 3 attuned pieces go to Mids as crafted at level 50',
    ]);
    expect(warnings.filter((w) => w.startsWith('Luck of the Gambler:'))).toEqual([
      'Luck of the Gambler: Mids has no attuned version of this set, so its attuned piece goes to Mids as crafted at level 50',
    ]);
  });

  it('reopens its own .mbd file and Mids share code as the same build', async () => {
    const b = await reported();
    const { mbd } = await exported(b);
    // the whole build: the respec, the base slots' levels and the powers without slots of their own too
    const fromFile = await importMidsText(gd, map, JSON.stringify(mbd));
    expect(checkBuild(gd, fromFile.build).build).toEqual(b);
    expect(fromFile.warnings).toEqual([]);
    const fromCode = await importMidsText(gd, map, await mbdToChunk(mbd));
    expect(checkBuild(gd, fromCode.build).build).toEqual(b);
    // saved again by Mids: its own app name, the comment kept
    const saved = copyOf(mbd);
    saved.BuiltWith = { App: 'MidsReborn', Version: '3.7.0' };
    expect(checkBuild(gd, (await reopen(saved)).build).build).toEqual(b);
  });

  it('reads what was changed in Mids from the file, and the rest from the link', async () => {
    const b = await reported();
    const { mbd } = await exported(b);
    const edited = copyOf(mbd);
    const moon = edited.PowerEntries.find((p) => p.PowerName === 'Blaster_Ranged.Dark_Blast.Moonbeam')!;
    // a piece swapped in Mids, and a slot emptied
    moon.SlotEntries[0]!.Enhancement = { ...moon.SlotEntries[0]!.Enhancement!, Uid: 'Crafted_Apocalypse_A', IoLevel: 49 };
    moon.SlotEntries[1]!.Enhancement = null;
    const back = pickOf((await reopen(edited)).build, 'Blaster_Ranged.Dark_Blast.Moonbeam');
    const was = pickOf(b, 'Blaster_Ranged.Dark_Blast.Moonbeam');
    const names = (p: typeof back) => p.slots.map((s) => (s.enh ? gd.power(s.enh.boost).n : '-'));
    expect(names(back)).toEqual(['Boosts.Crafted_Apocalypse_A.Crafted_Apocalypse_A', '-', ...names(was).slice(2)]);
    // the attuned piece left as it was stays attuned
    expect(names(back)[2]).toBe('Boosts.Attuned_Thunderstrike_E.Attuned_Thunderstrike_E');
  });

  it('ignores a link to another game version, other power sets, a damaged one, or one without its label', async () => {
    const b = await reported();
    const { mbd } = await exported(b);
    const label = "Hate's CoH Planner build: ";
    const gloom = build('Class_Blaster', 'Blaster_Ranged.Dark_Blast', 'Blaster_Support.Ice_Manipulation', ['Blaster_Ranged.Dark_Blast.Gloom']);
    const flares = build('Class_Blaster', 'Blaster_Ranged.Fire_Blast', 'Blaster_Support.Ice_Manipulation', ['Blaster_Ranged.Fire_Blast.Flares']);
    const comments = [
      `${label}#b=${await encodeShare({ ...gloom, dataVersion: 'i28p3' })}`,
      `${label}#b=${await encodeShare(flares)}`,
      `${label}#b=AAAA`,
      'my notes',
      // a link a player pasted in, even of this very build
      `see https://hateborne.github.io/HatesCoHPlanner/Homecoming/#b=${await encodeShare(b)}`,
    ];
    for (const comment of comments) {
      const m = copyOf(mbd);
      m.Comment = comment;
      const moon = pickOf((await reopen(m)).build, 'Blaster_Ranged.Dark_Blast.Moonbeam');
      expect(gd.power(moon.slots[0]!.enh!.boost).n).toBe('Boosts.Crafted_Thunderstrike_A.Crafted_Thunderstrike_A');
    }
  });

  it('opens the same file without the link with the stand-ins', async () => {
    const { mbd } = await exported(await reported());
    const moon = pickOf(importMbd(gd, map, asMids(mbd)).build, 'Blaster_Ranged.Dark_Blast.Moonbeam');
    expect(moon.slots[0]!.enh).toEqual({ boost: pid(gd, 'Boosts.Crafted_Thunderstrike_A.Crafted_Thunderstrike_A'), ioLevel: 49 });
  });

  it('a legacy MxDz code keeps the pieces as crafted, no slot left empty', async () => {
    const b = await reported();
    const { text } = await buildToMxDz(gd, map, b);
    const back = checkBuild(gd, (await importMidsText(gd, map, text)).build).build!;
    const moon = pickOf(back, 'Blaster_Ranged.Dark_Blast.Moonbeam');
    expect(moon.slots.slice(0, 3).map((s) => gd.power(s.enh!.boost).n)).toEqual(
      ['A', 'B', 'E'].map((x) => `Boosts.Crafted_Thunderstrike_${x}.Crafted_Thunderstrike_${x}`),
    );
    expect(slotted(back).flat().filter((n) => n === '-').length).toBe(slotted(b).flat().filter((n) => n === '-').length);
  });

  it('exports dual-origin pieces as DOs, and a Mids DO comes back as one of its origin', () => {
    const b = build('Class_Blaster', 'Blaster_Ranged.Dark_Blast', 'Blaster_Support.Ice_Manipulation', ['Blaster_Ranged.Dark_Blast.Gloom'],
      ['Boosts.Mutation_Science_Accuracy.Mutation_Science_Accuracy', 'Boosts.Science_Accuracy.Science_Accuracy']);
    const { mbd, warnings } = exportMbd(gd, map, b);
    expect(warnings).toEqual([]);
    expect(mbd.PowerEntries[0]!.SlotEntries.map((s) => s.Enhancement?.Grade)).toEqual(['DualO', 'SingleO']);
    const back = importMbd(gd, map, asMids(mbd)).build.picks[0]!.slots.map((s) => gd.power(s.enh!.boost).n);
    expect(back[1]).toBe('Boosts.Science_Accuracy.Science_Accuracy');
    expect(back[0]).toMatch(/^Boosts\.(Mutation_Science|Science_Technology)_Accuracy\./);
  });

  it('a superior purple goes to Mids as its crafted piece; a pre-order piece leaves the Mids slot empty', async () => {
    const b = build('Class_Blaster', 'Blaster_Ranged.Dark_Blast', 'Blaster_Support.Ice_Manipulation', ['Blaster_Ranged.Dark_Blast.Gloom'],
      ['Boosts.Superior_Attuned_Apocalypse_A.Superior_Attuned_Apocalypse_A', 'Boosts.Generic_Might_of_the_Empire.Generic_Might_of_the_Empire']);
    const { mbd, warnings } = exportMbd(gd, map, b);
    expect(mbd.PowerEntries[0]!.SlotEntries.map((s) => s.Enhancement?.Uid ?? null)).toEqual(['Crafted_Apocalypse_A', null]);
    expect(warnings).toEqual([
      'Apocalypse: Mids has no superior version of this set, so its superior piece goes to Mids as crafted at level 50',
      'Might of the Empire (Damage/Recharge/Chance for Knockdown): Mids has no such enhancement, so its slot is empty in Mids (the planner keeps it)',
    ]);
    const own = (await exported(b)).mbd;
    expect((await reopen(own)).build.picks[0]!.slots.map((s) => gd.power(s.enh!.boost).n)).toEqual([
      'Boosts.Superior_Attuned_Apocalypse_A.Superior_Attuned_Apocalypse_A',
      'Boosts.Generic_Might_of_the_Empire.Generic_Might_of_the_Empire',
    ]);
  });
});

describe('Mids power names', () => {
  // Homecoming's Stalker Shield Defense: its Deflection shows as Battle Agility, its Battle_Agility
  // as Active Defense and its Active_Defense as Deflection; Mids names each by what it shows
  const stalker = () =>
    build('Class_Stalker', 'Stalker_Melee.Broad_Sword', 'Stalker_Defense.Shield_Defense', [
      'Stalker_Melee.Broad_Sword.Hack',
      'Stalker_Defense.Shield_Defense.Active_Defense',
      'Stalker_Melee.Broad_Sword.Slice',
      'Stalker_Defense.Shield_Defense.Deflection',
    ]);

  it('exports a power under the name Mids gives what players see', () => {
    const names = exportMbd(gd, map, stalker()).mbd.PowerEntries.slice(0, 4).map((p) => p.PowerName);
    expect(names).toEqual([
      'Stalker_Melee.Broad_Sword.Hack',
      'Stalker_Defense.Shield_Defense.Deflection',
      'Stalker_Melee.Broad_Sword.Slice',
      'Stalker_Defense.Shield_Defense.Battle_Agility',
    ]);
  });

  it('reads a Mids build by what Mids names, and the planner own exports exactly', async () => {
    const b = stalker();
    const { mbd } = await exported(b);
    const powers = (x: Build) => x.picks.slice(0, 4).map((p) => gd.power(p!.power).n);
    const want = b.picks.slice(0, 4).map((p) => gd.power(p!.power).n);
    expect(powers(importMbd(gd, map, asMids(mbd)).build)).toEqual(want);
    expect(powers((await reopen(mbd)).build)).toEqual(want);
  });

  it('brings back the powers Mids has no record of where Mids left their place empty', async () => {
    const b = build('Class_Controller', 'Controller_Control.Mind_Control', 'Controller_Buff.Light_Affinity', [
      'Controller_Control.Mind_Control.Mesmerize',
      'Controller_Buff.Light_Affinity.Protective_Beam',
    ]);
    const { mbd } = await exported(b);
    // Mids drops a power it doesn't know: an empty entry
    const saved = copyOf(mbd);
    saved.PowerEntries[1] = { PowerName: '', Level: -1, SlotEntries: [] };
    expect((await reopen(saved)).build.picks[1]?.power).toBe(pid(gd, 'Controller_Buff.Light_Affinity.Protective_Beam'));
    // a power put in its place in Mids stays
    saved.PowerEntries[1] = { ...mbd.PowerEntries[1]!, PowerName: 'Controller_Control.Mind_Control.Levitate' };
    const res = await reopen(saved);
    expect(res.build.picks[1]?.power).toBe(pid(gd, 'Controller_Control.Mind_Control.Levitate'));
    expect(res.warnings).toContain("Protective Beam, which Mids doesn't have, was left out: the build has another power in its place");
    // Mids leaving the entry out altogether: the later picks still come back from the link
    const shifted = copyOf(mbd);
    shifted.PowerEntries.splice(1, 1);
    const back = (await reopen(shifted)).build;
    expect(back.picks.slice(0, 2).map((p) => p && gd.power(p.power).n)).toEqual(['Controller_Control.Mind_Control.Mesmerize', 'Controller_Buff.Light_Affinity.Protective_Beam']);
  });

  it("keeps the link's respec only while the picks are the link's", async () => {
    const b = { ...(await reported()) };
    expect(b.respecTo).toBeDefined();
    const { mbd } = await exported(b);
    expect((await reopen(mbd)).build.respecTo).toBe(b.respecTo);
    // a pick taken out in Mids: the respec level may no longer fit, so the file's reading stands
    const edited = copyOf(mbd);
    const k = edited.PowerEntries.findIndex((p) => p.PowerName === 'Blaster_Ranged.Dark_Blast.Moonbeam');
    edited.PowerEntries[k] = { PowerName: '', Level: -1, SlotEntries: [] };
    expect((await reopen(edited)).build.respecTo).toBeUndefined();
  });

  it('reopens a file MidsReborn 3.8 saved as the same build', async () => {
    // what Mids did to a planner export when it saved it (checked with MidsReborn 3.8.0): its own
    // BuiltWith, every StatInclude on, an SO's unused IoLevel as 1, a power it lacks as an empty
    // entry, its own inherent powers in its own order; the comment kept as written
    const b = build('Class_Stalker', 'Stalker_Melee.Broad_Sword', 'Stalker_Defense.Shield_Defense', [
      'Stalker_Melee.Broad_Sword.Hack',
      'Stalker_Defense.Shield_Defense.Hide',
      'Stalker_Melee.Broad_Sword.Slice',
      'Stalker_Melee.Broad_Sword.Boomerang_Slice',
      'Stalker_Defense.Shield_Defense.Deflection',
    ], ['Boosts.Science_Damage.Science_Damage', 'Boosts.Science_Damage.Science_Damage']);
    const { mbd } = await exported(b);
    const saved = copyOf(mbd);
    saved.BuiltWith = { App: 'Mids Reborn', Version: '3.8.0.0', Database: 'Homecoming', DatabaseVersion: '2026.1.1242' };
    for (const p of saved.PowerEntries) {
      p.StatInclude = true;
      for (const s of p.SlotEntries) if (s.Enhancement && s.Enhancement.Grade !== 'None') s.Enhancement.IoLevel = 1;
    }
    saved.PowerEntries[3] = { PowerName: '', Level: -1, SlotEntries: [] };
    saved.PowerEntries.splice(gd.core.schedule.power.length, 0, saved.PowerEntries.pop()!);
    expect(checkBuild(gd, (await reopen(saved)).build).build).toEqual(checkBuild(gd, b).build);
  });

  it('names the powers of one set Mids lacks in one warning', () => {
    const b = build('Class_Peacebringer', 'Peacebringer_Offensive.Luminous_Blast', 'Peacebringer_Defensive.Luminous_Aura', [
      'Peacebringer_Defensive.Luminous_Aura.White_Dwarf_Flare',
      'Peacebringer_Defensive.Luminous_Aura.White_Dwarf_Smite',
    ]);
    expect(exportMbd(gd, map, b).warnings.filter((w) => w.includes('White Dwarf'))).toEqual([
      'Luminous Aura: Mids has no White Dwarf Flare, White Dwarf Smite, so Mids leaves them out with their enhancements (the planner keeps them)',
    ]);
  });

  it("reads the planner's exports from before the map's names by the game's names", () => {
    // what the planner wrote before: the game's own names, its app name, no planner fields
    const old = asMids(exportMbd(gd, map, stalker()).mbd);
    old.BuiltWith = { App: PLANNER_APP, Version: '1.3.0' };
    old.PowerEntries[1]!.PowerName = 'Stalker_Defense.Shield_Defense.Active_Defense';
    old.PowerEntries[3]!.PowerName = 'Stalker_Defense.Shield_Defense.Deflection';
    const powers = importMbd(gd, map, old).build.picks.slice(0, 4).map((p) => gd.power(p!.power).n);
    expect(powers[1]).toBe('Stalker_Defense.Shield_Defense.Active_Defense');
    expect(powers[3]).toBe('Stalker_Defense.Shield_Defense.Deflection');
    // the same names from Mids are its powers of those names
    const fromMids = asMids(old);
    const theirs = importMbd(gd, map, fromMids).build.picks.slice(0, 4).map((p) => gd.power(p!.power).n);
    expect(theirs[1]).toBe('Stalker_Defense.Shield_Defense.Battle_Agility');
    expect(theirs[3]).toBe('Stalker_Defense.Shield_Defense.Active_Defense');
  });

  it('keeps epic pool powers in a legacy MxDz code', async () => {
    const b = await reported();
    expect(b.picks.some((p) => p && gd.power(p.power).n.startsWith('Epic.'))).toBe(true);
    const back = checkBuild(gd, (await importMidsText(gd, map, (await buildToMxDz(gd, map, b)).text)).build).build!;
    expect(back.picks.map((p) => p && gd.power(p.power).n)).toEqual(b.picks.map((p) => p && gd.power(p.power).n));
  });

  it('says when Mids has no such power set or power', () => {
    const b = build('Class_Controller', 'Controller_Control.Mind_Control', 'Controller_Buff.Light_Affinity', [
      'Controller_Control.Mind_Control.Mesmerize',
      'Controller_Buff.Light_Affinity.Protective_Beam',
    ]);
    expect(exportMbd(gd, map, b).warnings).toEqual([
      'Light Affinity: Mids has no such power set, so Mids leaves out its powers and their enhancements (the planner keeps them)',
    ]);
    const s = build('Class_Stalker', 'Stalker_Melee.Broad_Sword', 'Stalker_Defense.Shield_Defense', [
      'Stalker_Melee.Broad_Sword.Hack',
      'Stalker_Defense.Shield_Defense.Hide',
      'Stalker_Melee.Broad_Sword.Boomerang_Slice',
    ]);
    expect(exportMbd(gd, map, s).warnings).toEqual([
      'Boomerang Slice (Broad Sword): Mids has no such power, so Mids leaves it out with its enhancements (the planner keeps it)',
    ]);
  });
});
