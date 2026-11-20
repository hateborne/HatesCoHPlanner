/**
 * The client's own front-end sounds (sndPlay names from the UI source, lower-cased file names
 * under assets/sounds/) and the login-screen music, each with its own remembered on/off switch
 * in the store.
 *
 * Both start off, and no download starts for a switch that is off. While Sound is on, every
 * interface sound is fetched ahead of its first play (loadSounds): at once when it is switched on,
 * and once the page is up for a visitor who left it on. The music has a track for each skin, and
 * each is fetched when it first plays.
 */
import { useStore } from '../state/store.ts';
import type { SkinName } from './skin/skin.ts';

// written in by vite.config.ts's define: the names of the interface sounds the site carries (the
// files under public/assets/sounds/ but the menu music); missing where Vite doesn't compile the code
declare const __HCP_UI_SOUNDS__: readonly string[] | undefined;

/** The interface sounds the site carries: file names without their extension, lower case. */
export const UI_SOUNDS: readonly string[] = typeof __HCP_UI_SOUNDS__ === 'undefined' ? [] : __HCP_UI_SOUNDS__;

const cache = new Map<string, HTMLAudioElement>();
const missing = new Set<string>(); // names with no file (e.g. N_Archetype_Class_Sentinel)
// sounds fetched ahead of their first play, each as an object URL of its bytes: played from memory,
// with no download and no cache check when first heard
const loaded = new Map<string, string>();
// sounds first heard straight from the site, before their turn to be fetched ahead: the browser
// has them by then, so they are not fetched a second time
const direct = new Set<string>();
// how many are fetched at a time, so they never crowd out the page's own downloads
const LOAD_AT_ONCE = 4;
let loading = false; // a loadSounds run is under way

function url(name: string): string {
  return `${import.meta.env.BASE_URL}assets/sounds/${name.toLowerCase()}.ogg`;
}

/** @return Whether this browser plays the sounds' format (Ogg Vorbis): one that can't is spared the downloads. */
function playsOgg(): boolean {
  try {
    return typeof Audio === 'function' && new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
  } catch {
    return false;
  }
}

/**
 * Fetch every interface sound not fetched yet, a few at a time, so none lags when it first plays.
 *
 * Only while Sound is on: called with it off it fetches nothing, and switched off part way it
 * starts no further download (the few under way finish), leaving the rest for the next time it is
 * on. A sound that fails to download is left for its first play, which fetches it as before.
 *
 * @return A promise settled when the run is over (for tests; callers don't wait).
 */
export function loadSounds(): Promise<void> {
  if (loading || useStore.getState().muted || !playsOgg()) return Promise.resolve();
  loading = true;
  const queue = UI_SOUNDS.filter((n) => !loaded.has(n) && !direct.has(n));
  const fetchNext = async (): Promise<void> => {
    // a name is taken only while Sound is on, so switching it off part way loses none
    while (queue.length && !useStore.getState().muted) {
      const name = queue.shift()!;
      if (direct.has(name)) continue;
      try {
        const r = await fetch(url(name));
        if (r.ok) loaded.set(name, URL.createObjectURL(await r.blob()));
      } catch {
        /* left for its first play */
      }
    }
  };
  return Promise.all(Array.from({ length: LOAD_AT_ONCE }, fetchNext)).then(() => {
    loading = false;
    // Sound was switched off and on again while this run was winding down (the switch found a run
    // under way and started none): what it left is taken up now
    if (queue.length && !useStore.getState().muted) return loadSounds();
  });
}

/**
 * Play a UI sound unless sounds are off (failures, e.g. autoplay rules, a missing file or no Ogg
 * support, are ignored -- the client also plays nothing for a name it has no file for).
 *
 * @param name Sound name, e.g. 'powerselect2', 'n_select', 'n_archetype_class_blaster'.
 * @param opts.noInterrupt sndPlayNoInterrupt: leave it alone if it is already playing.
 */
export function play(name: string, opts?: { noInterrupt?: boolean }): void {
  if (useStore.getState().muted || missing.has(name)) return;
  try {
    let a = cache.get(name);
    if (!a) {
      // from memory when it was fetched ahead, else straight from the site
      const ahead = loaded.get(name.toLowerCase());
      if (!ahead) direct.add(name.toLowerCase());
      a = new Audio(ahead ?? url(name));
      a.volume = 0.6;
      a.addEventListener('error', () => missing.add(name), { once: true });
      cache.set(name, a);
    }
    if (opts?.noInterrupt && !a.paused && !a.ended) return;
    a.currentTime = 0;
    void a.play().catch(() => undefined);
  } catch {
    /* audio unavailable */
  }
}

// ---- menu music ------------------------------------------------------------------------------

/**
 * The login-screen track for a skin: the Homecoming client plays H_MenuMusic_loop for the hero
 * skin, V_MenuMusic_loop for the villain skin and N_MenuMusic_loop otherwise (its uiLogin music
 * call branches on game_state.skin).
 */
const TRACK: Record<SkinName, string> = {
  hero: 'h_menumusic_loop',
  villain: 'v_menumusic_loop',
  praetorian: 'n_menumusic_loop',
};
const MUSIC_VOLUME = 0.35;

const tracks = new Map<string, HTMLAudioElement>();
let wanted = '';
let unlocked = false;

/** Start, switch or pause the music to match the wanted track and the Music switch. */
function syncMusic(): void {
  const on = unlocked && !!wanted && useStore.getState().musicOn;
  for (const [name, a] of tracks) if (!on || name !== wanted) a.pause();
  if (!on) return;
  try {
    let a = tracks.get(wanted);
    if (!a) {
      a = new Audio(url(wanted));
      a.loop = true;
      a.volume = MUSIC_VOLUME;
      tracks.set(wanted, a);
    }
    void a.play().catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'NotAllowedError') relock();
    });
  } catch {
    /* audio unavailable */
  }
}

/**
 * Choose the menu music for the skin on screen (each track resumes where it left off).
 *
 * @param skin The visible skin, or null for no music.
 */
export function setMusicSkin(skin: SkinName | null): void {
  wanted = skin ? TRACK[skin] : '';
  syncMusic();
}

// Browsers only start audio inside a user gesture, so the music begins on the first one. Phones
// do not count a touch's pointerdown as one (only its pointerup / touchend / click), so starting
// on pointerdown left them silent until the Music switch was flipped.
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

function listenForGesture(on: boolean): void {
  for (const g of GESTURES) {
    if (on) window.addEventListener(g, unlock, true);
    else window.removeEventListener(g, unlock, true);
  }
}

function unlock(): void {
  if (unlocked) return;
  unlocked = true;
  listenForGesture(false);
  syncMusic();
}

/** The browser refused to start the music (no gesture yet): wait for the next one. */
function relock(): void {
  if (!unlocked) return;
  unlocked = false;
  listenForGesture(true);
}

/** @return Whether a view shows the planner itself (its own downloads are done). */
const pageUp = (view: string) => view !== 'loading' && view !== 'error';

if (typeof window !== 'undefined') {
  listenForGesture(true);
  useStore.subscribe((s, prev) => {
    if (s.musicOn !== prev.musicOn) syncMusic();
    // Sound switched on; or left on by an earlier visit, once the page is up (its downloads first)
    if (!s.muted && (prev.muted || (pageUp(s.view) && !pageUp(prev.view)))) void loadSounds();
  });
}
