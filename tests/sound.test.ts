/**
 * Sound and Music start off, and no download of theirs starts while they are off: the interface
 * sounds are fetched, all of them, only while Sound is on (ui/sound.ts loadSounds), and the menu
 * music is never among them. What starts the fetching is tested too: the Sound switch, and the
 * page coming up for a visitor who left Sound on.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startsMuted } from '../src/state/store.ts';

const SOUNDS = join(process.cwd(), 'public', 'assets', 'sounds');

/** @return A Storage stand-in backed by a map. */
function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/**
 * The sound module on a page whose browser plays Ogg, with what the browser has stored.
 *
 * @param stored The browser's stored switches (hcp.muted, hcp.music).
 * @return The module, the store and the sound files asked for so far.
 */
async function page(stored: Record<string, string> = {}, opts: { browser?: boolean; fetch?: (file: string) => Promise<unknown> } = {}) {
  const asked: string[] = [];
  const played: string[] = []; // what each sound played was made from
  vi.stubGlobal('localStorage', memory(stored));
  vi.stubGlobal(
    'Audio',
    class {
      volume = 1;
      paused = true;
      ended = false;
      currentTime = 0;
      constructor(readonly src = '') {}
      canPlayType = () => 'probably';
      addEventListener = () => undefined;
      pause = () => undefined;
      play = () => {
        played.push(this.src);
        return Promise.resolve();
      };
    },
  );
  vi.stubGlobal('fetch', async (url: string) => {
    const file = String(url).split('/').pop()!;
    asked.push(file);
    if (opts.fetch) await opts.fetch(file);
    return { ok: true, blob: async () => new Blob(['ogg']) };
  });
  // a browser's window, for the module to hook its switches up to (vitest's own has none)
  if (opts.browser) {
    vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined, setTimeout, clearTimeout });
    // and the address and session the store keeps in step once it has a window
    vi.stubGlobal('location', { pathname: '/', hash: '', search: '' });
    vi.stubGlobal('history', { state: null, replaceState: () => undefined });
    vi.stubGlobal('sessionStorage', memory());
  }
  vi.resetModules();
  const { useStore } = await import('../src/state/store.ts');
  const sound = await import('../src/ui/sound.ts');
  return { sound, useStore, asked, played };
}

describe('the switches as a page starts', () => {
  it('starts Sound off unless it was switched on in this browser', () => {
    expect(startsMuted(null)).toBe(true); // a first visit, or one that never touched the switch
    expect(startsMuted('1')).toBe(true);
    expect(startsMuted('0')).toBe(false);
    expect(startsMuted('yes')).toBe(true); // anything else it did not write
  });

  it('starts both off on a first visit, and as they were left after that', async () => {
    const first = await page();
    expect([first.useStore.getState().muted, first.useStore.getState().musicOn]).toEqual([true, false]);
    vi.unstubAllGlobals();
    const back = await page({ 'hcp.muted': '0', 'hcp.music': '1' });
    expect([back.useStore.getState().muted, back.useStore.getState().musicOn]).toEqual([false, true]);
    vi.unstubAllGlobals();
    const off = await page({ 'hcp.muted': '1', 'hcp.music': '0' });
    expect([off.useStore.getState().muted, off.useStore.getState().musicOn]).toEqual([true, false]);
  });

  it('remembers a switch for the next visit', async () => {
    const { useStore } = await page();
    useStore.getState().setMuted(false);
    useStore.getState().setMusicOn(true);
    expect([localStorage.getItem('hcp.muted'), localStorage.getItem('hcp.music')]).toEqual(['0', '1']);
  });
});

describe('the interface sounds', () => {
  it('are the sound files the site carries, without the menu music', async () => {
    const { sound } = await page();
    const files = readdirSync(SOUNDS).filter((f) => f.endsWith('.ogg'));
    const music = files.filter((f) => f.includes('menumusic'));
    expect(music.length).toBe(3);
    expect([...sound.UI_SOUNDS].sort()).toEqual(files.filter((f) => !music.includes(f)).map((f) => f.slice(0, -4)).sort());
    for (const n of sound.UI_SOUNDS) expect(existsSync(join(SOUNDS, `${n}.ogg`)), n).toBe(true);
  });

  it('are not downloaded while Sound is off', async () => {
    const { sound, asked } = await page();
    await sound.loadSounds();
    expect(asked).toEqual([]);
  });

  it('are all downloaded, once each, while Sound is on', async () => {
    const { sound, useStore, asked } = await page();
    useStore.getState().setMuted(false);
    await sound.loadSounds();
    expect([...asked].sort()).toEqual(sound.UI_SOUNDS.map((n) => `${n}.ogg`).sort());
    expect(asked.some((f) => f.includes('menumusic'))).toBe(false);
    await sound.loadSounds(); // again: nothing left to fetch
    expect(asked.length).toBe(sound.UI_SOUNDS.length);
  });

  it('stop downloading when Sound is switched off part way, and take up the rest when it is on again', async () => {
    const { sound, useStore, asked } = await page();
    useStore.getState().setMuted(false);
    const run = sound.loadSounds();
    useStore.getState().setMuted(true);
    await run;
    const first = asked.length;
    expect(first).toBeLessThan(sound.UI_SOUNDS.length);
    useStore.getState().setMuted(false);
    await sound.loadSounds();
    expect(new Set(asked).size).toBe(sound.UI_SOUNDS.length);
    expect(asked.length).toBe(sound.UI_SOUNDS.length); // none fetched twice
  });

  it('lose none when Sound is switched off and on again while downloads are still under way', async () => {
    // each download waits to be let through, so the switch can be flipped between them
    const waiting: (() => void)[] = [];
    const { sound, useStore, asked } = await page({}, { fetch: () => new Promise<void>((go) => waiting.push(go)) });
    const letThrough = async (n: number) => {
      for (const go of waiting.splice(0, n)) go();
      await new Promise((r) => setTimeout(r, 0));
    };
    useStore.getState().setMuted(false);
    const run = sound.loadSounds();
    await new Promise((r) => setTimeout(r, 0));
    expect(asked.length).toBe(4); // four at a time
    useStore.getState().setMuted(true);
    await letThrough(2); // two finish while Sound is off: they start no other
    expect(asked.length).toBe(4);
    useStore.getState().setMuted(false);
    void sound.loadSounds(); // the switch: a run is still under way, so this one starts nothing
    expect(asked.length).toBe(4);
    // the rest come through as they are asked for, to the last one
    for (let i = 0; i < sound.UI_SOUNDS.length + 8 && asked.length < sound.UI_SOUNDS.length; i++) await letThrough(4);
    await letThrough(4);
    await run;
    expect(new Set(asked).size).toBe(sound.UI_SOUNDS.length);
    expect(asked.length).toBe(sound.UI_SOUNDS.length); // each once
  });

  it('play from memory once fetched, and one heard before its turn is not fetched again', async () => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:fetched' }));
    const { sound, useStore, asked, played } = await page();
    useStore.getState().setMuted(false);
    sound.play('PowerSelect2'); // straight from the site: nothing is fetched ahead yet
    expect(played).toHaveLength(1);
    expect(played[0]).toMatch(/assets\/sounds\/powerselect2\.ogg$/);
    await sound.loadSounds();
    expect(asked).not.toContain('powerselect2.ogg');
    expect(asked.length).toBe(sound.UI_SOUNDS.length - 1);
    sound.play('n_select');
    expect(played[1]).toBe('blob:fetched');
    // switched off, nothing plays
    useStore.getState().setMuted(true);
    sound.play('n_error');
    expect(played).toHaveLength(2);
  });

  it("are not downloaded by a browser that can't play them", async () => {
    const { sound, useStore, asked } = await page();
    vi.stubGlobal(
      'Audio',
      class {
        canPlayType = () => '';
      },
    );
    useStore.getState().setMuted(false);
    await sound.loadSounds();
    expect(asked).toEqual([]);
  });
});

describe('what starts the fetching', () => {
  /** @return Once the fetches under way have settled. */
  const settled = () => new Promise((r) => setTimeout(r, 20));

  it('is the Sound switch: nothing before it, everything after', async () => {
    const { sound, useStore, asked } = await page({}, { browser: true });
    useStore.setState({ view: 'setup' }); // the page is up, Sound off as on a first visit
    await settled();
    expect(asked).toEqual([]);
    useStore.getState().setMusicOn(true); // Music alone fetches no interface sound
    await settled();
    expect(asked).toEqual([]);
    useStore.getState().setMuted(false);
    await settled();
    expect([...asked].sort()).toEqual(sound.UI_SOUNDS.map((n) => `${n}.ogg`).sort());
  });

  it('is the page coming up, for a visitor who left Sound on: not the loading or error screen', async () => {
    const { sound, useStore, asked } = await page({ 'hcp.muted': '0' }, { browser: true });
    expect(useStore.getState().view).toBe('loading');
    useStore.setState({ confirm: null }); // any other change while it loads
    useStore.setState({ view: 'error' });
    await settled();
    expect(asked).toEqual([]);
    useStore.setState({ view: 'loading' }); // Try again
    await settled();
    expect(asked).toEqual([]);
    useStore.setState({ view: 'setup' });
    await settled();
    expect(asked.length).toBe(sound.UI_SOUNDS.length);
    useStore.setState({ view: 'overview' }); // moving between screens fetches nothing more
    await settled();
    expect(asked.length).toBe(sound.UI_SOUNDS.length);
  });

  it('is nothing at all for a visitor who left Sound off', async () => {
    const { useStore, asked } = await page({ 'hcp.muted': '1', 'hcp.music': '0' }, { browser: true });
    useStore.setState({ view: 'setup' });
    useStore.setState({ view: 'overview' });
    await settled();
    expect(asked).toEqual([]);
  });
});
