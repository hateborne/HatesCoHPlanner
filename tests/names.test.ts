/**
 * Everything a player picks has a name, on every server. Thunderspy's data writes some names straight
 * into the field instead of a message key (the client shows such text as written), and the export
 * once dropped them, so New Build offered sets and powers with blank names.
 */
import { describe, expect, it } from 'vitest';
import { SERVERS } from '../src/data/servers.ts';
import { startingSets } from '../src/engine/rules.ts';
import { loadData } from './helpers/data.ts';

describe.each(SERVERS.map((s) => [s.label, s.id] as const))('%s', (_, server) => {
  const gd = loadData(undefined, server);

  it('names every archetype', () => {
    const blank = gd.core.archetypes.filter((a) => !a.dn.trim()).map((a) => a.n);
    expect(blank).toEqual([]);
  });

  it('names every set New Build offers and every power a player picks from them, pools and epics too', () => {
    const blank: string[] = [];
    for (const at of gd.core.archetypes) {
      const sets = [
        ...startingSets(gd, at.cats.pri, at),
        ...startingSets(gd, at.cats.sec, at),
        ...[at.cats.pool, at.cats.epic].flatMap((c) => (c ? gd.setsInCategory(c) : [])),
      ];
      for (const s of sets) {
        if (!s.dn.trim()) blank.push(`${at.n}: set ${s.n}`);
        s.p.forEach((p, i) => {
          if ((s.av[i] ?? -1) >= 0 && !gd.power(p).dn.trim()) blank.push(`${at.n}: power ${gd.power(p).n}`);
        });
      }
    }
    expect([...new Set(blank)]).toEqual([]);
  });

  // a piece the client's text doesn't name is shown by its set and letter (GameData)
  it('names every enhancement set and every piece in it', () => {
    const blank: string[] = [];
    for (const bs of gd.boostSets) {
      if (!bs.dn.trim()) blank.push(`set ${bs.n}`);
      for (const variants of bs.slots) for (const id of variants) if (!gd.power(id).dn.trim()) blank.push(`piece ${gd.power(id).n}`);
    }
    expect(blank).toEqual([]);
  });
});
