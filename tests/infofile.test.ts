/**
 * A version's power-info extras file (info/<version>.json, the pipeline's Exporter.build_info):
 * taken only whole and well formed, fetched beside the version folders without being waited for,
 * and what it changes in the power info: the effects' own notes, the client's wording, the grants
 * it doesn't list, the "Aggro Type" row, and Thunderspy's PvP-only groups (the owner's screenshots,
 * November 17, 2026).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameData, INFO_FOLDER, loadGameData } from '../src/data/gamedata.ts';
import { serverById } from '../src/data/servers.ts';
import type { GameVersion } from '../src/data/versions.ts';
import { powerInfo, segText } from '../src/engine/powerinfo.ts';
import { dataDir, loadData, loadVersionIndex } from './helpers/data.ts';

type Rec = Record<string, unknown>;

const raw = (server = 'homecoming', id = 'i28p4'): Rec => JSON.parse(readFileSync(join(dataDir(server), INFO_FOLDER, `${id}.json`), 'utf-8')) as Rec;
const fresh = () => {
  const gd = loadData('i28p4');
  return new GameData({ core: gd.core, powersets: [...gd.setById.values()], powers: [...gd.powerById.values()], boosts: { boosts: gd.boosts, bonusPowers: gd.bonusPowers, sets: gd.boostSets } });
};

/** @return A power's lines (with notes) and its target rows, at level 50 unenhanced. */
function show(gd: GameData, cls: string, name: string, level = 49) {
  const pi = powerInfo(gd, gd.archetypeByName.get(cls)!, gd.powerByName.get(name)!, level, null);
  return {
    lines: pi.effects.map((e) => [segText(e.line), ...e.notes.map(segText)].join(' / ')),
    rows: Object.fromEntries(pi.target.map((r) => [r.label, segText(r.value)])),
  };
}

/** Run with the version's info file left out. */
function without<T>(gd: GameData, run: () => T): T {
  const kept = gd.info;
  gd.info = null;
  try {
    return run();
  } finally {
    gd.info = kept;
  }
}

describe('the info file is taken only whole and well formed', () => {
  it("takes every published version's file", () => {
    expect(fresh().setInfo(raw(), 'i28p4')).toBe(true);
    expect(fresh().setInfo(raw('homecoming', 'i28p3'), 'i28p3')).toBe(true);
    expect(loadData('ts9-6', 'thunderspy').info?.groups?.['Warshade_Defensive.Umbral_Aura.Twilight_Shield']).toBeDefined();
  });

  it('refuses a file with any part malformed', () => {
    const breaks: ((f: Rec) => void)[] = [
      (f) => ((f.notes as Rec)['Stalker_Melee.Electrical_Melee.Lightning_Clap'] = { e: [{ m: [5] }] }),
      (f) => ((f.notes as Rec)['Stalker_Melee.Electrical_Melee.Lightning_Clap'] = { e: 'x' }),
      (f) => (f.hiddenGrants = 'Temporary_Powers.Temporary_Powers.Assassins_Focus'),
      (f) => ((f.aggro as Rec)['Inherent.Inherent.Vulnerability'] = 1),
      (f) => ((f.attr as Rec)['328'] = null),
      (f) => delete f.text,
      (f) => (f.groups = { 'Pool.Flight.Hover': { eff: [{ m: [{ a: 8 }] }] } }),
      (f) => delete f.version,
    ];
    for (const b of breaks) {
      const gd = fresh();
      const f = raw();
      b(f);
      expect(gd.setInfo(f, 'i28p4')).toBe(false);
      expect(gd.info).toBeNull();
    }
  });

  it("refuses another version's file (one copied to the wrong place)", () => {
    const gd = fresh();
    expect(gd.setInfo(raw('homecoming', 'i28p3'), 'i28p4')).toBe(false);
    expect(gd.info).toBeNull();
  });

  it('finds nothing under a name objects carry anyway, and tells those waiting', () => {
    const gd = fresh();
    let heard = 0;
    const stop = gd.subscribeInfo(() => heard++);
    gd.setInfo({ nope: true }, 'i28p4');
    expect(heard).toBe(0);
    gd.setInfo(raw(), 'i28p4');
    expect(heard).toBe(1);
    expect(gd.info!.notes['constructor']).toBeUndefined();
    expect(gd.info!.aggro['toString']).toBeUndefined();
    stop();
    gd.setInfo(raw(), 'i28p4');
    expect(heard).toBe(1);
  });
});

describe('loading the info file', () => {
  const server = serverById('homecoming')!;
  const version = loadVersionIndex().versions.find((v) => v.id === 'i28p4') as GameVersion;
  afterEach(() => vi.unstubAllGlobals());

  it('asks for it beside the version folders, after the version, and opens without it', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(String(url));
      if (String(url).includes(`/${INFO_FOLDER}/`)) return new Response('nope', { status: 404 });
      const path = String(url).split('?')[0]!.replace(/^.*?\/data\//, '');
      return new Response(readFileSync(join(dataDir(), path)));
    });
    const gd = await loadGameData(server, '/x/', version);
    expect(asked).toContain(`/x/data/${INFO_FOLDER}/i28p4.json?v=${version.hash}`);
    expect(asked.findIndex((u) => u.includes(`/${INFO_FOLDER}/`))).toBeGreaterThanOrEqual(4);
    await new Promise((r) => setTimeout(r, 0));
    expect(gd.info).toBeNull();
    expect(gd.powerByName.has('inherent.inherent.vulnerability')).toBe(true);
  });
});

describe('what the info file changes in the power info', () => {
  const hc = loadData('i28p4');
  const ts = loadData('ts9-6', 'thunderspy');

  it("lists no grant of a power the client keeps out of the inventory (Crushing Uppercut's Assassin's Focus)", () => {
    const cu = (gd: GameData) => show(gd, 'class_stalker', 'stalker_melee.brawling.crushing_uppercut').lines;
    expect(cu(hc).some((l) => l.includes("Assassin's Focus"))).toBe(false);
    expect(without(hc, () => cu(hc))).toContain("Grants power Assassin's Focus");
  });

  it('adds the "Aggro Type" row (Vulnerability, Homecoming, in game)', () => {
    const v = show(hc, 'class_sentinel', 'inherent.inherent.vulnerability', 1).rows;
    expect(v['Aggro Type:']).toBe('Enemies will not notice this attack');
    expect(without(hc, () => show(hc, 'class_sentinel', 'inherent.inherent.vulnerability', 1).rows['Aggro Type:'])).toBeUndefined();
  });

  it("writes the client's names and note texts, else the planner's", () => {
    const hob = (gd: GameData) => show(gd, 'class_sentinel', 'sentinel_ranged.dual_pistols.hail_of_bullets').lines;
    expect(hob(hc)).toContain('10.00% chance for 0.40 magnitude knock for 2.30s on target / Only using Standard Ammo / Within 20ft radius');
    expect(without(hc, () => hob(hc))).toContain('10.00% chance for 0.40 magnitude knockback for 2.30s on target / Only using Standard Ammo');
  });

  it("says Overpower through the effect's own note (Shadow Field's pet, as in game), once", () => {
    const sf = show(hc, 'class_controller', 'controller_control.darkness_control.shadow_field').lines;
    expect(sf).toContain('20.00% chance for 1.00 magnitude hold for 48.00s on target / Overpower');
    expect(sf.filter((l) => l.includes('Overpower'))).toHaveLength(1);
  });

  it('keeps the planner\'s "Overpower" note for a power the file gives no notes (its groups differed)', () => {
    const pet = 'Villain_Pets.Shadow_Field.Shadow_Field_Hold_Controller';
    const kept = hc.info!.notes[pet];
    delete hc.info!.notes[pet];
    try {
      const sf = show(hc, 'class_controller', 'controller_control.darkness_control.shadow_field').lines;
      expect(sf).toContain('20.00% chance for 1.00 magnitude hold for 48.00s on target / Overpower');
    } finally {
      hc.info!.notes[pet] = kept!;
    }
  });

  it("lists Thunderspy's PvP-only groups as its client does (Twilight Shield, in game: 14 lines)", () => {
    const tw = show(ts, 'class_warshade', 'warshade_defensive.umbral_aura.twilight_shield').lines;
    expect(tw).toHaveLength(14);
    expect(tw.slice(7, 10)).toEqual([
      '10.00 knockback protection on self / Ignores buffs and enhancements / unresistable',
      '10.00 knockup protection on self / Ignores buffs and enhancements / unresistable',
      '10.00 repel protection on self / Ignores buffs and enhancements / unresistable',
    ]);
    expect(tw.at(-1)).toBe('93.42% resistance to immobilize on self / Ignores buffs and enhancements');
    expect(without(ts, () => show(ts, 'class_warshade', 'warshade_defensive.umbral_aura.twilight_shield').lines)).toHaveLength(7);
  });
});
