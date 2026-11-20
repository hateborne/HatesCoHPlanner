/**
 * Builds saved in this browser: the name a build is saved under, telling whether the open build is
 * saved as it is (so "Save it first" isn't said right after a save), and failing safe without storage.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, isSavedHere, savedName, saveFirstText } from '../src/io/library.ts';
import { newBuild } from '../src/engine/build.ts';
import { loadData, sid } from './helpers/data.ts';

const gd = loadData();
const build = (name: string) =>
  newBuild({
    dataVersion: gd.core.manifest.dataVersion,
    name,
    at: gd.archetypeByName.get('class_blaster')!.id,
    origin: gd.core.origins[0]!.id,
    alignment: 'Hero',
    primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
    secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
    pickCount: gd.core.schedule.power.length,
    server: gd.server,
  });

describe('saved builds', () => {
  it('saves a build without a name as "Unnamed build"', () => {
    expect(savedName(build(''))).toBe('Unnamed build');
    expect(savedName(build('Nova'))).toBe('Nova');
  });

  it('reads two copies of one build the same whatever order their fields were set in', () => {
    const a = build('Nova');
    const b = Object.fromEntries(Object.entries(a).reverse());
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(canonicalJson({ ...a, name: 'Other' })).not.toBe(canonicalJson(a));
    // a field left undefined reads as one left out
    expect(canonicalJson({ ...a, endLevel: undefined })).toBe(canonicalJson(a));
  });

  it('says a build is not saved, and to save it first, when the storage cannot be read', async () => {
    // no IndexedDB here: the check fails safe, and quickly
    expect(await isSavedHere(build('Nova'))).toBe(false);
    expect(await saveFirstText(build('Nova'))).toBe(' Save it first if you want to keep it.');
    expect(await saveFirstText(build('Nova'), 'Saved builds / Import')).toBe(' Save it first (Saved builds / Import) if you want to keep it.');
  });
});
