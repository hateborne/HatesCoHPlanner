/**
 * The recorded corpus, its files: what each release of the planner wrote for a build (its share
 * link, the build as it kept it in the browser, its Mids exports), with the release tags that wrote
 * it (tests/recordedcorpus.test.ts; tests/corpus/ records it).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { digest } from './golden.ts';

// where the corpus is kept
export const CORPUS_DIR = join(process.cwd(), 'tests', 'fixtures', 'corpus');

/** A share link some releases wrote for a build, and the build they themselves opened it as. */
export interface LinkVariant {
  tags: string[]; // the releases that wrote exactly this link for the build
  link: string; // the share code
  opens: string; // the digest (buildDigest) of the build those releases opened the link as
}

/** A build as some releases held it, which is also what they kept of it in the browser. */
export interface StoredVariant {
  tags: string[]; // the releases that held exactly this for the build
  build: unknown; // the build, as their JSON
}

/** The Mids exports some releases wrote for a build. */
export interface MidsVariant {
  tags: string[]; // the releases that wrote exactly these for the build
  mxdz: string; // the legacy Mids code, as text
  mbd?: unknown; // the .mbd export, for the builds it is recorded for
  // the digest of the build each export opened as on main when it was recorded (Mids export is best
  // effort, and its reader has been corrected since those releases, so main is the measure)
  opens: { mxdz: string; mbd?: string };
}

/** A corpus file: per "<server>/<game version>", per build name, the variants on record. */
export type Corpus<Variant> = Record<string, Record<string, Variant[]>>;

/**
 * A value as JSON that does not depend on the order its fields were set in.
 *
 * @param value Plain data (a build as JSON holds it).
 * @return Its JSON with every object's keys in alphabetical order and undefined fields left out.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item ?? null)).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value ?? null);
  const fields = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  return `{${fields.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

/**
 * A short digest of a build, the same for two builds that hold the same things.
 *
 * @param build The build.
 * @return The digest of its canonical JSON.
 */
export function buildDigest(build: unknown): string {
  return digest([canonical(build)]);
}

/**
 * Read a corpus file.
 *
 * @param file Its name in tests/fixtures/corpus.
 * @return Its content; an empty corpus when there is no such file yet.
 */
export function readCorpus<Variant>(file: string): Corpus<Variant> {
  const path = join(CORPUS_DIR, file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as Corpus<Variant>) : {};
}

/**
 * Write a corpus file, a variant to a line, so that a release recorded later adds lines and
 * changes none but the tag lists it joins.
 *
 * @param file Its name in tests/fixtures/corpus.
 * @param corpus Its content.
 */
export function writeCorpus<Variant>(file: string, corpus: Corpus<Variant>): void {
  const versions = Object.entries(corpus).map(([version, builds]) => {
    const names = Object.entries(builds).map(([name, variants]) => `  ${JSON.stringify(name)}: [\n${variants.map((variant) => `   ${JSON.stringify(variant)}`).join(',\n')}\n  ]`);
    return ` ${JSON.stringify(version)}: {\n${names.join(',\n')}\n }`;
  });
  const path = join(CORPUS_DIR, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `{\n${versions.join(',\n')}\n}\n`);
}
