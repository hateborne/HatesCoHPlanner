/**
 * The recorded corpus: what each release of the planner wrote, kept so that it opens today as the
 * build it was then ("links never break", AGENTS.md).
 *
 * tests/fixtures/corpus/ holds, per game version and build, with the release tags that wrote each:
 * - links.json: the share link, and the digest of the build that release itself opened it as;
 * - stored.json: the build as the release held it, which is what it kept in the browser (the tab's
 *   build and the saved builds), for the builds recorded in full;
 * - mids.json: its Mids exports, a legacy code and for some builds the .mbd file, and the digest of
 *   the build each opened as on main when it was recorded.
 *
 * Each was written by that release's own code, run in a checkout of its tag
 * (node tests/corpus/record.mjs <tag>...; docs/architecture.md, "Recorded corpus"). A release that
 * wrote the same thing as an earlier one only joins its tag list. Nothing here is ever edited or
 * taken out: a link that stops opening as recorded is the bug.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import type { GameData } from '../src/data/gamedata.ts';
import { SERVERS, withServer } from '../src/data/servers.ts';
import type { Build } from '../src/engine/build.ts';
import { checkBuild } from '../src/engine/validate.ts';
import { importMbd, importMidsText, type Mbd, type MidsMap } from '../src/io/mids.ts';
import { decodeShare, encodeShare } from '../src/io/share.ts';
import { buildDigest, canonical, readCorpus, writeCorpus, type LinkVariant, type MidsVariant, type StoredVariant } from './helpers/corpus.ts';
import { dataDir, loadData } from './helpers/data.ts';

declare module 'vitest' {
  /** What a vitest config hands its tests: only tests/corpuswrite.config.ts sets this one. */
  export interface ProvidedContext {
    corpusWrite: boolean; // add the releases recorded in HCP_CORPUS_RAW to the corpus, where a run would check it
  }
}

// whether this run adds to the corpus. Only the write config says so (tests/corpus/record.mjs runs it).
const WRITE = inject('corpusWrite') === true;
// in a write run: the folder holding what each release recorded, a <tag>.json each
const RAW_DIR = process.env.HCP_CORPUS_RAW;
// hundreds of links are opened, a few milliseconds each
const TIMEOUT_MS = 5 * 60_000;

/** One build as a release recorded it (tests/corpus/recordrelease.ts writes these). */
interface Recorded {
  link?: string; // the share code the release wrote for it
  build?: Build; // the build as the release held it
  reopened?: Build | null; // the build the release opened its own link as
  fixes?: string[]; // what the release's own check repaired
  mxdz?: string; // its legacy Mids code
  mbd?: unknown; // its .mbd export
  error?: string; // why the release could not record it
}

/**
 * The game data of a corpus key.
 *
 * @param key "<server>/<game version>".
 * @return The server's id, the version's data and its Mids map, when the version has one.
 */
function dataOf(key: string): { server: string; gd: GameData; map: MidsMap | undefined } {
  const [server, version] = key.split('/') as [string, string];
  const mapPath = join(dataDir(server), version, 'mids-map.json');
  return { server, gd: loadData(version, server), map: existsSync(mapPath) ? (JSON.parse(readFileSync(mapPath, 'utf-8')) as MidsMap) : undefined };
}

/**
 * Open a share code as the planner opens a link on a server.
 *
 * @param gd The game version's data.
 * @param server The server's id.
 * @param link The share code.
 * @return The build, or null when the planner refuses it.
 */
async function openLink(gd: GameData, server: string, link: string): Promise<Build | null> {
  return checkBuild(gd, withServer(await decodeShare(link), server)).build;
}

/**
 * Put a release's variant of a build on record: its tag joins the variant that is the same, or the
 * variant is added.
 *
 * @param variants The variants on record for the build, added to.
 * @param tag The release.
 * @param made The variant as the release wrote it, without its tags.
 * @param same Whether a variant on record is the one the release wrote.
 */
function addVariant<Variant extends { tags: string[] }>(variants: Variant[], tag: string, made: Omit<Variant, 'tags'>, same: (onRecord: Variant) => boolean): void {
  if (variants.some((variant) => variant.tags.includes(tag))) return;
  const match = variants.find(same);
  if (match) match.tags.push(tag);
  else variants.push({ ...made, tags: [tag] } as Variant);
}

/** @return Whether a build's stored form and Mids exports are recorded, not its link alone (the sweep's hundreds are links only). */
function recordedInFull(name: string): boolean {
  return !name.startsWith('pair/') && !name.startsWith('pool/');
}

describe.runIf(WRITE)('recorded corpus, added to', () => {
  it('takes in the releases recorded in HCP_CORPUS_RAW', async () => {
    if (!RAW_DIR) throw new Error('HCP_CORPUS_RAW names no folder: run node tests/corpus/record.mjs <tag>...');
    const links = readCorpus<LinkVariant>('links.json');
    const stored = readCorpus<StoredVariant>('stored.json');
    const mids = readCorpus<MidsVariant>('mids.json');
    const failed: string[] = [];
    for (const file of readdirSync(RAW_DIR).filter((name) => name.endsWith('.json')).sort()) {
      const tag = file.replace(/\.json$/, '');
      const raw = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf-8')) as Record<string, Record<string, Recorded>>;
      for (const [key, builds] of Object.entries(raw)) {
        const { gd, map } = dataOf(key);
        for (const [name, recorded] of Object.entries(builds)) {
          if (!recorded.link || !recorded.build || !recorded.reopened) {
            failed.push(`${tag} ${key} ${name}: ${recorded.error ?? (recorded.link ? 'the release could not open its own link' : 'nothing recorded')}`);
            continue;
          }
          // the builds asked for are sound: a release that had to repair one read it as another build
          if (recorded.fixes?.length && !name.startsWith('special/')) failed.push(`${tag} ${key} ${name}: the release repaired it on the way in (${recorded.fixes.join('; ')})`);
          const { link, build, reopened, mxdz, mbd } = recorded;
          // a link is measured by what its own release opened it as: it cannot hold everything a build can
          addVariant(((links[key] ??= {})[name] ??= []), tag, { link, opens: buildDigest(reopened) }, (onRecord) => onRecord.link === link && onRecord.opens === buildDigest(reopened));
          if (!recordedInFull(name)) continue;
          addVariant(((stored[key] ??= {})[name] ??= []), tag, { build }, (onRecord) => canonical(onRecord.build) === canonical(build));
          if (!mxdz || !map) continue;
          // what each export opens as is taken from main as it is now, once, when the variant is first recorded
          const opens = { mxdz: buildDigest((await importMidsText(gd, map, mxdz)).build), ...(mbd ? { mbd: buildDigest(importMbd(gd, map, mbd as Mbd).build) } : {}) };
          addVariant(((mids[key] ??= {})[name] ??= []), tag, { mxdz, ...(mbd ? { mbd } : {}), opens }, (onRecord) => onRecord.mxdz === mxdz && canonical(onRecord.mbd) === canonical(mbd));
        }
      }
    }
    expect(failed, 'a release could not record these').toEqual([]);
    writeCorpus('links.json', links);
    writeCorpus('stored.json', stored);
    writeCorpus('mids.json', mids);
  }, 6 * TIMEOUT_MS);
});

describe.skipIf(WRITE)('recorded corpus', () => {
  const links = readCorpus<LinkVariant>('links.json');
  const stored = readCorpus<StoredVariant>('stored.json');
  const mids = readCorpus<MidsVariant>('mids.json');

  it('is on record for every server', () => {
    const servers = new Set(Object.keys(links).map((key) => key.split('/')[0]));
    expect(SERVERS.map((server) => server.id).filter((id) => !servers.has(id)), 'no recorded links for these servers').toEqual([]);
  });

  describe.each(Object.keys(links))('%s', (key) => {
    it('opens every link a release wrote as the build that release held', async () => {
      const { server, gd } = dataOf(key);
      const changed: string[] = [];
      for (const [name, variants] of Object.entries(links[key]!)) {
        for (const variant of variants) {
          const build = await openLink(gd, server, variant.link);
          if (!build || buildDigest(build) !== variant.opens) changed.push(`${name} (${variant.tags.join(', ')})`);
        }
      }
      expect(changed, 'these links no longer open as the builds they were').toEqual([]);
    }, TIMEOUT_MS);

    it('still writes the link the newest release wrote', async () => {
      const { server, gd } = dataOf(key);
      const changed: string[] = [];
      for (const [name, variants] of Object.entries(links[key]!)) {
        const newest = variants[variants.length - 1]!;
        const build = await openLink(gd, server, newest.link);
        if (!build || (await encodeShare(build)) !== newest.link) changed.push(name);
      }
      expect(changed, 'the planner now writes another link for these builds: only optional fields at the end may be added').toEqual([]);
    }, TIMEOUT_MS);

    it('opens every build a release kept in the browser as it was, and writes the link that release wrote for it', async () => {
      const { gd } = dataOf(key);
      const changed: string[] = [];
      const rewritten: string[] = [];
      for (const [name, variants] of Object.entries(stored[key] ?? {})) {
        for (const variant of variants) {
          const { build, fixes } = checkBuild(gd, JSON.parse(JSON.stringify(variant.build)));
          if (!build || fixes.length > 0 || canonical(build) !== canonical(variant.build)) changed.push(`${name} (${variant.tags.join(', ')})`);
          // a build holds more than a link can (a relative level below the lowest a link keeps), so the
          // writer is tried on the build as held, against the link its newest release wrote for it
          const newest = variant.tags[variant.tags.length - 1]!;
          const link = links[key]?.[name]?.find((candidate) => candidate.tags.includes(newest))?.link;
          if (build && link !== (await encodeShare(build))) rewritten.push(`${name} (${newest})`);
        }
      }
      expect(changed, 'these stored builds no longer open as they were').toEqual([]);
      expect(rewritten, 'the planner now writes another link for these builds than their newest release did').toEqual([]);
    }, TIMEOUT_MS);

    it('opens every Mids export a release wrote as the build on record', async () => {
      const { gd, map } = dataOf(key);
      const changed: string[] = [];
      for (const [name, variants] of Object.entries(mids[key] ?? {})) {
        if (!map) throw new Error(`${key} has Mids exports on record and no mids-map.json`);
        for (const variant of variants) {
          const tags = variant.tags.join(', ');
          if (buildDigest((await importMidsText(gd, map, variant.mxdz)).build) !== variant.opens.mxdz) changed.push(`${name}, the legacy code (${tags})`);
          if (variant.mbd && buildDigest(importMbd(gd, map, variant.mbd as Mbd).build) !== variant.opens.mbd) changed.push(`${name}, the .mbd file (${tags})`);
        }
      }
      expect(changed, 'these Mids exports no longer open as the builds on record').toEqual([]);
    }, TIMEOUT_MS);
  });
});
