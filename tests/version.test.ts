import { describe, expect, it } from 'vitest';
import { APP_COMMIT, APP_VERSION, numericVersion, versionLabel } from '../src/version.ts';

describe('the planner version', () => {
  it('is "dev" outside a deploy', () => {
    expect(APP_VERSION).toBe('dev');
    expect(APP_COMMIT).toBe('');
    expect(versionLabel()).toBe('dev');
    expect(numericVersion()).toBe('0.0.0');
  });

  it('names a release by its number', () => {
    expect(versionLabel('1.2.0')).toBe('v1.2.0');
    expect(numericVersion('1.10.3')).toBe('1.10.3');
  });
});
