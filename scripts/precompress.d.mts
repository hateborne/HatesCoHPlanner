// Types and doc blocks for precompress.mjs (plain Node: the deploy runs it on the built site).

/** The file names that get pre-compressed copies: text, the WebAssembly module and the fonts. */
export declare const COMPRESSIBLE: RegExp;

/** The smallest file that gets copies, in bytes. */
export declare const MIN_BYTES: number;

/** The kinds of copy: "br" (brotli) and "gz" (gzip). */
export declare const FORMATS: readonly string[];

/**
 * Whether a file gets pre-compressed copies.
 *
 * @param name The file's name or path.
 * @param size Its size in bytes.
 * @return True for a compressible kind of file that is large enough to gain from it.
 */
export declare function wantsCopies(name: string, size: number): boolean;

/**
 * Write a brotli copy (name.br) and a gzip copy (name.gz) beside every file under a folder that
 * wants them, each at its format's best setting. The site's own domain gets both (its web server
 * hands out whichever a browser takes); a host that makes gzip itself needs brotli alone.
 *
 * A copy that would be no smaller than its file is not written. Copies left by an earlier run are
 * removed first, so running it again leaves exactly the copies the files as they are now call for
 * (none that outlived a change to its file), and a copy never gets copies of its own.
 *
 * @param dir The built site's folder.
 * @param formats The kinds of copy to write (both when omitted); a kind not asked for is still
 *   removed where an earlier run left it.
 * @return How many files got copies, and their bytes as they are, as gzip and as brotli (0 for a
 *   kind not written).
 * @raise Error for a kind of copy other than "br" or "gz", or none at all.
 */
export declare function precompress(dir: string, formats?: readonly string[]): Promise<{ files: number; bytes: number; br: number; gz: number }>;
