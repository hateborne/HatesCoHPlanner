/**
 * The client's own front-end sounds (sndPlay names from the UI source, lower-cased file names
 * under assets/sounds/) and the login-screen music, each with its own remembered on/off switch
 * in the store.
 */
import { useStore } from '../state/store.ts';
import type { SkinName } from './skin/skin.ts';

const cache = new Map<string, HTMLAudioElement>();
const missing = new Set<string>(); // names with no file (e.g. N_Archetype_Class_Sentinel)

function url(name: string): string {
  return `${import.meta.env.BASE_URL}assets/sounds/${name.toLowerCase()}.ogg`;
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
      a = new Audio(url(name));
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
    void a.play().catch(() => undefined);
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

// Browsers only start audio after a user gesture, so the music begins on the first click / key.
if (typeof window !== 'undefined') {
  const unlock = () => {
    if (unlocked) return;
    unlocked = true;
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    syncMusic();
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  useStore.subscribe((s, prev) => {
    if (s.musicOn !== prev.musicOn) syncMusic();
  });
}
