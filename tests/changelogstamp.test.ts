/**
 * The deploy's changelog stamp (scripts/changelog-stamp.mjs): after a new version is tagged, the
 * lines it shipped move from "## Unreleased" to "## vX.Y.Z - Month D, YYYY" on main, and nothing
 * else in the file changes (docs/releases.md, "The changelog").
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { releaseDate, stampChangelog } from '../scripts/changelog-stamp.mjs';
import { releaseNotes } from '../scripts/release-notes.mjs';

const HEAD = ['# Changelog', '', 'Intro text.', ''];
const OLD = ['## v1.0.0 - November 13, 2026', '', '- First public release.', ''];

/** @return A changelog with these lines as its upcoming section, above one released section. */
const log = (...upcoming: string[]) => [...HEAD, '## Unreleased', '', ...upcoming, ...(upcoming.length ? [''] : []), ...OLD].join('\n');

describe('stampChangelog', () => {
  it("puts the shipped lines under the version's heading below a fresh Unreleased", () => {
    const now = log('### New', '', '- A second server.', '- A version number.', '', '### Fixed', '', '- Old codes import.');
    const r = stampChangelog(now, now, '1.1.0', 'November 17, 2026');
    expect(r.outcome).toBe('stamped');
    expect(r.text).toBe(
      [...HEAD, '## Unreleased', '', '## v1.1.0 - November 17, 2026', '', '### New', '', '- A second server.', '- A version number.', '', '### Fixed', '', '- Old codes import.', '', ...OLD].join('\n'),
    );
  });

  it('leaves lines merged after the release under Unreleased, in their groups', () => {
    const released = log('### New', '', '- A second server.', '', '### Fixed', '', '- Old codes import.');
    const now = log('### New', '', '- A third server.', '- A second server.', '', '### Fixed', '', '- Old codes import.', '', '### Improved', '', '- Faster.');
    const r = stampChangelog(now, released, '1.1.0', 'November 17, 2026');
    expect(r.text).toBe(
      [
        ...HEAD,
        '## Unreleased',
        '',
        '### New',
        '',
        '- A third server.',
        '',
        '### Improved',
        '',
        '- Faster.',
        '',
        '## v1.1.0 - November 17, 2026',
        '',
        '### New',
        '',
        '- A second server.',
        '',
        '### Fixed',
        '',
        '- Old codes import.',
        '',
        ...OLD,
      ].join('\n'),
    );
    // the next release announces just what stayed
    expect(releaseNotes(r.text, released)).toBe('### New\n\n- A third server.\n\n### Improved\n\n- Faster.\n');
  });

  it('moves a repeated line only as many times as the release held it, and keeps wrapped lines whole', () => {
    const released = log('### Fixed', '', '- Small fixes.', '- A long line', '  that wraps.');
    const now = log('### Fixed', '', '- Small fixes.', '- Small fixes.', '- A long line', '  that wraps.');
    const r = stampChangelog(now, released, '1.1.0', 'November 17, 2026');
    expect(r.text).toBe([...HEAD, '## Unreleased', '', '### Fixed', '', '- Small fixes.', '', '## v1.1.0 - November 17, 2026', '', '### Fixed', '', '- Small fixes.', '- A long line', '  that wraps.', '', ...OLD].join('\n'));
  });

  it('never stamps a version twice, and does nothing when the release shipped no lines', () => {
    const now = log('### New', '', '- A second server.');
    const once = stampChangelog(now, now, '1.1.0', 'November 17, 2026');
    expect(stampChangelog(once.text, now, '1.1.0', 'November 18, 2026')).toEqual({ outcome: 'already', text: once.text });
    expect(stampChangelog(log(), log(), '1.1.0', 'November 17, 2026')).toEqual({ outcome: 'empty', text: log() });
    // lines taken out of the file since the release: nothing left to move
    expect(stampChangelog(log(), now, '1.1.0', 'November 17, 2026').outcome).toBe('empty');
    // "v1.1.0" is not "v1.1.0-something" nor "v1.1.00"
    expect(stampChangelog(now.replace('## v1.0.0', '## v1.1.00'), now, '1.1.0', 'x').outcome).toBe('stamped');
  });

  it('keeps a file with no released sections, CRLF line ends and other text', () => {
    const now = ['# Changelog', '', '## Unreleased', '', 'A note for players.', '', '- Untitled line.', ''].join('\r\n');
    const r = stampChangelog(now, now, '1.1.0', 'November 17, 2026');
    expect(r.text).toBe(['# Changelog', '', '## Unreleased', '', 'A note for players.', '', '## v1.1.0 - November 17, 2026', '', '- Untitled line.', ''].join('\n'));
  });

  it('refuses a malformed version and a file without Unreleased', () => {
    expect(() => stampChangelog(log(), log(), 'v1.1.0', 'x')).toThrow(/not a release's version/);
    expect(() => stampChangelog(OLD.join('\n'), log(), '1.1.0', 'x')).toThrow(/no "## Unreleased"/);
  });

  it("stamps the repository's own changelog, changing only its upcoming section", () => {
    const file = readFileSync('CHANGELOG.md', 'utf8');
    const withLine = file.replace('## Unreleased\n', '## Unreleased\n\n### Fixed\n\n- A fix.\n');
    const r = stampChangelog(withLine, withLine, '9.9.9', 'January 1, 2027');
    expect(r.text).toBe(file.replace('## Unreleased\n', '## Unreleased\n\n## v9.9.9 - January 1, 2027\n\n### Fixed\n\n- A fix.\n'));
  });
});

describe('releaseDate', () => {
  it("writes the release's day in the owner's time zone", () => {
    expect(releaseDate(new Date('2026-11-20T15:00:00Z'))).toBe('November 20, 2026');
    // 01:30 UTC is still the evening before in New York
    expect(releaseDate(new Date('2026-11-21T01:30:00Z'))).toBe('November 20, 2026');
  });
});
