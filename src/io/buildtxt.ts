/**
 * Homecoming's /build_save file (build.txt): the live client's text dump of a character's current
 * build. It is Homecoming's own addition (not in the I24 source); the layout, as the client writes
 * it:
 *
 *   <Name>: Level <N> <Origin> <Class_X>
 *   Character Profile:
 *   ------------------
 *   Level <N>: <Category> <Set> <Power>     N: the level the power was taken (1-based)
 *   \t<Boost> (<level>)                     one line per slot, in the game's slot order;
 *   \t<Boost> (<level>+<boosters>)          the level is the enhancement's own (1-based)
 *   \tEMPTY
 *   ------------------
 *   Badges Earned: ...
 *
 * Every name is the game's internal name, so it resolves straight against the game data.
 *
 * The game keeps no level for a slot (character_BuyBoostSlot only counts them) and nothing says
 * whether the build came from a respec, so the import asks; leveledSlotShortfall() rules a leveled
 * build out when its slots can't have come from leveling. Alignment isn't in the file either.
 */
import type { GameData } from '../data/gamedata.ts';
import { DEFAULT_SERVER } from '../data/servers.ts';
import type { Power } from '../data/types.ts';
import { slotsFor } from '../engine/actions.ts';
import { cloneBuild, type Alignment, type Build, type Slot, type SlottedEnh } from '../engine/build.ts';
import { BuildRules } from '../engine/rules.ts';
import { leveledSlotShortfall, lowestFreeLevels } from '../engine/schedule.ts';
import { ImportProblem, READABLE, readable, readablePower } from './importProblem.ts';

/** One enhancement line of a build.txt. */
export interface TxtEnh {
  name: string; // internal boost name (Crafted_Unbreakable_Guard_A)
  level: number; // the enhancement's level as written (1-based)
  boosters: number; // enhancement boosters (the "+N"), 0 when none
}

/** One power line of a build.txt and the slots listed under it. */
export interface TxtPower {
  level: number; // the level the power was taken, as written (1-based)
  name: string; // full internal name, Category.Set.Power
  slots: (TxtEnh | null)[]; // null: an EMPTY slot
}

/** A parsed build.txt (names as written, nothing looked up yet). */
export interface BuildTxt {
  name: string; // character name
  level: number; // character level (1-based)
  origin: string; // Magic
  archetype: string; // Class_Tanker
  powers: TxtPower[];
  skipped: string[]; // lines in the power list that matched nothing
}

/**
 * A build.txt read against the game data, waiting for the choices the file can't answer
 * (alignment, and whether the build was leveled or made through a respec).
 */
export interface TxtImport {
  build: Build; // Hero, built by leveling; every bought slot still at its power's level (see finishBuildTxt)
  level: number; // 0-based character level
  summary: string; // "Example Guy: level 12 Science Blaster, Fire Blast / Gadgets"
  leveledBlock: string | null; // why the slots can't have come from leveling, or null when they can
  warnings: string[];
}

const HEADER = /^([^:]+): Level (\d+) (\S+) (\S+)$/;
const POWER = /^Level (-?\d+): (\S+) (\S+) (\S+)$/;
const ENH = /^(\S+) \((\d+)(?:\+(\d+))?\)$/;

/** @return The first line that isn't blank, trimmed. */
const firstLine = (lines: string[]) => lines.find((l) => l.trim() !== '')?.trim() ?? '';

/**
 * Whether a text looks like a /build_save file.
 *
 * Mids' own text export opens with a similar "Name: Level N Origin Archetype" line, but with the
 * archetype's display name; a forum post can also carry a Mids data chunk, which wins.
 *
 * @param text Pasted or opened text.
 * @return True when it starts with the "Name: Level N Origin Class_..." line (the game's internal
 *   class name), has a "Character Profile:" line, and holds no Mids data chunk.
 */
export function isBuildTxt(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const head = HEADER.exec(firstLine(lines));
  return !!head && /^Class_/i.test(head[4]!) && lines.some((l) => l.trim() === 'Character Profile:') && !/\|(MBD|MxDz);/.test(text);
}

/**
 * Parse a /build_save file. The power list ends at the first heading after it ("Badges Earned:").
 *
 * @param text The file's text.
 * @return The parsed file.
 * @raise ImportProblem when the header line is missing or no power is listed.
 */
export function parseBuildTxt(text: string): BuildTxt {
  const lines = text.split(/\r?\n/);
  const head = HEADER.exec(firstLine(lines));
  if (!head) throw new ImportProblem("it isn't a /build_save file", READABLE);
  const out: BuildTxt = { name: head[1]!.trim(), level: Number(head[2]), origin: head[3]!, archetype: head[4]!, powers: [], skipped: [] };
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^-+$/.test(line)) continue;
    if (line === 'Character Profile:') {
      inList = true;
      continue;
    }
    if (!inList) continue;
    const p = POWER.exec(line);
    if (p) {
      out.powers.push({ level: Number(p[1]), name: `${p[2]}.${p[3]}.${p[4]}`, slots: [] });
      continue;
    }
    const indented = /^\s/.test(raw);
    if (!indented && line.endsWith(':')) break; // the next section
    const last = out.powers[out.powers.length - 1];
    const e = ENH.exec(line);
    if (indented && last && line === 'EMPTY') last.slots.push(null);
    else if (indented && last && e) last.slots.push({ name: e[1]!, level: Number(e[2]), boosters: Number(e[3] ?? 0) });
    else out.skipped.push(line);
  }
  if (!out.powers.length) throw new ImportProblem('the file lists no powers', 'Save the build again in game with /build_save, then import the new build.txt.');
  return out;
}

/**
 * Read a /build_save file against the game data: picks in the power schedule, auto-granted powers'
 * slots, enhancements with their levels and boosters, and whether a leveled history fits its slots.
 *
 * Powers the planner doesn't model (temporary and prestige powers, Incarnate abilities, redirects)
 * are skipped, with a warning only when they hold enhancements.
 *
 * @param gd Game data the build opens on.
 * @param text The file's text.
 * @return The import, still to be finished with the user's choices (finishBuildTxt).
 * @raise ImportProblem when the archetype, origin, primary or secondary can't be found.
 */
export function readBuildTxt(gd: GameData, text: string): TxtImport {
  const txt = parseBuildTxt(text);
  const warn = txt.skipped.map((l) => `A line couldn't be read and was skipped: "${l}"`);
  const newer = 'It may come from a newer patch than the planner has.';
  const at = gd.archetypeByName.get(txt.archetype.toLowerCase());
  if (!at) throw new ImportProblem(`its archetype (${readable(txt.archetype.replace(/^Class_/i, ''))}) isn't one the planner has`, newer);
  const origin = gd.core.origins.find((o) => o.n.toLowerCase() === txt.origin.toLowerCase());
  if (!origin) throw new ImportProblem(`its origin (${txt.origin}) isn't one the planner has`, newer);
  const found = txt.powers.map((p) => ({ p, power: gd.powerByName.get(p.name.toLowerCase()) }));
  // the primary and secondary: the AT's own sets in those categories (a VEAT's branches are others)
  const mainSet = (cat: string) =>
    found.map((f) => (f.power ? gd.setOfPower.get(f.power.id)?.set : undefined)).find((s) => s && !s.spa && gd.categoryOfSet.get(s.id) === cat);
  const pri = mainSet(at.cats.pri);
  const sec = mainSet(at.cats.sec);
  if (!pri || !sec) throw new ImportProblem("the planner can't find its primary or secondary power set", newer);
  const level = Math.min(49, Math.max(0, txt.level - 1));
  const sched = gd.core.schedule.power;
  const b: Build = {
    v: 1,
    ...(gd.server !== DEFAULT_SERVER ? { server: gd.server } : {}), // read against this server's data, so it is its build
    dataVersion: gd.core.manifest.dataVersion,
    name: txt.name,
    at: at.id,
    origin: origin.id,
    alignment: 'Hero',
    primary: pri.id,
    secondary: sec.id,
    picks: sched.map(() => null),
    granted: {},
    ...(level < 49 ? { endLevel: level } : {}),
  };

  const toEnh = (s: TxtEnh, where: string): SlottedEnh | undefined => {
    const bp = gd.powerByName.get(`boosts.${s.name}.${s.name}`.toLowerCase());
    if (!bp || bp.type !== 'Boost') {
      warn.push(`${where}: an enhancement (${readable(s.name)}) isn't in the planner's game data, so its slot is empty`);
      return undefined;
    }
    const out: SlottedEnh = { boost: bp.id };
    // an IO keeps its own level (attuned ones follow the character); a TO/DO/SO/HO is relative
    // to the character; values the game wouldn't allow are kept and flagged by the build
    if (bp.bie) {
      if (!bp.bup) out.ioLevel = s.level - 1;
    } else if (s.level !== txt.level) out.rel = s.level - txt.level;
    if (s.boosters) out.boosters = s.boosters;
    return out;
  };
  // every slot at the power's level for now: finishBuildTxt gives the bought ones their levels
  const toSlots = (p: TxtPower, lvl: number, where: string): Slot[] =>
    p.slots.map((s) => {
      const enh = s ? toEnh(s, where) : undefined;
      return enh ? { level: lvl, enh } : { level: lvl };
    });

  const used = new Set<number>();
  const grants: { p: TxtPower; power: Power }[] = [];
  const buildCats = [at.cats.pri, at.cats.sec, at.cats.pool, at.cats.epic].map((c) => c.toLowerCase());
  for (const { p, power } of found) {
    if (!power) {
      const ours = buildCats.includes(p.name.split('.')[0]!.toLowerCase());
      if (ours || p.slots.some((s) => s)) warn.push(`${readablePower(p.name)} isn't in the planner's game data, so it was left out`);
      continue;
    }
    const ref = gd.setOfPower.get(power.id);
    if (!ref || power.auto || (ref.set.av[ref.index] ?? 0) < 0) {
      grants.push({ p, power });
      continue;
    }
    const lvl = Math.max(0, p.level - 1);
    // level 1's two picks: the primary's first (BuildRules.powerOption), whatever the file's order
    const want = lvl === sched[0] ? (ref.set.id === pri.id ? 0 : ref.set.id === sec.id ? 1 : -1) : -1;
    const idx = want >= 0 && !used.has(want) ? want : sched.findIndex((l, k) => l === lvl && !used.has(k));
    if (idx < 0) {
      warn.push(`${power.dn} was taken at level ${p.level}, which has no free power pick, so it was left out`);
      continue;
    }
    used.add(idx);
    b.picks[idx] = { power: power.id, level: lvl, slots: toSlots(p, lvl, power.dn) };
  }
  const granted = new BuildRules(gd, b).granted();
  for (const { p, power } of grants) {
    const lvl = granted.get(power.id);
    if (lvl === undefined) {
      if (p.slots.some((s) => s)) warn.push(`${power.dn} isn't part of a build in the planner, so its enhancements were left out`);
      continue;
    }
    if (p.slots.length > 1 || p.slots.some((s) => s)) b.granted[power.id] = { slots: toSlots(p, lvl, power.dn) };
  }

  const entries = new BuildRules(gd, b).entries();
  const short = leveledSlotShortfall(
    entries.map((e) => ({ level: e.level, count: Math.max(0, e.slots.length - 1) })),
    gd.core.schedule.slot.filter((s) => s <= level),
  );
  let leveledBlock: string | null = null;
  if (short) {
    const late = entries.filter((e) => e.level >= short.level && e.slots.length > 1);
    const from = short.level + 1;
    const who =
      late.length === 1 ? `${late[0]!.power.dn} (taken at level ${late[0]!.level + 1}) has ${short.need} added slots` : `Powers taken at level ${from} or later have ${short.need} added slots`;
    leveledBlock = `${who}, but leveling gives only ${short.have} slots from level ${from} on.`;
  }
  const summary = `${txt.name}: level ${txt.level} ${origin.dn} ${at.dn}, ${pri.dn} / ${sec.dn}`;
  return { build: b, level, summary, leveledBlock, warnings: warn };
}

/**
 * Finish a build.txt import with the user's choices: the alignment, and Respec (to the character's
 * level) or leveled. Either way each bought slot takes the lowest free slot level at or after its
 * power's level (lowestFreeLevels); a power keeps its slots in the game's order, levels ascending.
 *
 * @param gd Game data the build opens on.
 * @param imp The import (readBuildTxt).
 * @param opts The alignment, and whether the build is a Respec.
 * @return The build, ready for checkBuild / loadBuild.
 */
export function finishBuildTxt(gd: GameData, imp: TxtImport, opts: { alignment: Alignment; respec: boolean }): Build {
  const b = cloneBuild(imp.build);
  b.alignment = opts.alignment;
  if (opts.respec) b.respecTo = imp.level;
  const keys: string[] = [];
  const owned: number[] = [];
  for (const e of new BuildRules(gd, b).entries()) {
    for (let i = 1; i < e.slots.length; i++) {
      keys.push(e.key);
      owned.push(e.level);
    }
  }
  const levels = lowestFreeLevels(
    gd.core.schedule.slot.filter((s) => s <= imp.level),
    owned,
    imp.level,
  );
  const byKey = new Map<string, number[]>();
  keys.forEach((k, i) => byKey.set(k, [...(byKey.get(k) ?? []), levels[i]!]));
  for (const [key, lv] of byKey) {
    const ref = slotsFor(b, key);
    if (!ref) continue;
    lv.sort((x, y) => x - y);
    ref.set(ref.slots.map((s, i) => (i === 0 ? s : { ...s, level: lv[i - 1] ?? s.level })));
  }
  return b;
}
