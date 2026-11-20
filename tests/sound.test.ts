/**
 * Sound and Music start off, and nothing of theirs is downloaded while they are off: the interface
 * sounds are fetched, all of them, only while Sound is on (ui/sound.ts loadSounds), and the menu
 * music is never among them.
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
async function page(stored: Record<string, string> = {}) {
  const asked: string[] = [];
  vi.stubGlobal('localStorage', memory(stored));
  vi.stubGlobal(
    'Audio',
    class {
      canPlayType = () => 'probably';
    },
  );
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(String(url).split('/').pop()!);
    return { ok: true, blob: async () => new Blob(['ogg']) };
  });
  vi.resetModules();
  const { useStore } = await import('../src/state/store.ts');
  const sound = await import('../src/ui/sound.ts');
  return { sound, useStore, asked };
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
