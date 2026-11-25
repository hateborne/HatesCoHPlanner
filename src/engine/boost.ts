/**
 * The build's damage boosts, for the damage a power info shows: the character-wide damage
 * strength the totals count (set bonuses, running toggles and autos, clicks switched on such as
 * Build Up and Aim), the archetype's cap on it, and the tag modes and power modes its running
 * powers raise (Fiery Embrace, Rage).
 */
import type { GameData } from '../data/gamedata.ts';
import type { Effect } from '../data/types.ts';
import type { BuildRules } from './rules.ts';
import { computeTotals, lineCap, totalsState } from './totals.ts';

/** What a build adds to every attack's damage while the powers counted in its totals run. */
export interface DamageBoost {
  str: Map<number, number>; // damage attribute offset -> character-wide damage strength (0.8 = +80%), before the cap
  cap: Map<number, number>; // damage attribute offset -> the archetype's cap on 1 + enhancements + strength (5 = 500%)
  switchTags: readonly string[]; // tag modes a power switches, in lower case: their groups count only while raised
  tags: string[]; // those the running powers raise ('fieryembrace')
  switchModes: Set<string>; // power modes a power of the build sets (SetMode), in lower case: tested groups follow them
  modes: Set<string>; // those the running powers set ('unleashmight')
}

// The powers that raise a tag mode while they run, by the end of their full name (lower case) and
// the tag. The client data names the tag in the GlobalChanceMod's parameters, which the export
// doesn't keep, so the link is written here; the power must still carry a GlobalChanceMod.
const TAG_RAISERS: readonly (readonly [string, string])[] = [['.fiery_embrace', 'fieryembrace']];
const SWITCH_TAGS = TAG_RAISERS.map(([, tag]) => tag);

// damageBoost's answers per rules view, level and combat state: every tooltip of a build asks for the same one
const cache = new WeakMap<BuildRules, Map<string, DamageBoost>>();

/**
 * The damage boosts of a build at a level, from the powers its totals count.
 *
 * A click switched on counts as running, as in the totals. Formula-driven buffs (Fury, Defiance)
 * and chance procs are not counted there, so they are not here. The answer is kept per rules view
 * (one per build) and level.
 *
 * @param gd Game data.
 * @param rules Rules view of the build.
 * @param level 0-based level the boosts are worked out at.
 * @param outOfCombat Count the out-of-combat bonuses, as the totals' switch has it (default in combat).
 * @return The boosts.
 */
export function damageBoost(gd: GameData, rules: BuildRules, level: number, outOfCombat = false): DamageBoost {
  let byLevel = cache.get(rules);
  if (!byLevel) cache.set(rules, (byLevel = new Map()));
  const key = `${level}:${outOfCombat}`;
  let boost = byLevel.get(key);
  if (!boost) byLevel.set(key, (boost = workOut(gd, rules, level, outOfCombat)));
  return boost;
}

/** damageBoost, worked out afresh. */
function workOut(gd: GameData, rules: BuildRules, level: number, outOfCombat: boolean): DamageBoost {
  const at = rules.at;
  const totals = computeTotals(gd, rules, rules.b, level, outOfCombat);
  const str = new Map<number, number>();
  const cap = new Map<number, number>();
  for (let i = 0; i < gd.core.attribNames.Damage.length; i++) {
    const nn = String(i).padStart(2, '0');
    const off = gd.attribByName.get(`DamageType${nn}`);
    if (off === undefined) continue;
    str.set(off, totals.lines.get(`dmg.${nn}`)?.value ?? 0);
    cap.set(off, (lineCap(at, `dmg.${nn}`, level) ?? 4) + 1);
  }

  const st = totalsState(gd, rules, rules.b, level, outOfCombat);
  const chanceMod = gd.attribByName.get('GlobalChanceMod') ?? 484;
  const setMode = gd.attribByName.get('SetMode') ?? 473;
  const modeNames = gd.core.attribNames.Mode ?? [];
  const tags: string[] = [];
  const switchModes = new Set<string>();
  /** Collect the modes a power's groups set, whatever their chance or requirements. */
  const modesOf = (effs: Effect[] | undefined): void => {
    for (const g of effs ?? []) {
      for (const m of g.m ?? []) {
        const n = m.a.includes(setMode) && m.mag !== undefined ? modeNames[m.mag]?.n : undefined;
        if (n) switchModes.add(n.toLowerCase());
      }
      modesOf(g.sub);
    }
  };
  for (const e of st.entries) {
    const p = e.power;
    modesOf(p.eff);
    modesOf(p.act);
    if (!st.isOn(e)) continue;
    const lower = p.n.toLowerCase();
    for (const [end, tag] of TAG_RAISERS) {
      if (!lower.endsWith(end) || tags.includes(tag)) continue;
      const has = [...(p.eff ?? []), ...(p.act ?? [])].some((g) => (g.m ?? []).some((m) => m.a.includes(chanceMod)));
      if (has) tags.push(tag);
    }
  }
  const modes = new Set([...switchModes].filter((n) => st.ctx.inMode?.(n)));
  return { str, cap, switchTags: SWITCH_TAGS, tags, switchModes, modes };
}
