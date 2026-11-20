import { describe, expect, it } from 'vitest';
import { ALLOWED, sortAdvisories, type AllowedAdvisory } from '../scripts/audit-dev.mjs';

// an npm audit report (npm 7 or later) as the development tools' audit reads it
const advisory = (name: string, ghsa: string, severity: string) => ({
  source: 1, name, title: `${name} advisory`, url: `https://github.com/advisories/${ghsa}`, severity, range: '<=1.0.0',
});
const report = (...vias: object[]) => ({
  vulnerabilities: {
    picomatch: { severity: 'high', via: vias },
    vite: { severity: 'high', via: ['picomatch', 'fdir'] }, // names another package: not an advisory itself
  },
});

// an allow-list as scripts/audit-dev.mjs keeps one (its own may be empty: the tests bring theirs)
const allowed: AllowedAdvisory[] = [
  { id: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch', added: '2026-11-17', why: 'Only the build and test tools use it, with the fixed patterns of our own config.' },
];

describe('the development tools audit', () => {
  it('lets the allowed advisory through and fails on any other high or critical one', () => {
    const r = sortAdvisories(report(advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high'), advisory('fdir', 'GHSA-2222-3333-4444', 'critical')), allowed);
    expect(r.allowed.map((a) => a.id)).toEqual(['GHSA-fc5q-39xc-vjpf']);
    expect(r.failing.map((a) => a.id)).toEqual(['GHSA-2222-3333-4444']);
    expect(r.stale).toEqual([]);
  });

  it('ignores moderate and low advisories, as --audit-level=high did', () => {
    expect(sortAdvisories(report(advisory('minimatch', 'GHSA-g3hv-75wg-m249', 'moderate'))).failing).toEqual([]);
  });

  it('names an allowed advisory that no longer shows up, so its entry can go', () => {
    expect(sortAdvisories({ vulnerabilities: {} }, allowed).stale).toEqual(['GHSA-fc5q-39xc-vjpf']);
    expect(sortAdvisories({ vulnerabilities: {} }).stale).toEqual(ALLOWED.map((a) => a.id));
    // with nothing allowed, the same advisory fails the check
    expect(sortAdvisories(report(advisory('picomatch', 'GHSA-fc5q-39xc-vjpf', 'high')), []).failing.map((a) => a.id)).toEqual(['GHSA-fc5q-39xc-vjpf']);
  });

  it('gives every allowed advisory its reason and the day it was allowed', () => {
    for (const a of ALLOWED) {
      expect(a.id).toMatch(/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/);
      expect(a.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.why.length).toBeGreaterThan(40);
    }
  });
});
