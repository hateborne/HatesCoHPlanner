/**
 * Checking a build that came from outside the running app (browser storage, a share link, the
 * saved-builds list, an import) before it is used or saved again: anything the current game data
 * doesn't know is repaired where that is safe, and the build is rejected (the caller falls back to
 * a new build) only when its archetype, sets or origin are unknown.
 */
import type { GameData } from '../data/gamedata.ts';
import { DEFAULT_SERVER } from '../data/servers.ts';
import { cleanName, toAlignment, type Build, type Pick, type Slot, type SlottedEnh } from './build.ts';
import { BuildRules } from './rules.ts';

export interface Checked {
  build: Build | null; // null: unusable, start a new build
  fixes: string[]; // what was repaired (for a notice / the console)
}

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Validate and repair a build.
 *
 * @param gd The game data the build will be used with.
 * @param raw Anything (parsed JSON, a decoded link).
 * @return The usable build (a repaired copy) or null, and the repairs made.
 */
export function checkBuild(gd: GameData, raw: unknown): Checked {
  const fixes: string[] = [];
  const b = raw as Partial<Build> | null;
  if (!b || typeof b !== 'object') return { build: null, fixes: ['not a build'] };
  if (!isInt(b.at, 0, 1e9) || !gd.archetypeById.has(b.at)) return { build: null, fixes: ['unknown archetype'] };
  if (!isInt(b.primary, 0, 1e9) || !gd.setById.has(b.primary) || !isInt(b.secondary, 0, 1e9) || !gd.setById.has(b.secondary)) {
    return { build: null, fixes: ['unknown primary or secondary set'] };
  }
  if (!isInt(b.origin, 0, 1e9) || !gd.core.origins.some((o) => o.id === b.origin)) return { build: null, fixes: ['unknown origin'] };

  const sched = gd.core.schedule.power;
  // an enhancement's level, relative level and boosters: a value that isn't a whole number can't
  // come from the app or an import and is dropped; whole numbers out of range are kept, and the
  // build flags them (BuildRules.enhRefusal)
  const enhOk = (e: SlottedEnh, where: string): SlottedEnh => {
    const out: SlottedEnh = { boost: e.boost };
    for (const k of ['ioLevel', 'rel', 'boosters'] as const) {
      const v: unknown = e[k];
      if (v === undefined) continue;
      if (isInt(v, -1000, 1000)) out[k] = v;
      else fixes.push(`${where}: dropped a bad enhancement ${k}`);
    }
    return out;
  };
  const slotsOk = (slots: unknown, where: string): Slot[] => {
    if (!Array.isArray(slots)) return [];
    const out: Slot[] = [];
    for (const s of slots as Slot[]) {
      if (!s || !isInt(s.level, 0, 49)) {
        fixes.push(`${where}: dropped a bad slot`);
        continue;
      }
      const e = s.enh;
      if (e && (!isInt(e.boost, 1, 1e9) || gd.powerById.get(e.boost)?.type !== 'Boost')) {
        fixes.push(`${where}: removed an unknown enhancement`);
        out.push({ level: s.level });
      } else out.push(e ? { level: s.level, enh: enhOk(e, where) } : { level: s.level });
    }
    return out.slice(0, 6);
  };

  const rawPicks = Array.isArray(b.picks) ? b.picks : [];
  if (rawPicks.length !== sched.length) fixes.push(`picks: ${rawPicks.length} -> ${sched.length}`);
  const picks: (Pick | null)[] = sched.map((lvl, i) => {
    const p = rawPicks[i] as Pick | null | undefined;
    if (!p) return null;
    const pw = isInt(p.power, 1, 1e9) ? gd.powerById.get(p.power) : undefined;
    if (!pw || !gd.setOfPower.has(p.power)) {
      fixes.push(`pick ${i + 1}: removed an unknown power`);
      return null;
    }
    return { power: p.power, level: lvl, slots: slotsOk(p.slots, pw.dn), on: typeof p.on === 'boolean' ? p.on : undefined };
  });

  const granted: Build['granted'] = {};
  for (const [k, g] of Object.entries(b.granted && typeof b.granted === 'object' ? b.granted : {})) {
    const pid = Number(k);
    const pw = gd.powerById.get(pid);
    if (!pw || !g || typeof g !== 'object') {
      fixes.push('dropped settings for an unknown granted power');
      continue;
    }
    granted[pid] = { slots: slotsOk(g.slots, pw.dn), on: typeof g.on === 'boolean' ? g.on : undefined };
  }

  const out: Build = {
    v: 1,
    ...(gd.server !== DEFAULT_SERVER ? { server: gd.server } : {}), // tied to the data's server, like its version
    dataVersion: gd.core.manifest.dataVersion, // checked against (and from now on tied to) this game version's data
    name: cleanName(b.name),
    at: b.at,
    origin: b.origin,
    alignment: toAlignment(b.alignment),
    primary: b.primary,
    secondary: b.secondary,
    picks,
    granted,
    exemplar: isInt(b.exemplar, 0, 49) ? b.exemplar : undefined,
    endLevel: isInt(b.endLevel, 0, 49) ? b.endLevel : undefined,
    respecTo: isInt(b.respecTo, 0, 49) ? b.respecTo : undefined,
  };

  // A build left mid-way through leveling (no stop level, picks missing from some point on) is
  // treated as stopped just before its first missing pick, so it shows Continue Leveling.
  const firstMissing = picks.findIndex((p) => !p);
  if (out.endLevel === undefined && firstMissing >= 0) {
    // a respec asks level 1's secondary first, so there pick 1 may be made without pick 0
    if (out.respecTo === undefined ? firstMissing === 0 : !picks.some((p) => p)) return { build: null, fixes: [...fixes, 'no powers picked yet'] };
    out.endLevel = Math.max(0, sched[firstMissing]! - 1);
    fixes.push(`unfinished build: stopped at level ${out.endLevel + 1}`);
  }
  // last guard: the rules must be able to read it
  try {
    new BuildRules(gd, out).entries();
  } catch (e) {
    return { build: null, fixes: [...fixes, e instanceof Error ? e.message : String(e)] };
  }
  return { build: out, fixes };
}
