import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_TITLE, tabTitle } from '../src/state/tabTitle.ts';

describe('tabTitle: the browser tab follows the build name', () => {
  it('names a named build "HCP: <name>", exactly as typed', () => {
    expect(tabTitle('Ill/Rad AV Soloer')).toBe('HCP: Ill/Rad AV Soloer');
    expect(tabTitle("Hate's <b>Tank</b> & co")).toBe("HCP: Hate's <b>Tank</b> & co");
  });

  it("keeps the app's own title for an unnamed build", () => {
    expect(tabTitle(undefined)).toBe(APP_TITLE);
    expect(tabTitle('')).toBe(APP_TITLE);
    expect(tabTitle('  \t\n ')).toBe(APP_TITLE);
  });

  it('cleans untrusted names: control characters, bidi controls, runs of whitespace', () => {
    expect(tabTitle('  Fire\n\tFarmer  ')).toBe('HCP: Fire Farmer');
    expect(tabTitle('A\u0000B\u007fC\u0085D')).toBe('HCP: A B C D');
    expect(tabTitle('evil\u202egnp.exe\u2066x\u2069\u200f')).toBe('HCP: evilgnp.exex');
    expect(tabTitle('\u202e\u0000')).toBe(APP_TITLE);
  });

  it('keeps non-ASCII letters and emoji in the name', () => {
    expect(tabTitle('Fl\u00e4mmchen \u{1F525}')).toBe('HCP: Fl\u00e4mmchen \u{1F525}');
  });

  it("matches index.html's title, which a page shows before any build loads", () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
    const m = /<title>([^<]*)<\/title>/.exec(html);
    expect(m?.[1]).toBe(APP_TITLE);
  });
});
