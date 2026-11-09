/**
 * The client's own front-end sounds (sndPlay names from the UI source), with the mute switch
 * remembered per browser by the store.
 */
import { useStore } from '../state/store.ts';

export type SoundName = 'powerselect2' | 'next' | 'back' | 'reject5' | 'select5' | 'grab4' | 'delete' | 'tally' | 'changescreen';

const cache = new Map<SoundName, HTMLAudioElement>();

/** Play a UI sound unless muted (failures, e.g. autoplay rules or no Ogg support, are ignored). */
export function play(name: SoundName): void {
  if (useStore.getState().muted) return;
  try {
    let a = cache.get(name);
    if (!a) {
      a = new Audio(`${import.meta.env.BASE_URL}assets/sounds/${name}.ogg`);
      a.volume = 0.6;
      cache.set(name, a);
    }
    a.currentTime = 0;
    void a.play().catch(() => undefined);
  } catch {
    /* audio unavailable */
  }
}
