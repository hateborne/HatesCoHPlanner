import { useEffect, useState } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import { importTarget, madeOnLabel, type GameVersion } from '../../data/versions.ts';
import type { Build } from '../../engine/build.ts';
import { fitToPatch } from '../../engine/migrate.ts';
import type { Issue } from '../../engine/rules.ts';
import { deleteBuild, listBuilds, saveBuild, type SavedBuild } from '../../io/library.ts';
import { buildToMxDz, exportMbd, importParsed, loadMidsMap, mbdToChunk, parseMidsText } from '../../io/mids.ts';
import { midsMadeOn } from '../../io/midsPatches.ts';
import { decodeShare, shareLink } from '../../io/share.ts';
import { useStore } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { MenuFrame, SetTitle } from '../components/Chrome.tsx';
import { useStage } from '../components/Stage.tsx';
import { TitleText } from '../components/GameText.tsx';

const btn = (left: number, top: number) => ({ left, top, position: 'absolute' as const });

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
  const [status, setStatus] = useState<string[]>([]);
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
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
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
  const doImport = async (src: string) => {
    try {
      const t = src.trim();
      const m = /#b=([A-Za-z0-9_-]+)/.exec(t);
      if (m) {
        const b = await decodeShare(m[1]!);
        if (!(await replaceOk(b.name))) return;
        await loadBuild(b);
        say(`Imported "${b.name || 'build'}".`);
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
      await loadBuild(b);
      if (changes.length && version) useStore.getState().setPatchNotes({ title: `Changes for ${version.label}`, lines: changes });
      // loading a build closes this menu, so the note on approximate data goes to the notice line
      if (version?.approx) useStore.getState().notify(approxNote(version, tgd, versions?.versions ?? []));
      say(`Imported "${b.name || 'build'}".`, ...res.warnings.map((w) => `Warning: ${w}`));
    } catch (e) {
      say(`Could not import: ${e instanceof Error ? e.message : String(e)}`);
    }
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
                <button className="info-button" style={{ position: 'static' }} onClick={() => void saveBuild(build).then(() => { void refresh(); say('Saved in this browser.'); })}>
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
                    void loadMidsMap(gd).then((map) => {
                      const { mbd, warnings } = exportMbd(gd, map, build);
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
                    void loadMidsMap(gd).then(async (map) => {
                      const { mbd, warnings } = exportMbd(gd, map, build);
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
                    void loadMidsMap(gd).then(async (map) => {
                      const { text: code, warnings } = await buildToMxDz(gd, map, build);
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
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a share link, a Mids share code (|MBD; or |MxDz;), or .mbd JSON"
            style={{ position: 'absolute', left: 0, top: BOX_Y, width: phone ? W - 40 : 620, height: BOX_H, boxSizing: phone ? 'border-box' : undefined, background: '#000', color: '#cfe8ff', border: '2px solid #4f94ff', borderRadius: 10, padding: 10, fontSize: 14 }}
          />
          <div style={btn(0, BOX_Y + BOX_H + 20)}>
            <button className="info-button" style={{ position: 'static' }} onClick={() => void doImport(text)} disabled={!text.trim()}>
              Import pasted text
            </button>
            <label className="info-button" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: 12 }}>
              Open .mbd file
              <input type="file" accept=".mbd,.json,.txt" style={{ display: 'none' }} onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(doImport);
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
                  {s.name} <span style={{ color: '#8fa1b8', fontSize: 14 }}>({gd.archetypeById.get(s.at)?.dn}, {new Date(s.saved).toLocaleString()})</span>
                </span>
                <button className="info-button" style={listBtn} onClick={() => void replaceOk(s.name).then(async (ok) => { if (ok) { await loadBuild(s.build); say(`Loaded "${s.name}".`); } })}>
                  Load
                </button>
                <button className="info-button" style={listBtn} onClick={() => void deleteBuild(s.id!).then(refresh)}>
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
