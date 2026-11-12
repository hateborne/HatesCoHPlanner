import { describe, expect, it } from 'vitest';
import { setRarity } from '../src/engine/enhance.ts';
import { loadData, loadVersionIndex } from './helpers/data.ts';

/** IO set rarity comes from each set's Enhancement Converter group (BoostSet.conv). */
describe('IO set rarity', () => {
  it('every set in every published version has one', () => {
    for (const v of loadVersionIndex().versions) {
      const gd = loadData(v.id);
      const missing = gd.boostSets.filter((s) => !setRarity(s)).map((s) => s.n);
      expect(missing, `${v.id}: sets without a rarity`).toEqual([]);
    }
  });

  it('names each tier the way the game and the wiki do', () => {
    const gd = loadData();
    const rarity = (name: string) => {
      const set = gd.boostSets.find((s) => s.n === name);
      if (!set) throw new Error(`no set ${name}`);
      return setRarity(set);
    };
    expect(rarity('Bonesnap')).toEqual({ kind: 'uncommon', name: 'Uncommon' });
    expect(rarity('Salvo')).toEqual({ kind: 'rare', name: 'Rare' });
    expect(rarity('Apocalypse')).toEqual({ kind: 'veryRare', name: 'Very Rare' });
    expect(rarity('Gladiators_Javelin')).toEqual({ kind: 'pvp', name: 'PvP' });
    expect(rarity('Blasters_Wrath')).toEqual({ kind: 'archetype', name: 'Archetype Origin' });
    expect(rarity('Superior_Blasters_Wrath')).toEqual({ kind: 'superiorArchetype', name: 'Superior Archetype Origin' });
    expect(rarity('Avalanche')).toEqual({ kind: 'winter', name: 'Winter Pack' });
    expect(rarity('Superior_Avalanche')).toEqual({ kind: 'superiorWinter', name: 'Superior Winter Pack' });
    // the two event sets share one converter group; the event names are the wiki's
    expect(rarity('Overwhelming_Force')).toEqual({ kind: 'event', name: 'Event', event: 'Summer Blockbuster' });
    expect(rarity('Cupids_Crush')).toEqual({ kind: 'event', name: 'Event', event: 'Spring Event Wedding' });
  });
});
