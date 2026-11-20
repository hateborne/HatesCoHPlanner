/**
 * The site's data files by their brotli copies, where the site has them.
 *
 * GitHub Pages sends a file gzip-compressed and can send nothing smaller. So its deploy puts a
 * brotli copy beside each data file (name.json.br, about a third of what gzip makes of it:
 * scripts/precompress.mjs) and marks the build (HCP_BROTLI=1). A browser that unpacks brotli itself
 * asks for the copy; any other browser, and any failure with a copy, gets the file as before.
 *
 * The site's own domain needs none of this: its web server sends brotli to every browser
 * (docs/hosting.md), so its build is not marked.
 */

// written in by vite.config.ts's define (HCP_BROTLI=1 at build time); missing where Vite doesn't
// compile the code, hence the typeof check
declare const __HCP_BROTLI__: boolean | undefined;

// Whether this build's site has a brotli copy beside each data file. Off in a dev server, the
// tests and every build but GitHub Pages', so nothing asks for copies that aren't there.
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
 * @return A successful answer holding the parsed JSON.
 * @raise Error (any) when the copy is missing, stalls for COPY_STALL_MS, or won't unpack or parse.
 */
async function viaCopy(url: string): Promise<Fetched> {
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
  alive();
  let read = false;
  try {
    const r = await Promise.race([fetch(url, { signal: stop.signal }), stalled]);
    alive();
    if (!r.ok || !r.body) throw new Error(`no copy (HTTP ${r.status})`);
    // a host that names the encoding has had the browser unpack the copy already
    const unpacked = /\bbr\b/i.test(r.headers.get('content-encoding') ?? '');
    const seen = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, to) {
        alive();
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
    // a copy given up is let go of: its answer is not left half read
    if (!read) stop.abort();
  }
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
 * @return The file's own answer, or a successful one holding the copy's parsed JSON.
 */
export async function fetchJson(url: string, query = '', copies: boolean = BROTLI_COPIES && unpacksBrotli()): Promise<Fetched> {
  if (copies) {
    try {
      return await viaCopy(`${url}.br${query}`);
    } catch {
      // the copy failed on its way, or is not what it should be: the file itself is asked for
    }
  }
  return fetch(url + query);
}
