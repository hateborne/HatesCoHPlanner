/**
 * The site's data files' downloads (fetchJson), and their brotli copies where a site has them.
 *
 * GitHub Pages sends a file gzip-compressed and can send nothing smaller. A build marked
 * HCP_BROTLI=1 gets around that: its site has a brotli copy beside each data file (name.json.br,
 * about a third of what gzip makes of it: scripts/precompress.mjs), a browser that unpacks brotli
 * itself asks for the copy, and any other browser, and any failure with a copy, gets the file.
 *
 * No deploy marks its build today: the copies are switched off (docs/architecture.md, "Brotli
 * copies on GitHub Pages", says why and what to settle first). The site's own domain never needed
 * them: its web server sends brotli to every browser (docs/hosting.md).
 */
import { asAgain, ask, type Watch } from './watch.ts';

// written in by vite.config.ts's define (HCP_BROTLI=1 at build time); missing where Vite doesn't
// compile the code, hence the typeof check
declare const __HCP_BROTLI__: boolean | undefined;

// Whether this build's site has a brotli copy beside each data file. Off unless the build is
// marked (no deploy marks one today), so nothing asks for copies that aren't there.
export const BROTLI_COPIES: boolean = typeof __HCP_BROTLI__ === 'boolean' && __HCP_BROTLI__;

// How long a copy may go without a sign of life (its answer, a byte, its JSON after the last
// byte) before it is given up for the file. A copy that stalls, in a browser whose brotli turns out
// not to cope, must never keep a build from opening. It is long on purpose: a phone that loses its
// signal for a while should pick its download up again, not start over on the larger file.
export const COPY_STALL_MS = 30_000;

// the format's name for DecompressionStream: newer than TypeScript's list of them
const BROTLI = 'brotli' as CompressionFormat;

/** What the loader reads of a fetch's answer. */
export type Fetched = Pick<Response, 'ok' | 'status' | 'json'>;

/** @return Whether this browser unpacks brotli itself (DecompressionStream takes the format). */
export function unpacksBrotli(): boolean {
  try {
    new DecompressionStream(BROTLI);
    return true;
  } catch {
    return false; // no DecompressionStream here, or none for brotli
  }
}

/**
 * Fetch a brotli copy and read its JSON.
 *
 * @param url The copy's address, with its query.
 * @param watch The watch on this download, if it has one: told of its start, its end and every
 *   sign of life, and giving the download up gives the copy up.
 * @return A successful answer holding the parsed JSON.
 * @raise Error (any) when the copy is missing, stalls for COPY_STALL_MS, is given up, or won't
 *   unpack or parse.
 */
async function viaCopy(url: string, watch?: Watch): Promise<Fetched> {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let giveUp: (why: Error) => void = () => undefined;
  const stalled = new Promise<never>((_, reject) => (giveUp = reject));
  // called for every sign of life: the copy has another COPY_STALL_MS
  const alive = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stop.abort();
      giveUp(new Error('the copy stalled'));
    }, COPY_STALL_MS);
  };
  // the watch giving the download up ends the copy at once
  const givenUp = (): void => {
    stop.abort();
    giveUp(new Error('the download was given up'));
  };
  watch?.signal.addEventListener('abort', givenUp);
  if (watch?.signal.aborted) givenUp();
  watch?.begin(url);
  alive();
  let read = false;
  try {
    const r = await Promise.race([fetch(url, { signal: stop.signal, ...asAgain(url) }), stalled]);
    alive();
    if (!r.ok || !r.body) throw new Error(`no copy (HTTP ${r.status})`);
    watch?.received();
    // a host that names the encoding has had the browser unpack the copy already
    const unpacked = /\bbr\b/i.test(r.headers.get('content-encoding') ?? '');
    const seen = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, to) {
        alive();
        watch?.received();
        to.enqueue(chunk);
      },
    });
    const bytes = r.body.pipeThrough(seen);
    const text = unpacked ? bytes : bytes.pipeThrough(new DecompressionStream(BROTLI));
    const data: unknown = await Promise.race([new Response(text).json(), stalled]);
    read = true;
    return { ok: true, status: 200, json: () => Promise.resolve(data) };
  } finally {
    clearTimeout(timer);
    watch?.end(url);
    watch?.signal.removeEventListener('abort', givenUp);
    // a copy given up is let go of: its answer is not left half read
    if (!read) stop.abort();
  }
}

/**
 * Have a watch hear of each part of an answer's body as it comes in, and of the download's end.
 *
 * @param r The answer.
 * @param watch The watch.
 * @param at The download's address, as the watch was told it began.
 * @return The answer, its JSON read through the watch. A failed answer is returned as it came,
 *   its download over. Where the body can't be read in parts (an older browser) the watch is told
 *   it can't hear this download (Watch.unheard), and that it has ended once its JSON is read.
 */
export function heard(r: Response, watch: Watch, at: string): Fetched {
  if (!r.ok) {
    watch.end(at);
    return r;
  }
  const body = r.body;
  if (!body || typeof TransformStream !== 'function') {
    watch.unheard(at);
    return { ok: r.ok, status: r.status, json: () => r.json().finally(() => watch.end(at)) };
  }
  const seen = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, to) {
      watch.received();
      to.enqueue(chunk);
    },
    // the last of it has arrived (a body cut short or given up never gets here)
    flush() {
      watch.end(at);
    },
  });
  return { ok: r.ok, status: r.status, json: () => new Response(body.pipeThrough(seen)).json() };
}

/**
 * Fetch a JSON file of the site's, by its brotli copy when the site has copies and this browser
 * unpacks brotli itself.
 *
 * A copy that is missing, cut short, stalled, or won't unpack or parse is given up for the file
 * itself, asked for exactly as before there were copies. So a copy can make a load smaller, but
 * never make it fail, and never change what it reads.
 *
 * @param url The file's address, without its query.
 * @param query The query to ask with ("?v=<hash>", or "").
 * @param copies Whether to try the copy; omitted, the build's and the browser's own answer.
 * @param watch A watch on this download (watch.ts): it hears of what the download receives, the
 *   file is asked for again alongside while it gets no answer (ask), and giving the watch up fails
 *   the download at once. Omitted, the download is neither watched nor given up.
 * @return The file's own answer, or a successful one holding the copy's parsed JSON.
 */
export async function fetchJson(
  url: string,
  query = '',
  copies: boolean = BROTLI_COPIES && unpacksBrotli(),
  watch?: Watch,
): Promise<Fetched> {
  if (copies) {
    try {
      return await viaCopy(`${url}.br${query}`, watch);
    } catch (e) {
      // a download given up is over: the file is not asked for in the copy's place
      if (watch?.signal.aborted) throw e;
      // the copy failed on its way, or is not what it should be: the file itself is asked for
    }
  }
  if (!watch) return fetch(url + query);
  const at = url + query;
  return heard(await ask(at, watch), watch, at);
}
