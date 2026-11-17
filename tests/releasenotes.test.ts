import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHANGELOG, releaseNotes, UPCOMING } from '../scripts/release-notes.mjs';

/** @return A changelog with these lines as its upcoming section, above one released section. */
const log = (...upcoming: string[]) => ['# Changelog', '', 'Intro text.', '', `## ${UPCOMING}`, '', ...upcoming, '', '## v1.0.0 - November 13, 2026', '', '- First public release.', ''].join('\n');

describe('releaseNotes', () => {
  it('gives the upcoming section under its group headings, and nothing from released sections', () => {
    const now = log('### New', '', '- A second server.', '- A version number.', '', '### Fixed', '', '- Old codes import.');
    expect(releaseNotes(now, '')).toBe('### New\n\n- A second server.\n- A version number.\n\n### Fixed\n\n- Old codes import.\n');
  });

  it('leaves out the lines the release before already had, wherever that copy holds them', () => {
    const before = log('### New', '', '- A second server.', '', '### Fixed', '', '- Old codes import.');
    // nobody moved the released lines under their version yet: only the added ones are new
    const unmoved = log('### New', '', '- A third server.', '- A second server.', '', '### Fixed', '', '- Old codes import.');
    expect(releaseNotes(unmoved, before)).toBe('### New\n\n- A third server.\n');
    // moved under their version meanwhile: the same answer
    const moved = ['# Changelog', '', `## ${UPCOMING}`, '', '### New', '', '- A third server.', '', '## v1.1.0', '', '### New', '', '- A second server.', ''].join('\n');
    expect(releaseNotes(moved, before)).toBe('### New\n\n- A third server.\n');
    // nothing added since
    expect(releaseNotes(before, before)).toBe('');
  });

  it('announces a line that repeats an earlier release word for word, once', () => {
    const before = log('### Fixed', '', '- Small fixes.');
    // moved under its version, and the next release has small fixes again
    const moved = ['## Unreleased', '', '### Fixed', '', '- Small fixes.', '', '## v1.1.0', '', '### Fixed', '', '- Small fixes.', ''].join('\n');
    expect(releaseNotes(moved, before)).toBe('### Fixed\n\n- Small fixes.\n');
    // not moved: the section holds the old line and the new one
    expect(releaseNotes(log('### Fixed', '', '- Small fixes.', '- Small fixes.'), before)).toBe('### Fixed\n\n- Small fixes.\n');
    // a released line taken out of the file announces nothing
    expect(releaseNotes(log('### Fixed', '', '- Another fix.'), log('### Fixed', '', '- Small fixes.', '- Another fix.'))).toBe('');
  });

  it('treats a rewrapped line as the same line, and a reworded one as new', () => {
    const before = log('### New', '', '- A second server, with its own archetypes.');
    const rewrapped = log('### New', '', '- A second server,', '  with its own   archetypes.');
    expect(releaseNotes(rewrapped, before)).toBe('');
    expect(releaseNotes(rewrapped, '')).toBe('### New\n\n- A second server, with its own archetypes.\n');
    expect(releaseNotes(log('### New', '', '- A second server, with its own powers.'), before)).toBe('### New\n\n- A second server, with its own powers.\n');
  });

  it('keeps lines above any group heading, and reads the section title in any case', () => {
    const now = ['## unreleased', '- Loose line.', '### Fixed', '- A fix.'].join('\r\n');
    expect(releaseNotes(now, '')).toBe('- Loose line.\n\n### Fixed\n\n- A fix.\n');
  });

  it('gives nothing for a file with no upcoming section, an empty one, or no file', () => {
    expect(releaseNotes('# Changelog\n\n## v1.0.0\n\n- First public release.\n', '')).toBe('');
    expect(releaseNotes(log(), '')).toBe('');
    expect(releaseNotes(log('### New', '', 'Not a list line.'), '')).toBe('');
    expect(releaseNotes('', '')).toBe('');
  });
});

describe('CHANGELOG.md', () => {
  const text = readFileSync(CHANGELOG, 'utf8');

  it('has the upcoming section pull requests add their lines to', () => {
    expect(text).toMatch(new RegExp(`^## ${UPCOMING}$`, 'm'));
  });

  it('is plain ASCII, like everything else written for the project', () => {
    // eslint-disable-next-line no-control-regex -- matching non-ASCII is the point
    expect(text).not.toMatch(/[^\x00-\x7f]/);
  });
});
