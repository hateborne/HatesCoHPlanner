import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_SERVER, defaultServer, serverById, serverOf, SERVERS, type GameServer } from '../../data/servers.ts';
import { skinOf } from '../../engine/build.ts';
import { useStore } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { pressKeys } from '../press.ts';
import { SKINS } from '../skin/skin.ts';
import { play } from '../sound.ts';
import { MenuFrame, SetTitle } from './Chrome.tsx';
import { SELECT } from './OriginAlign.tsx';
import { useStage } from './Stage.tsx';

/** @return A server's logo URL. */
const logoSrc = (s: GameServer) => `${import.meta.env.BASE_URL}${s.logo}`;

/**
 * Open the server list from the logo on New Build, and show the server picked there. A build in
 * the background can't come along (its archetype and sets may not exist on the other server), so
 * the switch clears it, after asking. Picking the server already shown changes nothing.
 */
async function switchServer(): Promise<void> {
  const st = useStore.getState();
  // only New Build switches (an open list, a first visit's above all, is never replaced)
  if (st.serverAsk || st.view !== 'setup') return;
  const id = await st.askServer(/*cancellable=*/ true);
  const to = serverById(id ?? undefined);
  const { build, server, askConfirm, selectServer } = useStore.getState();
  if (!to || to.id === server) return;
  if (build) {
    const from = serverById(serverOf(build))?.label ?? 'another server';
    const ok = await askConfirm({
      title: `Switch to ${to.label}?`,
      text: `This clears ${build.name ? `"${build.name}"` : 'your current build'}: it is a ${from} build and can't move to another server. Save it first (Saved builds / Import) if you want to keep it.`,
      okLabel: 'Switch',
    });
    if (!ok) return;
  }
  await selectServer(to.id);
}

/**
 * The shown server's logo, on every screen. On New Build it is also the server selector: a click
 * (or Enter / Space) opens the server list. Elsewhere it only shows the server: a build's
 * archetype and power sets may not exist on another one. Desktop draws it in the bottom bar beside
 * the planner's switches, phones at the top of the menu pane.
 */
export function ServerLogo({ x, y, w, h, onPick }: { x: number; y: number; w: number; h: number; onPick?: () => void }) {
  const server = useStore((s) => serverById(s.server) ?? defaultServer());
  const active = useStore((s) => s.view === 'setup');
  const open = () => {
    onPick?.();
    void switchServer();
  };
  const help = active ? `Game server: ${server.label}. Click to choose a server.` : `Game server: ${server.label}`;
  return (
    <div
      className={`abs server-logo${active ? ' active' : ''}`}
      title={help}
      {...(active ? { onClick: open, ...pressKeys(open, undefined, help) } : { role: 'img', 'aria-label': help })}
      style={{ left: x, top: y, width: w, height: h, cursor: active ? 'pointer' : 'default', zIndex: 40 }}
    >
      <img src={logoSrc(server)} alt={server.label} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
    </div>
  );
}

// desktop tile (stage px): the logo box and the gap between tiles
const TILE = { w: 300, h: 150, gap: 28 };
// phone tile: one per row, as wide as the panel allows
const PHONE_TILE_H = 170;

/**
 * The server list (askServer): each server's logo as a tile, side by side (stacked on phones). A
 * first visit opens it once the site carries more than one server; the logo opens it any time.
 * The default (Homecoming) starts highlighted on a first visit, the shown server when switching;
 * Enter or Space takes the highlighted one, the arrow keys move between them and a click picks one.
 * Escape cancels a switch; a first visit can't be left without a server, so there it takes the
 * default.
 */
export function ServerDialog() {
  const cancellable = useStore((s) => s.serverAsk?.cancellable);
  return cancellable === undefined ? null : <ServerList cancellable={cancellable} />;
}

/** The open server list (mounted per opening, so each starts on its own highlighted server). */
function ServerList({ cancellable }: { cancellable: boolean }) {
  const { close, shown, alignment, hasBuild } = useStore(
    useShallow((s) => ({ close: s.closeServerAsk, shown: s.server, alignment: s.build?.alignment, hasBuild: !!s.build })),
  );
  const stage = useStage();
  const [hi, setHi] = useState(() => Math.max(0, SERVERS.findIndex((s) => s.id === (cancellable ? shown : DEFAULT_SERVER))));
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const pick = (i: number) => {
    const s = SERVERS[i];
    if (!s) return;
    play(SELECT[0]!);
    close(s.id);
  };
  useEscape(() => (cancellable ? close(null) : pick(SERVERS.findIndex((s) => s.id === DEFAULT_SERVER))));
  // the keyboard focus follows the highlight
  useEffect(() => {
    tiles.current[hi]?.focus();
  }, [hi]);
  // Enter / Space / arrows belong to the list wherever the focus is: caught before anything else
  // (capture on window, ahead of React's handlers) so nothing behind the dialog acts on them
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys = ['Enter', ' ', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
      if (!keys.includes(e.key)) return; // Escape and Tab go on as usual
      // the dialog's own Cancel button answers its own keys
      if (e.target instanceof HTMLButtonElement && root.current?.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return; // a key held down from opening the list (Enter on the logo) picks nothing
      const n = SERVERS.length;
      if (e.key === 'Enter' || e.key === ' ') pick(hi);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setHi((hi + 1) % n);
      else setHi((hi + n - 1) % n);
    };
    window.addEventListener('keydown', onKey, /*capture=*/ true);
    return () => window.removeEventListener('keydown', onKey, /*capture=*/ true);
  });

  const { phone } = stage;
  const skin = SKINS[alignment ? skinOf(alignment) : 'hero'];
  const n = SERVERS.length;
  const pad = phone ? 24 : 40;
  const textTop = phone ? 76 : 90;
  const textH = phone ? 150 : 104; // ~3 lines of the text
  const labelH = 40; // the name line under each logo
  const w = phone ? stage.w - 24 : Math.max(760, n * TILE.w + (n - 1) * TILE.gap + 2 * pad);
  const tileW = phone ? w - 2 * pad : TILE.w;
  const tileH = phone ? PHONE_TILE_H : TILE.h;
  const rowsH = phone ? n * (tileH + labelH) + (n - 1) * 16 : tileH + labelH;
  const btnH = cancellable ? (phone ? 100 : 90) : 30;
  const h = textTop + textH + rowsH + btnH;
  const x = (stage.w - w) / 2;
  const y = Math.max(12, (stage.h - h) / 2);
  const def = defaultServer();
  const text = cancellable
    ? SERVERS.length > 1
      ? `Each server has its own archetypes, powers and enhancements, so picking another server clears the archetype and power sets chosen here${hasBuild ? ', and your current build (you are asked first)' : ''}.`
      : `The planner covers ${def.label} for now. Other servers are added once their game data is in.`
    : `Which server do you play on? Each server has its own powers and enhancements.\nEnter or Space picks ${def.label}.`;
  const rowTop = y + textTop + textH;
  const rowLeft = phone ? x + pad : x + (w - (n * TILE.w + (n - 1) * TILE.gap)) / 2;
  const btnW = Math.min(170, (w - 72) / 2);
  return (
    <div ref={root} className="abs" role="dialog" aria-label="Choose a server" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 106, background: 'rgba(0,0,0,0.55)' }}>
      <MenuFrame x={x} y={y} w={w} h={h} r25 skin={skin} style={{ background: 'rgba(0,3,24,0.97)' }} />
      <SetTitle skin={skin} x={x + (phone ? 22 : 36)} y={y + 26} size={phone ? 26 : 28} text="Choose a Server" />
      <div className="abs body-text" style={{ left: x + pad, top: y + textTop, width: w - 2 * pad, fontSize: 19, lineHeight: 1.35, color: '#cfe8ff', whiteSpace: 'pre-line' }}>
        {text}
      </div>
      {SERVERS.map((s, i) => {
        const tx = phone ? rowLeft : rowLeft + i * (TILE.w + TILE.gap);
        const ty = phone ? rowTop + i * (tileH + labelH + 16) : rowTop;
        const on = i === hi;
        const note = s.id === shown && cancellable ? ' (current)' : s.id === DEFAULT_SERVER && !cancellable ? ' (default)' : '';
        return (
          <div key={s.id}>
            <div
              ref={(el) => {
                tiles.current[i] = el;
              }}
              className="abs server-tile"
              role="button"
              tabIndex={0}
              aria-label={`${s.label}${note}`}
              data-testid={`server:${s.id}`}
              onClick={() => pick(i)}
              onFocus={() => setHi(i)}
              onMouseEnter={() => setHi(i)}
              style={{
                left: tx,
                top: ty,
                width: tileW,
                height: tileH,
                boxSizing: 'border-box',
                padding: 14,
                borderRadius: 14,
                border: `2px solid ${on ? '#4f94ff' : 'rgba(79,148,255,0.3)'}`,
                background: on ? 'rgba(31,109,255,0.18)' : 'rgba(0,0,0,0.35)',
                boxShadow: on ? '0 0 14px rgba(79,148,255,0.75)' : 'none',
                cursor: 'pointer',
              }}
            >
              <img src={logoSrc(s)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            </div>
            <div className="abs body-text" style={{ left: tx, top: ty + tileH + 8, width: tileW, textAlign: 'center', fontSize: 19, color: on ? '#ffffff' : '#8fa1b8' }}>
              {s.label}
              {note}
            </div>
          </div>
        );
      })}
      {cancellable ? (
        <div className="abs" style={{ left: x, top: y + h - (phone ? 84 : 72), width: w, display: 'flex', justifyContent: 'center' }}>
          <button className="info-button" style={{ position: 'static', width: btnW, padding: 0 }} onClick={() => close(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
