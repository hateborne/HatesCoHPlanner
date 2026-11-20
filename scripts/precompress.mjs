// Writes pre-compressed copies (name.br, name.gz) beside a built site's text files, for a web
// server that hands them out as they are (hosting/Caddyfile), so nothing is compressed per request.
// The API and its doc blocks are in precompress.d.mts; docs/hosting.md says where it is used.
// Plain Node with no dependencies. Usage: node scripts/precompress.mjs <folder>
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

// what compresses well: text, the WebAssembly module and the fonts (art and sounds are compressed
// already, and a copy of a copy is never made)
export const COMPRESSIBLE = /\.(html|js|mjs|css|json|svg|txt|xml|wasm|ttf)$/i;
// below this a copy saves next to nothing
export const MIN_BYTES = 1024;
// files compressed at a time (brotli at its best quality is slow, and each holds its file in memory)
const AT_ONCE = 4;
// a copy's name: its file's, with one of these after it
const COPY = /\.(br|gz)$/;

export function wantsCopies(name, size) {
  return COMPRESSIBLE.test(name) && size >= MIN_BYTES;
}

/**
 * List a folder's files, at any depth.
 *
 * @param dir The folder.
 * @return Every file under it, as full paths.
 */
async function filesUnder(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await filesUnder(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

export async function precompress(dir) {
  const all = await filesUnder(dir);
  const names = new Set(all);
  // A copy left by an earlier run goes first: one that outlived a change to its file would be
  // handed out in the file's place.
  const copies = new Set(all.filter((p) => COPY.test(p) && names.has(p.replace(COPY, ''))));
  for (const p of copies) await rm(p);
  const todo = [];
  for (const p of all) {
    if (copies.has(p)) continue;
    const { size } = await stat(p);
    if (wantsCopies(p, size)) todo.push(p);
  }
  const total = { files: 0, bytes: 0, br: 0, gz: 0 };
  const one = async (p) => {
    const data = await readFile(p);
    const [b, g] = await Promise.all([
      brotli(data, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
      gz(data, { level: constants.Z_BEST_COMPRESSION }),
    ]);
    // a copy no smaller than its file is not written: the server sends the file itself
    if (b.length < data.length) await writeFile(`${p}.br`, b);
    if (g.length < data.length) await writeFile(`${p}.gz`, g);
    total.files++;
    total.bytes += data.length;
    total.br += Math.min(b.length, data.length);
    total.gz += Math.min(g.length, data.length);
  };
  let next = 0;
  const worker = async () => {
    while (next < todo.length) await one(todo[next++]);
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return total;
}

// run as a script, not when a test imports it
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node scripts/precompress.mjs <folder>');
    process.exit(1);
  }
  const mb = (n) => (n / 1048576).toFixed(2);
  precompress(dir).then(
    (t) => console.log(`Pre-compressed ${t.files} files: ${mb(t.bytes)} MB as they are, ${mb(t.gz)} MB as gzip, ${mb(t.br)} MB as brotli.`),
    (e) => {
      console.error(`${process.env.GITHUB_ACTIONS ? '::error::' : ''}${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
