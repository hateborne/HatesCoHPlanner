import { describe, expect, it } from 'vitest';
import { fromOtherTab } from '../src/state/store.ts';

describe('switches changed in another tab', () => {
  it('leave this tab\'s Sound and Music alone', () => {
    // tabs comparing builds side by side must not all start (or stop) the music
    expect(fromOtherTab('hcp.music', '1')).toBeNull();
    expect(fromOtherTab('hcp.music', '0')).toBeNull();
    expect(fromOtherTab('hcp.muted', '1')).toBeNull();
    expect(fromOtherTab('hcp.muted', '0')).toBeNull();
  });

  it('still carry Tooltips over, falling back to Enabled for a value it does not know', () => {
    expect(fromOtherTab('hcp.tooltips', 'advanced')).toEqual({ tips: 'advanced' });
    expect(fromOtherTab('hcp.tooltips', 'disabled')).toEqual({ tips: 'disabled' });
    expect(fromOtherTab('hcp.tooltips', 'loud')).toEqual({ tips: 'enabled' });
  });

  it('reset only Tooltips when the site data is cleared', () => {
    expect(fromOtherTab(null, null)).toEqual({ tips: 'enabled' });
  });

  it('ignore the planner\'s other keys', () => {
    expect(fromOtherTab('hcp.current', '{}')).toBeNull();
  });
});
