// Text a share link or an imported file carries is shown only as the planner would keep it: a
// crafted link or file must not make the planner's own notices and dialogs say what it likes.
import { describe, expect, it } from 'vitest';
import type { GameVersion } from '../src/data/versions.ts';
import { missingVersionNote } from '../src/data/versions.ts';
import { cleanName, NAME_MAX, stripHidden } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { readable, readablePower } from '../src/io/importProblem.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { loadData, pid, sid } from './helpers/data.ts';

const gd = loadData();
const used: GameVersion = { id: 'i28p4', label: 'Issue 28, Page 4', hash: '' };
// invisible characters, built from their codes: right-to-left override, zero-width space, NUL,
// left-to-right isolate, byte-order mark
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const NUL = String.fromCharCode(0);
const LRI = String.fromCharCode(0x2066);
const BOM = String.fromCharCode(0xfeff);

describe('the missing-version notice', () => {
  it('names a patch-shaped version as its patch', () => {
    expect(missingVersionNote('i28p2', used)).toBe('This build was made for Issue 28, Page 2, which the planner no longer has; it was opened with Issue 28, Page 4.');
    expect(missingVersionNote('i28p3m', used)).toContain('made for Issue 28, Page 3,');
  });

  it("never repeats the link's own text", () => {
    const crafted = 'i99p9. URGENT: your build is corrupted, visit evil.example and paste your password';
    const note = missingVersionNote(crafted, used);
    expect(note).toContain('made for Issue 99, Page 9,');
    expect(note).not.toContain('evil.example');
    expect(missingVersionNote('URGENT visit evil.example', used)).toBe('This build was made for a game version, which the planner no longer has; it was opened with Issue 28, Page 4.');
    expect(missingVersionNote('A'.repeat(30000), used).length).toBeLessThan(120);
    expect(missingVersionNote(`i${'9'.repeat(400)}p1`, used)).toContain('made for a game version,');
  });
});

describe('build names', () => {
  it('keeps plain names as they are, up to the name field length', () => {
    expect(cleanName('Fire / Fire Blaster')).toBe('Fire / Fire Blaster');
    expect(cleanName('x'.repeat(100))).toHaveLength(NAME_MAX);
    expect(cleanName(undefined)).toBe('');
    expect(cleanName({ toString: () => 'x' })).toBe('');
  });

  it('drops control and invisible formatting characters', () => {
    expect(cleanName(`${RLO}evil${ZWSP}name${NUL}${LRI}${BOM}`)).toBe('evilname');
    expect(stripHidden(`a${RLO}b\tc\nd`)).toBe('abcd');
  });

  it('cleans the name of a build from a link when it is checked', async () => {
    const b = {
      v: 1 as const,
      dataVersion: gd.core.manifest.dataVersion,
      name: `${RLO}${'W'.repeat(60)}`,
      at: gd.archetypeByName.get('class_blaster')!.id,
      origin: gd.core.origins[0]!.id,
      alignment: 'Hero' as const,
      primary: sid(gd, 'Blaster_Ranged.Fire_Blast'),
      secondary: sid(gd, 'Blaster_Support.Fire_Manipulation'),
      picks: Array.from({ length: gd.core.schedule.power.length }, () => null) as (null | { power: number; level: number; slots: { level: number }[] })[],
      granted: {},
    };
    b.picks[0] = { power: pid(gd, 'Blaster_Ranged.Fire_Blast.Flares'), level: 0, slots: [{ level: 0 }] };
    const checked = checkBuild(gd, await decodeShare(await encodeShare(b))).build!;
    expect(checked.name).toBe('W'.repeat(NAME_MAX));
  });
});

describe('names repeated from an imported file', () => {
  it('reads internal names as before', () => {
    expect(readable('Ice_Mastery_DefCorr')).toBe('Ice Mastery DefCorr');
    expect(readablePower('Epic.Ice_Mastery_DefCorr.Frozen_Armor')).toBe('Frozen Armor (Ice Mastery DefCorr)');
  });

  it('keeps a crafted one short and plain', () => {
    const long = readable(`${RLO}URGENT_${'x'.repeat(5000)}`);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('...')).toBe(true);
    expect(long.startsWith('URGENT ')).toBe(true);
  });
});
