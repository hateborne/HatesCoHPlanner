import { useEffect, useState } from 'react';
import type { Build } from '../../engine/build.ts';
import { deleteBuild, listBuilds, saveBuild, type SavedBuild } from '../../io/library.ts';
import { buildToMxDz, exportMbd, importMidsText, loadMidsMap, mbdToChunk } from '../../io/mids.ts';
import { decodeShare, shareLink } from '../../io/share.ts';
import { useStore } from '../../state/store.ts';
import { MenuFrame, SetTitle } from '../components/Chrome.tsx';

const btn = (left: number, top: number) => ({ left, top, position: 'absolute' as const });

/** Save / load / share / Mids import-export, in the in-game skin. */
export function BuildMenu({ onClose }: { onClose: () => void }) {
  const { gd, build, loadBuild } = useStore();
  const [saved, setSaved] = useState<SavedBuild[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string[]>([]);
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
  const doImport = async (src: string) => {
    try {
      const t = src.trim();
      let b: Build;
      let warnings: string[] = [];
      const m = /#b=([A-Za-z0-9_-]+)/.exec(t);
      if (m) b = await decodeShare(m[1]!, gd.core.manifest.dataVersion);
      else {
        const res = await importMidsText(gd, await loadMidsMap(gd), t);
        b = res.build;
        warnings = res.warnings;
      }
      loadBuild(b);
      say(`Imported "${b.name || 'build'}".`, ...warnings.map((w) => `Warning: ${w}`));
    } catch (e) {
      say(`Could not import: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <MenuFrame x={250} y={80} w={1500} h={960} r25 style={{ background: 'rgba(0,0,20,0.95)' }} />
        <SetTitle x={290} y={100} size={36} text="Build menu" />
        <div className="abs body-text" style={{ left: 290, top: 170, width: 640, fontSize: 18, color: '#cfe8ff' }}>
          <div className="title-text" style={{ fontSize: 22 }}>THIS BUILD</div>
          {build ? (
            <>
              <div style={btn(0, 40)}>
                <button className="info-button" style={{ position: 'static' }} onClick={() => void saveBuild(build).then(() => { void refresh(); say('Saved in this browser.'); })}>
                  Save in this browser
                </button>
              </div>
              <div style={btn(0, 100)}>
                <button className="info-button" style={{ position: 'static' }} onClick={() => void shareLink(build).then((l) => copy(l, 'Share link'))}>
                  Copy share link
                </button>
              </div>
              <div style={btn(0, 160)}>
                <button
                  className="info-button"
                  style={{ position: 'static' }}
                  onClick={() =>
                    void loadMidsMap(gd).then((map) => {
                      const { mbd, warnings } = exportMbd(gd, map, build);
                      download(`${build.name || 'build'}.mbd`, JSON.stringify(mbd, null, 2));
                      say('Mids .mbd downloaded.', ...warnings.map((w) => `Warning: ${w}`));
                    })
                  }
                >
                  Download Mids .mbd
                </button>
              </div>
              <div style={btn(0, 220)}>
                <button
                  className="info-button"
                  style={{ position: 'static' }}
                  onClick={() =>
                    void loadMidsMap(gd).then(async (map) => {
                      const { mbd, warnings } = exportMbd(gd, map, build);
                      await copy(await mbdToChunk(mbd), 'Mids share code');
                      if (warnings.length) setStatus((s) => [...s, ...warnings.map((w) => `Warning: ${w}`)]);
                    })
                  }
                >
                  Copy Mids share code
                </button>
              </div>
              <div style={btn(0, 280)}>
                <button
                  className="info-button"
                  style={{ position: 'static' }}
                  onClick={() =>
                    void loadMidsMap(gd).then(async (map) => {
                      const { text: code, warnings } = await buildToMxDz(gd, map, build);
                      await copy(code, 'Legacy Mids (MxDz) code');
                      if (warnings.length) setStatus((s) => [...s, ...warnings.map((w) => `Warning: ${w}`)]);
                    })
                  }
                >
                  Copy legacy MxDz code
                </button>
              </div>
            </>
          ) : (
            <div style={{ marginTop: 40 }}>No build yet.</div>
          )}
          <div className="title-text" style={{ ...btn(0, 360), fontSize: 22 }}>IMPORT</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a share link, a Mids share code (|MBD; or |MxDz;), or .mbd JSON"
            style={{ position: 'absolute', left: 0, top: 400, width: 620, height: 230, background: '#000', color: '#cfe8ff', border: '2px solid #4f94ff', borderRadius: 10, padding: 10, fontSize: 14 }}
          />
          <div style={btn(0, 650)}>
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
        <div className="abs" style={{ left: 980, top: 170, width: 730 }}>
          <div className="title-text" style={{ fontSize: 22 }}>SAVED IN THIS BROWSER</div>
          <div className="scroll-y body-text" style={{ height: 470, marginTop: 10, fontSize: 18 }}>
            {saved.length === 0 ? <div style={{ color: '#8fa1b8' }}>Nothing saved yet.</div> : null}
            {saved.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #123' }}>
                <span style={{ flex: 1, color: '#cfe8ff' }}>
                  {s.name} <span style={{ color: '#8fa1b8', fontSize: 14 }}>({gd.archetypeById.get(s.at)?.dn}, {new Date(s.saved).toLocaleString()})</span>
                </span>
                <button className="info-button" style={{ position: 'static', height: 32 }} onClick={() => { loadBuild(s.build); say(`Loaded "${s.name}".`); }}>
                  Load
                </button>
                <button className="info-button" style={{ position: 'static', height: 32 }} onClick={() => void deleteBuild(s.id!).then(refresh)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
          <div className="scroll-y body-text" style={{ height: 270, marginTop: 20, fontSize: 15, color: '#ffd24a', whiteSpace: 'pre-line' }}>
            {status.join('\n')}
          </div>
        </div>
        <button className="info-button" style={{ left: 1600, top: 985 }} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
