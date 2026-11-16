/**
 * "Save in this browser" reminds the player that the build lives only in this browser and that a
 * bookmark of the page (whose address holds the build) keeps it safe.
 */
import { describe, expect, it } from 'vitest';
import { serverById, SERVERS } from '../src/data/servers.ts';
import { saveFailedText, saveReminder } from '../src/ui/screens/BuildMenu.tsx';

describe('saveReminder', () => {
  it('says the build is not on a server and asks for a bookmark', () => {
    for (const phone of [false, true]) {
      const r = saveReminder(phone);
      expect(r.title).toBe('Saved in this browser only');
      expect(r.text).toMatch(/not on any server/);
      expect(r.text).toMatch(/Bookmark this page now/);
      expect(r.text).toMatch(/^[\x20-\x7e\n]*$/); // ASCII only
    }
  });

  it('names the keyboard shortcut only where there is a keyboard', () => {
    expect(saveReminder(false).text).toContain('Ctrl+D');
    expect(saveReminder(true).text).not.toContain('Ctrl+D');
    expect(saveReminder(true).text).toContain("browser's menu");
  });
});

describe('saveFailedText', () => {
  it('names the Mids download only on a server whose menu offers it', () => {
    expect(saveFailedText(serverById('homecoming')!)).toContain('Download Mids .mbd');
    const thunderspy = serverById('thunderspy')!;
    expect(thunderspy.midsDb).toBeUndefined();
    expect(saveFailedText(thunderspy)).not.toMatch(/Mids/);
    for (const s of SERVERS) {
      const t = saveFailedText(s);
      expect(t).toContain('Copy share link');
      expect(t).toMatch(/^[\x20-\x7e]*$/); // ASCII only
    }
  });
});
