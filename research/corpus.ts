/**
 * Reading a folder of community builds for the build research (research/builds.research.ts).
 *
 * Everything read here is data from outside: file names and contents are never repeated in what
 * the research writes, only counted.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { IMPORT_LIMITS } from '../src/io/limits.ts';

// the largest saved page read for share codes (a forum page with its markup)
const MAX_PAGE = 8_000_000;

/** One build as it was found: a .mbd file's text, or one Mids share code cut out of a text or page. */
export interface CorpusItem {
  kind: 'mbd' | 'code'; // a .mbd file, or a |MxDz; / |MBD; share code
  text: string; // what parseMidsText reads
  tags: string[]; // tagsOf its file's name
}

/** What reading the corpus left out, by reason. */
export interface CorpusSkips {
  tooBig: number; // files over the import size limit
  noCode: number; // text files and pages with no share code in them
  otherFiles: number; // files of a kind the research does not read
}

/**
 * The places named by the corpus setting.
 *
 * @param setting The HCP_BUILD_CORPUS value: folders and files, separated like PATH entries.
 * @return The entries, trimmed, empty ones dropped.
 */
export function corpusPaths(setting: string | undefined): string[] {
  return (setting ?? '')
    .split(delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
}

// file-name words that mark a specialised build: the report counts each, and all of them count in the values
const TAGS: readonly (readonly [tag: string, pattern: RegExp])[] = [
  ['farm', /farm/i],
  ['hard mode', /(^|[^a-z])(hm|hard[ _-]?mode|4[ _-]?star)([^a-z]|$)/i],
  ['cheap', /(^|[^a-z])(cheap|budget)([^a-z]|$)/i],
  ['pvp', /(^|[^a-z])pvp([^a-z]|$)/i],
  ['leveling', /(^|[^a-z])(level(l)?ing|exemp(lar)?)([^a-z]|$)/i],
];

/**
 * The kinds of specialised build a file name says it holds.
 *
 * @param fileName The file's name (never kept: only the tags leave this function).
 * @return The tags that apply, in TAGS order.
 */
export function tagsOf(fileName: string): string[] {
  return TAGS.filter(([, re]) => re.test(fileName)).map(([tag]) => tag);
}

/**
 * A saved web page as plain text: markup dropped and the few entities a forum post uses decoded,
 * so the share codes in it read as they were posted.
 *
 * @param html The page.
 * @return Its text.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/**
 * Every Mids share code in a text, each from its header line to the next code's header.
 *
 * @param text Plain text (a forum export, or htmlToText of a saved page).
 * @return One string per code, ready for parseMidsText.
 */
export function shareCodes(text: string): string[] {
  const heads = [...text.matchAll(/\|(MxDz|MBD);\d+;\d+;\d+;(HEX|BASE64);\|/g)].map((m) => m.index);
  return heads.map((at, i) => text.slice(at, heads[i + 1] ?? text.length));
}

/** @return Every file under a folder (or the file itself), in name order. */
function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => filesUnder(join(path, name)));
}

/**
 * Read every build the corpus setting names.
 *
 * .mbd files are builds as they are. Text files (.mxd, .txt) and saved pages (.html, .htm) are
 * searched for share codes. Anything else is counted and left alone.
 *
 * @param paths Folders and files (corpusPaths).
 * @return The builds found and what was left out.
 */
export function readCorpus(paths: string[]): { items: CorpusItem[]; skips: CorpusSkips } {
  const items: CorpusItem[] = [];
  const skips: CorpusSkips = { tooBig: 0, noCode: 0, otherFiles: 0 };
  for (const file of paths.flatMap(filesUnder)) {
    const ext = extname(file).toLowerCase();
    const page = ext === '.html' || ext === '.htm';
    if (ext !== '.mbd' && ext !== '.mxd' && ext !== '.txt' && !page) {
      skips.otherFiles++;
      continue;
    }
    if (statSync(file).size > (page ? MAX_PAGE : IMPORT_LIMITS.text)) {
      skips.tooBig++;
      continue;
    }
    const raw = readFileSync(file, 'utf-8');
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // a byte order mark is not part of the build
    const tags = tagsOf(file.split(/[\\/]/).pop() ?? '');
    if (ext === '.mbd') {
      items.push({ kind: 'mbd', text, tags });
      continue;
    }
    const codes = shareCodes(page ? htmlToText(text) : text);
    if (!codes.length) skips.noCode++;
    for (const code of codes) items.push({ kind: 'code', text: code, tags });
  }
  return { items, skips };
}
