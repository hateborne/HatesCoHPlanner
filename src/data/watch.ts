/**
 * Downloads the page waits for, watched: what tells one that stalled from one that is slow, asks
 * again for a file that gets no answer, and lets Try again give a stalled download up.
 *
 * Two rules keep a slow connection from being punished for being slow. Nothing is ever cancelled
 * by itself: a file that gets no answer is asked for a second time alongside the first (`ask`),
 * and whichever answers first is used, so the first keeps its place in line. And a download that
 * is receiving, however little, is never given up, not even by Try again.
 */

// How long the downloads behind one thing may receive nothing before they count as stalled: a file
// with no answer is then asked for again alongside (ask), and Try again may give them up.
export const STALLED_MS = 5_000;
// how many more times a file that gets no answer is asked for, alongside the asks still under way
export const EXTRA_ASKS = 2;

/**
 * A watch on the downloads one thing the page waits for stands on (a server's version list, a game
 * version's four files): when any of them last began or received something, and a way to give
 * them up.
 *
 * Quiet is judged over all its downloads together, not each alone: a slow connection may deliver
 * the files one after another, and a file waiting its turn looks just like one that stalled.
 *
 * Giving the downloads up takes two things, because a browser keeps one copy of a download under
 * way and hands it to every request for the same address: the requests are cancelled, and each
 * address still under way is noted (`asAgain`), so the next request for it goes past the browser's
 * cache instead of joining what is left of the old one. Without both, a file whose download
 * stalled could only be fetched again by reloading the page.
 */
export class Watch {
  // gives the downloads up: each request is tied to its signal
  private readonly stop = new AbortController();
  // when a download last began or received something, on the page's steady clock (the wall clock
  // can jump when the device sets its time)
  private heard = performance.now();
  // the addresses of its downloads still under way
  private readonly open = new Set<string>();
  // those of them whose bodies arrive where the watch can't hear (unheard)
  private readonly deaf = new Set<string>();

  /** @return The signal that says the downloads were given up. */
  get signal(): AbortSignal {
    return this.stop.signal;
  }

  /**
   * Note that a download starts (a sign of life: a full wait follows it).
   *
   * Asking for the same file again alongside is not one (ask): only what arrives is, or a file
   * that waits its turn behind another's extra asks would never be asked for again itself, and
   * Try again could not tell that nothing is coming.
   *
   * @param url Its address, with its query.
   */
  begin(url: string): void {
    this.open.add(url);
    this.heard = performance.now();
  }

  /** Note that something of a download has arrived: its answer, or more of its body. */
  received(): void {
    this.heard = performance.now();
  }

  /**
   * Note that a download's body arrives where the watch can't hear of it (a browser that can't
   * hand a body over in parts, or a body read in one go).
   *
   * Such a download can't be told from a stalled one, so while it is under way the watch is never
   * quiet: nothing of the watch's is asked for again or given up.
   *
   * @param url Its address, as given to `begin`.
   */
  unheard(url: string): void {
    if (this.open.has(url)) this.deaf.add(url);
    this.heard = performance.now();
  }

  /**
   * Note that a download has ended: all of it has arrived, or it has failed.
   *
   * @param url Its address, as given to `begin`.
   */
  end(url: string): void {
    this.open.delete(url);
    this.deaf.delete(url);
  }

  /**
   * How long until the downloads count as quiet.
   *
   * @param ms How long without a sign of life counts as quiet.
   * @return How long from now the downloads will have been quiet for that long, if nothing more
   *   arrives: 0 or less when they already have, and Infinity while one of them can't be heard.
   */
  quietIn(ms: number): number {
    if (this.deaf.size) return Infinity;
    return ms - (performance.now() - this.heard);
  }

  /**
   * Whether the downloads have gone quiet.
   *
   * @param ms How long without a sign of life counts as quiet.
   * @return Whether no download has begun or received anything for that long.
   */
  quiet(ms: number): boolean {
    return this.quietIn(ms) <= 0;
  }

  /**
   * Give the downloads up: each one still under way fails at once, and is asked for past the
   * browser's cache the next time (`asAgain`).
   */
  cancel(): void {
    for (const url of this.open) givenUp.add(url);
    this.stop.abort();
  }
}

// the addresses whose last download was given up while under way (Watch.cancel), until each is
// asked for again
const givenUp = new Set<string>();

/**
 * How to ask the browser for a file: past its cache, once, when the file's last download was given
 * up while under way.
 *
 * The browser may still hold that download (cancelling it is not instant, and what had arrived may
 * be kept), and a plain request for the same address would be handed it, stall and all. "reload"
 * fetches the file anew and replaces what the browser kept.
 *
 * @param url The file's address, with its query.
 * @return The fetch setting to add: `{ cache: 'reload' }`, or nothing.
 */
export function asAgain(url: string): { cache?: RequestCache } {
  return givenUp.delete(url) ? { cache: 'reload' } : {};
}

/**
 * Ask for a file under a watch, and ask again alongside while no answer comes.
 *
 * 1. The file is asked for (past the browser's cache when its last download was given up).
 * 2. While it has no answer, the watch has been quiet for STALLED_MS (nothing is arriving for any
 *    of the watch's files, so it is not waiting its turn behind them) and its own last ask is
 *    that old, it is asked for once more, past the browser's cache, at most EXTRA_ASKS times. No
 *    ask is cancelled for another: a connection that is only slow to answer loses nothing, not
 *    even its place in line. An extra ask is no sign of life for the watch: every file of its
 *    with no answer is asked for again at the same pace, and the watch stays quiet.
 * 3. The first answer to come is the file's; the other asks are let go of. From then on the
 *    download is its body, which is never asked for again by itself: a body that stalls part way
 *    is left to a connection that picks up again, or to Try again.
 *
 * The watch is told the download began and when its answer came; ending it is the caller's, once
 * the body is read (it is ended here when every ask fails).
 *
 * @param url The file's address, with its query.
 * @param watch The watch on the download: giving it up fails every ask, and the answer's body.
 * @param init Fetch settings for the first ask (the later ones differ in `cache` alone).
 * @return The first answer.
 * @raise What the last ask to fail failed with, when none answered (at once when given up).
 */
export function ask(url: string, watch: Watch, init: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const asks: AbortController[] = [];
    let live = 0; // asks with no answer yet
    let over = false; // an answer came, or every ask failed
    let asked = 0; // when the file was last asked for, on the steady clock
    let timer: ReturnType<typeof setTimeout> | undefined;

    // giving the watch up fails every ask, and the body of the answer that was used (so this
    // stays in place once an answer has come; it is taken off when every ask has failed)
    const givenUpToo = (): void => {
      for (const each of asks) each.abort();
    };
    watch.signal.addEventListener('abort', givenUpToo, { once: true });

    const one = (cache: { cache?: RequestCache }): void => {
      const mine = new AbortController();
      if (watch.signal.aborted) mine.abort();
      asks.push(mine);
      live++;
      asked = performance.now();
      fetch(url, { ...init, ...cache, signal: mine.signal }).then(
        (answer) => {
          live--;
          if (over) return; // another ask answered first: this one was let go of
          over = true;
          clearTimeout(timer);
          for (const other of asks) if (other !== mine) other.abort();
          watch.received();
          resolve(answer);
        },
        (why: unknown) => {
          live--;
          // an ask that fails while another is still out is not the download's failure
          if (over || live) return;
          over = true;
          clearTimeout(timer);
          watch.signal.removeEventListener('abort', givenUpToo);
          watch.end(url);
          reject(why);
        },
      );
    };

    // looks again when the watch would be quiet, and this file's last ask old enough, if nothing
    // more arrived
    const look = (): void => {
      if (over || watch.signal.aborted) return;
      const wait = Math.max(watch.quietIn(STALLED_MS), STALLED_MS - (performance.now() - asked));
      if (wait > 0) {
        timer = setTimeout(look, Math.max(1, Math.min(wait, STALLED_MS)));
        return;
      }
      if (asks.length > EXTRA_ASKS) return; // asked as often as it may be: left to end by itself
      one({ cache: 'reload' });
      timer = setTimeout(look, STALLED_MS);
    };

    watch.begin(url);
    one(asAgain(url));
    timer = setTimeout(look, STALLED_MS);
  });
}
