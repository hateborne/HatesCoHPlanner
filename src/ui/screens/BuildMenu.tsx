import { useEffect, useState } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import { serverById, serverInLink, serverOf, withServer } from '../../data/servers.ts';
import { importTarget, madeOnLabel, type GameVersion } from '../../data/versions.ts';
import { ALIGNMENTS, toAlignment, type Build } from '../../engine/build.ts';
import { fitToPatch } from '../../engine/migrate.ts';
import type { Issue } from '../../engine/rules.ts';
import { finishBuildTxt, isBuildTxt, readBuildTxt } from '../../io/buildtxt.ts';
import { describeImportFailure, readBuildFile, unknownServer } from '../../io/importProblem.ts';
import { deleteBuild, listBuilds, saveBuild, type SavedBuild } from '../../io/library.ts';
import { buildToMxDz, exportMbd, importParsed, loadMidsMap, mbdToChunk, parseMidsText } from '../../io/mids.ts';
import { midsMadeOn } from '../../io/midsPatches.ts';
import { decodeShare, shareLink } from '../../io/share.ts';
import { useStore } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { MenuFrame, SetTitle } from '../components/Chrome.tsx';
import { useStage } from '../components/Stage.tsx';
import { TitleText } from '../components/GameText.tsx';
import { safeFileName } from '../../io/fileName.ts';

const btn = (left: number, top: number) => ({ left, top, position: 'absolute' as const });

// the most gaps the "Imported, with gaps" list shows before "... and N more"
const MAX_GAP_LINES = 40;

/** @return An issue as a line for the patch-move dialog ("Knockout Blow: Available at level 24"). */
function issueLine(gd: GameData, b: Build, i: Issue): string {
  const [kind, raw] = i.key.split(':');
  const power = kind === 'pick' ? b.picks[Number(raw)]?.power : kind === 'grant' ? Number(raw) : undefined;
  return power !== undefined && gd.powerById.has(power) ? `${gd.power(power).dn}: ${i.message}` : i.message;
}

/** @return How an approximate version is made, for the note shown when a build opens on one. */
function approxNote(v: GameVersion, gd: GameData, all: GameVersion[]): string {
  const base = gd.core.manifest.approximate?.base;
  const baseLabel = all.find((x) => x.id === base)?.label ?? base ?? 'a later patch';
  return `Opened on ${v.label}: power levels from MidsReborn's database for that patch, everything else from ${baseLabel}.`;
}

/** Save / load / share / Mids import-export, in the in-game skin. */
export function BuildMenu({ onClose }: { onClose: () => void }) {
  const { gd, build, loadBuild, versions } = useStore();
  useEscape(onClose);
  const [saved, setSaved] = useState<SavedBuild[]>([]);
  const [text, setText] = useState('');
  const [from, setFrom] = useState<string | null>(null); // the file whose text is in the box (a drop), for messages
  const [status, setStatus] = useState<string[]>([]);
  const [dropping, setDropping] = useState(false); // a file is being dragged over the import box
  const stage = useStage();
  const { phone } = stage;
  const refresh = () => listBuilds().then(setSaved).catch(() => setSaved([]));
  useEffect(() => {
    void refresh();
  }, []);
  if (!gd) return null;
  const say = (...lines: string[]) => setStatus(lines);
  const copy = async (s: string, what: string) => {
    setText(s);
    try {
      await navigator.clipboard.writeText(s);
      say(`${what} copied to the clipboard.`);
    } catch {
      say(`${what} is in the box below (clipboard not available).`);
    }
  };
  const download = (name: string, content: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    a.download = safeFileName(name);
    a.click();
    URL.revokeObjectURL(a.href);
  };
  /**
   * Tell the user why an import failed, in the dialog and on the menu's status line.
   *
   * @param e What was thrown (an ImportProblem, or a fault on our side: a generic message).
   * @param lead How the message starts, naming what was imported.
   */
  const fail = async (e: unknown, lead: string) => {
    const f = describeImportFailure(e, lead);
    say(...f.text.split('\n'));
    await useStore.getState().tell({ title: f.title, text: f.text });
  };
  /** A file dropped on the import box: its text goes into the box, to check before importing. */
  const dropFile = (f: File) => {
    readBuildFile(f).then(
      (s) => {
        setText(s);
        setFrom(f.name);
        say(`"${f.name}" is in the box. Import pasted text opens it.`);
      },
      (e: unknown) => void fail(e, `Couldn't import "${f.name}"`),
    );
  };
  /**
   * Open an imported build, then say what couldn't be brought over, if anything (the menu closes
   * when a build opens, so that goes to the dialog).
   *
   * @param b The build.
   * @param gaps What the import couldn't bring over, worded for the user.
   */
  const open = async (b: Build, gaps: string[]) => {
    await useStore.getState().openBuild(b);
    const name = b.name ? `"${b.name}"` : 'The build';
    // a damaged file can report thousands: list the first ones and how many more
    const lines = gaps.length > MAX_GAP_LINES ? [...gaps.slice(0, MAX_GAP_LINES), `... and ${gaps.length - MAX_GAP_LINES} more`] : gaps;
    if (gaps.length) void useStore.getState().tell({ title: 'Imported, with gaps', text: `${name} is open, but some of it couldn't be brought over:`, lines });
  };
  /**
   * The browser refused to save or delete (a private window, storage full or switched off): say so
   * instead of leaving the user to think the build was kept.
   */
  const storageFailed = (e: unknown, what: 'saved' | 'deleted') => {
    console.error(`saved builds: ${what}`, e);
    say(what === 'saved'
      ? "Couldn't save in this browser (it may be a private window, or out of space). Use Copy share link or Download Mids .mbd to keep the build."
      : "Couldn't delete that build: this browser's storage refused.");
  };
  /**
   * The open build's own game data and Mids map, for exports: New Build's version picker may be
   * showing another version, and the build must be written out against the data it was made on.
   */
  const buildData = async () => {
    const st = useStore.getState();
    const b = st.build!;
    const bgd = st.gd && st.gd.core.manifest.dataVersion === b.dataVersion ? st.gd : await st.dataForVersion(b.dataVersion);
    return { bgd, map: await loadMidsMap(bgd) };
  };
  /** Mids is an untrusted reference: a failed export says so instead of failing silently. */
  const midsFailed = (e: unknown) => say(`Mids export failed: ${e instanceof Error ? e.message : String(e)}`);
  /** Ask before a loaded or imported build replaces the current one (when it has any picks). */
  const replaceOk = async (incoming: string) => {
    if (!build || !build.picks.some((p) => p)) return true;
    return useStore.getState().askConfirm({
      title: 'Replace the current build?',
      text: `Loading ${incoming ? `"${incoming}"` : 'this build'} replaces ${build.name ? `"${build.name}"` : 'your current build'}. Save it first if you want to keep it.`,
      okLabel: 'Replace',
    });
  };
  /**
   * Import a share link or any Mids text. A Mids build opens on the game patch it was made on when
   * the planner carries it; otherwise on the nearest newer patch (else the newest), after the user
   * agrees to the swaps that fit it there (listed before, and kept on the overview after).
   */
  const doImport = async (src: string, file?: string) => {
    try {
      const t = src.trim();
      const m = /#b=([A-Za-z0-9_-]+)/.exec(t);
      if (m) {
        // a link's address names its server (/HatesCoHPlanner/Homecoming/#b=...); a bare code is Homecoming's
        const named = serverInLink(t, import.meta.env.BASE_URL);
        if (named.unknown) throw unknownServer(named.unknown);
        const b = withServer(await decodeShare(m[1]!), named.server?.id);
        if (!(await replaceOk(b.name))) return;
        await open(b, []);
        return;
      }
      if (isBuildTxt(t)) {
        await importBuildTxt(t);
        return;
      }
      const st = useStore.getState();
      const parsed = await parseMidsText(t);
      const made = parsed.kind === 'mbd' ? midsMadeOn(parsed.mbd) : undefined;
      const { version, move } = versions ? importTarget(versions, made) : { version: undefined, move: false };
      const tgd = version ? await st.dataForVersion(version.id) : gd;
      const res = await importParsed(tgd, await loadMidsMap(tgd), parsed);
      let b = res.build;
      let changes: string[] = [];
      if (move && made && version) {
        const fit = fitToPatch(tgd, b);
        const still = fit.remaining.map((i) => `Still flagged: ${issueLine(tgd, fit.build, i)}`);
        const ok = await st.askConfirm({
          title: `Open on ${version.label}?`,
          text:
            `This build was made on ${madeOnLabel(made)}, which the planner doesn't carry. It can open on ${version.label}, the nearest patch it has` +
            (fit.changes.length ? ', with these changes (powers keep their slots and enhancements):' : still.length ? ':' : '. No changes are needed.'),
          lines: [...fit.changes, ...still],
          okLabel: 'Open',
        });
        if (!ok) {
          say('Import cancelled.');
          return;
        }
        b = fit.build;
        changes = fit.changes;
      }
      if (!(await replaceOk(b.name))) return;
      await open(b, res.warnings);
      if (changes.length && version) useStore.getState().setPatchNotes({ title: `Changes for ${version.label}`, lines: changes });
      // loading a build closes this menu, so the note on approximate data goes to the notice line
      if (version?.approx) useStore.getState().notify(approxNote(version, tgd, versions?.versions ?? []));
    } catch (e) {
      await fail(e, file ? `Couldn't import "${file}"` : "Couldn't import the pasted text");
    }
  };
  /**
   * Import Homecoming's /build_save file. It is written by the live game, so it opens on the
   * newest version; the file holds no alignment and no slot levels, so the user picks the
   * alignment and the build type (Leveling only when the slots could have come from leveling).
   */
  const importBuildTxt = async (t: string) => {
    const st = useStore.getState();
    const tgd = versions ? await st.dataForVersion(versions.default) : gd;
    const imp = readBuildTxt(tgd, t);
    const picked = await st.askChoices({
      title: 'Import a /build_save file',
      text: `${imp.summary}.\nThe file doesn't record the alignment, or the level each enhancement slot was added at.`,
      okLabel: 'Import',
      choices: [
        { label: 'Alignment', options: ALIGNMENTS.map((a) => ({ id: a, label: a })), value: 'Hero' },
        {
          label: 'Build type',
          options: [
            { id: 'respec', label: 'Respec' },
            { id: 'leveling', label: 'Leveling', ...(imp.leveledBlock ? { block: imp.leveledBlock } : {}) },
          ],
          value: 'respec',
        },
      ],
    });
    if (!picked) {
      say('Import cancelled.');
      return;
    }
    const b = finishBuildTxt(tgd, imp, { alignment: toAlignment(picked[0]), respec: picked[1] !== 'leveling' });
    if (!(await replaceOk(b.name))) return;
    await open(b, imp.warnings);
  };

  // Desktop: two columns. Phone: the whole screen, the same two sections stacked in one scrolling column.
  const W = stage.w;
  const bottom = stage.h - 36; // phones: clear of the not-affiliated line
  const closeY = bottom - 14 - 56;
  const L = phone
    ? { frame: [6, 6, W - 12, bottom - 6], title: [18, 18], wrap: { position: 'absolute' as const, left: 18, top: 70, width: W - 36, height: closeY - 10 - 70, overflowY: 'auto' as const } }
    : { frame: [250, 80, 1500, 960], title: [290, 100], wrap: undefined };
  // the left column's rows (stage px from its top): finger-sized and further apart on phones
  const row = (i: number) => (phone ? 44 + i * 66 : 40 + i * 60);
  const IMPORT_Y = phone ? row(5) + 16 : 360;
  const BOX_Y = IMPORT_Y + 40;
  const BOX_H = phone ? 190 : 230;
  const leftStyle = phone
    ? { position: 'relative' as const, width: W - 40, height: BOX_Y + BOX_H + 90, fontSize: 18, color: '#cfe8ff' }
    : { left: 290, top: 170, width: 640, fontSize: 18, color: '#cfe8ff' };
  const rightStyle = phone ? { position: 'relative' as const, width: W - 40, marginTop: 10 } : { left: 980, top: 170, width: 730 };
  const listBtn = { position: 'static' as const, height: phone ? 48 : 32 };
  return (
    <div className="overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <MenuFrame x={L.frame[0]!} y={L.frame[1]!} w={L.frame[2]!} h={L.frame[3]!} r25 style={{ background: 'rgba(0,0,20,0.95)' }} />
        <SetTitle x={L.title[0]!} y={L.title[1]!} size={phone ? 28 : 36} text="Build menu" />
        <div style={L.wrap}>
        <div className={phone ? 'body-text' : 'abs body-text'} style={leftStyle}>
          <TitleText style={{ fontSize: 22 }}>THIS BUILD</TitleText>
          {build ? (
            <>
              <div style={btn(0, row(0))}>
                <button className="info-button" style={{ position: 'static' }} onClick={() => void saveBuild(build).then(() => { void refresh(); say('Saved in this browser.'); }, (e: unknown) => storageFailed(e, 'saved'))}>
                  Save in this browser
                </button>
              </div>
              <div style={btn(0, row(1))}>
                <button className="info-button" style={{ position: 'static' }} onClick={() => void shareLink(build).then((l) => copy(l, 'Share link'))}>
                  Copy share link
                </button>
              </div>
              <div style={btn(0, row(2))}>
                <button
                  className="info-button"
                  style={{ position: 'static' }}
                  onClick={() =>
                    void buildData().then(({ bgd, map }) => {
                      const { mbd, warnings } = exportMbd(bgd, map, build);
                      download(`${build.name || 'build'}.mbd`, JSON.stringify(mbd, null, 2));
                      say('Mids .mbd downloaded.', ...warnings.map((w) => `Warning: ${w}`));
                    }).catch(midsFailed)
                  }
                >
                  Download Mids .mbd
                </button>
              </div>
              <div style={btn(0, row(3))}>
                <button
                  className="info-button"
                  style={{ position: 'static' }}
                  onClick={() =>
                    void buildData().then(async ({ bgd, map }) => {
                      const { mbd, warnings } = exportMbd(bgd, map, build);
                      await copy(await mbdToChunk(mbd), 'Mids share code');
                      if (warnings.length) setStatus((s) => [...s, ...warnings.map((w) => `Warning: ${w}`)]);
                    }).catch(midsFailed)
                  }
                >
                  Copy Mids share code
                </button>
              </div>
              <div style={btn(0, row(4))}>
                <button
                  className="info-button"
                  style={{ position: 'static' }}
                  onClick={() =>
                    void buildData().then(async ({ bgd, map }) => {
                      const { text: code, warnings } = await buildToMxDz(bgd, map, build);
                      await copy(code, 'Legacy Mids (MxDz) code');
                      if (warnings.length) setStatus((s) => [...s, ...warnings.map((w) => `Warning: ${w}`)]);
                    }).catch(midsFailed)
                  }
                >
                  Copy legacy MxDz code
                </button>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 40 }}>No build yet.</div>
          )}
          <TitleText style={{ ...btn(0, IMPORT_Y), fontSize: 22 }}>IMPORT</TitleText>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFrom(null);
            }}
            // a dropped file fills the box; dragged text keeps the browser's own handling
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              setDropping(false);
              const f = e.dataTransfer.files[0];
              if (!f) return;
              e.preventDefault();
              dropFile(f);
            }}
            placeholder="Paste a share link, a Mids share code (|MBD; or |MxDz;), .mbd JSON, or a /build_save file from the game (build.txt). Or drop a file here."
            style={{ position: 'absolute', left: 0, top: BOX_Y, width: phone ? W - 40 : 620, height: BOX_H, boxSizing: phone ? 'border-box' : undefined, background: dropping ? '#001a3a' : '#000', color: '#cfe8ff', border: `2px ${dropping ? 'dashed #9fd0ff' : 'solid #4f94ff'}`, borderRadius: 10, padding: 10, fontSize: 14 }}
          />
          <div style={btn(0, BOX_Y + BOX_H + 20)}>
            <button className="info-button" style={{ position: 'static' }} onClick={() => void doImport(text, from ?? undefined)} disabled={!text.trim()}>
              Import pasted text
            </button>
            <label className="info-button" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 12 }}>
              Open .mbd or build.txt
              <input type="file" accept=".mbd,.json,.txt" style={{ display: 'none' }} onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ''; // the same file can be picked again
                if (f) readBuildFile(f).then((s) => doImport(s, f.name), (err: unknown) => fail(err, `Couldn't import "${f.name}"`));
              }} />
            </label>
          </div>
        </div>
        <div className={phone ? '' : 'abs'} style={rightStyle}>
          <TitleText style={{ fontSize: 22 }}>SAVED IN THIS BROWSER</TitleText>
          <div className="scroll-y body-text" style={{ height: phone ? 340 : 470, marginTop: 10, fontSize: 18 }}>
            {saved.length === 0 ? <div style={{ color: '#8fa1b8' }}>Nothing saved yet.</div> : null}
            {saved.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #123' }}>
                <span style={{ flex: 1, color: '#cfe8ff' }}>
                  {/* the list holds every server's builds: another server's archetype is named by its server instead */}
                  {s.name} <span style={{ color: '#8fa1b8', fontSize: 14 }}>({serverOf(s.build) === gd.server ? gd.archetypeById.get(s.at)?.dn : (serverById(serverOf(s.build))?.label ?? serverOf(s.build))}, {new Date(s.saved).toLocaleString()})</span>
                </span>
                <button className="info-button" style={listBtn} onClick={() => void replaceOk(s.name).then(async (ok) => { if (ok) { await loadBuild(s.build); say(`Loaded "${s.name}".`); } })}>
                  Load
                </button>
                <button className="info-button" style={listBtn} onClick={() => void deleteBuild(s.id!).then(refresh, (e: unknown) => storageFailed(e, 'deleted'))}>
                  Delete
                </button>
              </div>
            ))}
          </div>
          <div className="scroll-y body-text" style={{ height: phone ? 160 : 270, marginTop: 20, fontSize: 15, color: '#ffd24a', whiteSpace: 'pre-line' }}>
            {status.join('\n')}
          </div>
        </div>
        </div>
        <button className="info-button" style={phone ? { left: (W - 140) / 2, top: closeY, width: 140 } : { left: 1600, top: 985 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
