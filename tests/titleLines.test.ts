import { describe, expect, it } from 'vitest';
import { wrapTitle } from '../src/ui/titleLines.ts';

// the first line holds 25 characters (the app measures the font instead)
const fits25 = (s: string) => s.length <= 25;

describe('wrapTitle: a long title wraps onto a second line', () => {
  it('keeps a title that fits on one line', () => {
    expect(wrapTitle('This is a simple build', fits25)).toEqual(['This is a simple build', '']);
  });

  it('moves only the words past the end to the second line', () => {
    expect(wrapTitle('Simple Invuln/SS tankers build', fits25)).toEqual(['Simple Invuln/SS tankers', 'build']);
  });

  it('moves the word that crosses the end, without rebalancing the lines', () => {
    expect(wrapTitle('Very Simple Invuln/SS tankers build', fits25)).toEqual(['Very Simple Invuln/SS', 'tankers build']);
    expect(wrapTitle('Ill/Rad AV Soloer for Pylons and the ITF', fits25)).toEqual(['Ill/Rad AV Soloer for', 'Pylons and the ITF']);
  });

  it('breaks only at spaces, never at a slash', () => {
    expect(wrapTitle('Fire/Kin Farmer Invuln/SS-Tanker', fits25)).toEqual(['Fire/Kin Farmer', 'Invuln/SS-Tanker']);
  });

  it('measures with the given fit, not the character count', () => {
    // W is three wide: "WWWW AB" is 7 characters but 15 wide, so it does not fit 12
    const fits12 = (s: string) => Array.from(s).reduce((w, c) => w + (c === 'W' ? 3 : 1), 0) <= 12;
    expect(wrapTitle('WWWW AB CD', fits12)).toEqual(['WWWW', 'AB CD']);
  });

  it('cuts a first word too long for the line where it crosses the end', () => {
    expect(wrapTitle('Supercalifragilisticexpialidocious build', fits25)).toEqual(['Supercalifragilisticexpia', 'lidocious build']);
    expect(wrapTitle('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', fits25)).toEqual(['ABCDEFGHIJKLMNOPQRSTUVWXY', 'Z0123']);
  });

  it('collapses extra spaces and trims the title', () => {
    expect(wrapTitle('  Simple   Invuln/SS  tankers    build ', fits25)).toEqual(['Simple Invuln/SS tankers', 'build']);
    expect(wrapTitle('   ', fits25)).toEqual(['', '']);
  });
});
