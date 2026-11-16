import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_SERVER, defaultServer, serverById, serverOf, SERVERS, type GameServer } from '../../data/servers.ts';
import { hasWork, skinOf } from '../../engine/build.ts';
import { lastServer } from '../../state/lastServer.ts';
import { CONTINUE_BUILD, useStore } from '../../state/store.ts';
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
  const id = await st.askServer(/*cancellable=*/ true, st.server);
  const to = serverById(id ?? undefined);
  const { build, server, askConfirm, selectServer } = useStore.getState();
  if (!to || to.id === server) return;
  // a build with nothing in it (left on its first power screen) is cleared without asking
  if (build && hasWork(build)) {
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
 * The server last shown in this browser (else the default) starts highlighted on a first visit, the
 * shown server when switching. Enter or Space (or a first visit's OK) takes the highlighted one,
 * the arrow keys move the highlight and a click picks a tile; hovering only lights a tile up, so
 * the pointer crossing one on its way to OK changes nothing. Escape cancels a switch; a first visit
 * can't be left without a server, so there it takes the preselected one.
 *
 * A page load after a long break (`resume`) shows the same list with a Continue button for the last
 * build in place of OK. Continue starts highlighted (Enter and Escape take it); the arrow keys move
 * between it and the tiles, and a tile starts a new build on its server.
 */
export function ServerDialog() {
  const ask = useStore(
    useShallow((s) => (s.serverAsk ? { cancellable: s.serverAsk.cancellable, preselect: s.serverAsk.preselect, resume: s.serverAsk.resume } : null)),
  );
  return ask ? <ServerList cancellable={ask.cancellable} preselect={ask.preselect} resume={ask.resume} /> : null;
}

/** The open server list (mounted per opening, so each starts on its own highlighted server). */
function ServerList({ cancellable, preselect, resume }: { cancellable: boolean; preselect: string; resume?: string }) {
  const { close, shown, alignment, hasBuild } = useStore(
    useShallow((s) => ({ close: s.closeServerAsk, shown: s.server, alignment: s.build?.alignment, hasBuild: !!s.build && hasWork(s.build) })),
  );
  const stage = useStage();
  const n = SERVERS.length;
  // the highlight: a tile's index, or n for the Continue button (a return after a long break)
  const items = resume ? n + 1 : n;
  const first = Math.max(0, SERVERS.findIndex((s) => s.id === preselect));
  const [hi, setHi] = useState(resume ? n : first);
  // the server this browser last showed, named in a first visit's list (read once per opening)
  const [last] = useState(() => lastServer()?.id);
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const pick = (i: number) => {
    const id = resume && i === n ? CONTINUE_BUILD : SERVERS[i]?.id;
    if (!id) return;
    play(SELECT[0]!);
    close(id);
  };
  useEscape(() => (cancellable ? close(null) : pick(resume ? n : first)));
  // the keyboard focus follows the highlight
  useEffect(() => {
    (hi < n ? tiles.current[hi] : resumeRef.current)?.focus();
  }, [hi, n]);
  // Enter / Space / arrows belong to the list wherever the focus is: caught before anything else
  // (capture on window, ahead of React's handlers) so nothing behind the dialog acts on them
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys = ['Enter', ' ', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
      if (!keys.includes(e.key)) return; // Escape and Tab go on as usual
      // the dialog's own buttons (Cancel, OK, Continue) answer their own Enter and Space
      const own = e.target instanceof HTMLButtonElement && root.current?.contains(e.target);
      if (own && (e.key === 'Enter' || e.key === ' ')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return; // a key held down from opening the list (Enter on the logo) picks nothing
      if (e.key === 'Enter' || e.key === ' ') pick(hi);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setHi((hi + 1) % items);
      else setHi((hi + items - 1) % items);
    };
    window.addEventListener('keydown', onKey, /*capture=*/ true);
    return () => window.removeEventListener('keydown', onKey, /*capture=*/ true);
  });

  const { phone } = stage;
  const skin = SKINS[alignment ? skinOf(alignment) : 'hero'];
  const pad = phone ? 24 : 40;
  const textTop = phone ? 76 : 90;
  const textH = phone ? 150 : 104; // ~3 lines of the text
  const labelH = 40; // the name line under each logo
  const w = phone ? stage.w - 24 : Math.max(760, n * TILE.w + (n - 1) * TILE.gap + 2 * pad);
  const tileW = phone ? w - 2 * pad : TILE.w;
  const tileH = phone ? PHONE_TILE_H : TILE.h;
  const rowsH = phone ? n * (tileH + labelH) + (n - 1) * 16 : tileH + labelH;
  const btnH = phone ? 100 : 90; // Cancel when switching, OK on a first visit, Continue after a break
  const h = textTop + textH + rowsH + btnH;
  const x = (stage.w - w) / 2;
  const y = Math.max(12, (stage.h - h) / 2);
  const def = defaultServer();
  const text = cancellable
    ? SERVERS.length > 1
      ? `Each server has its own archetypes, powers and enhancements, so picking another server clears the archetype and power sets chosen here${hasBuild ? ', and your current build (you are asked first)' : ''}.`
      : `The planner covers ${def.label} for now. Other servers are added once their game data is in.`
    : `Which server do you play on? Each server has its own powers and enhancements.${resume ? '\nPick one to start a new build, or continue where you left off.' : ''}`;
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
        const note = cancellable ? (s.id === shown ? ' (current)' : '') : s.id === (last ?? DEFAULT_SERVER) ? (last ? ' (last used)' : ' (default)') : '';
        return (
          <div key={s.id}>
            <div
              ref={(el) => {
                tiles.current[i] = el;
              }}
              className={`abs server-tile${on ? ' on' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${s.label}${note}`}
              data-testid={`server:${s.id}`}
              onClick={() => pick(i)}
              onFocus={() => setHi(i)}
              style={{ left: tx, top: ty, width: tileW, height: tileH }}
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
      <div className="abs" style={{ left: x, top: y + h - (phone ? 84 : 72), width: w, display: 'flex', justifyContent: 'center' }}>
        {cancellable ? (
          <button className="info-button" style={{ position: 'static', width: btnW, padding: 0 }} onClick={() => close(null)}>
            Cancel
          </button>
        ) : resume ? (
          <button
            ref={resumeRef}
            className={`info-button server-continue${hi === n ? ' on' : ''}`}
            data-testid="server:continue"
            title={resume}
            style={{ position: 'static', maxWidth: w - 2 * pad, padding: '0 28px' }}
            onFocus={() => setHi(n)}
            onClick={() => pick(n)}
          >
            {resume}
          </button>
        ) : (
          <button className="info-button" data-testid="server:ok" style={{ position: 'static', width: btnW, padding: 0 }} onClick={() => pick(hi)}>
            OK
          </button>
        )}
      </div>
    </div>
  );
}
