/**
 * The local build check's comparison (tests/helpers/localbuilds.ts): the check itself reads a
 * folder only one machine has, so the part that decides what counts as a difference is tested here.
 */
import { describe, expect, it } from 'vitest';
import { localChanges, type LocalEntry } from './helpers/localbuilds.ts';

// a build that opened, as its digests
const opened: LocalEntry = { build: 'b1', link: 'l1', reopened: 'b1', numbers: 'n1', notes: 'w1' };

describe('localChanges', () => {
  it('finds nothing between two records that agree', () => {
    expect(localChanges({ a: opened, b: { problem: 'import problem: x' } }, { a: { ...opened }, b: { problem: 'import problem: x' } })).toEqual([]);
  });

  it('lists a build under the first part of it that differs', () => {
    const before = { numbers: opened, link: opened, both: opened };
    const now = { numbers: { ...opened, numbers: 'n2' }, link: { ...opened, link: 'l2' }, both: { ...opened, link: 'l2', numbers: 'n2' } };
    expect(localChanges(before, now)).toEqual([
      { what: 'numbers', ids: ['numbers'] },
      { what: 'link', ids: ['link', 'both'] },
    ]);
  });

  it('says a build that stopped opening is a problem, not changed numbers', () => {
    expect(localChanges({ a: opened }, { a: { problem: 'planner fault: x' } })).toEqual([{ what: 'problem', ids: ['a'] }]);
  });

  it('says a build that now opens, or fails another way, differs too', () => {
    expect(localChanges({ a: { problem: 'import problem: x' }, b: { problem: 'import problem: x' } }, { a: opened, b: { problem: 'import problem: y' } })).toEqual([{ what: 'problem', ids: ['a', 'b'] }]);
  });

  it('lists the builds only one record has', () => {
    expect(localChanges({ a: opened, old: opened }, { a: opened, fresh: opened })).toEqual([
      { what: 'gone', ids: ['old'] },
      { what: 'new', ids: ['fresh'] },
    ]);
  });
});
