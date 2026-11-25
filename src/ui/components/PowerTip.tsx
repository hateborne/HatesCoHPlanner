import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { Archetype, BoostSet, Power } from '../../data/types.ts';
import { allowedSetCategories, allowedTypes, boostHelpText, setRarity, type RarityKind, type SetRarity } from '../../engine/enhance.ts';
import type { Slot } from '../../engine/build.ts';
import type { SetBonusLine } from '../../engine/setbonus.ts';
import { useStore, useTipLevel } from '../../state/store.ts';
import { useHover } from '../hover.ts';
import { FONTS, S } from '../skin/metrics.ts';
import { icon, ui, type Skin } from '../skin/skin.ts';
import { smf } from '../smf.tsx';
import { gameText, MenuFrame } from './Chrome.tsx';
import { Sprite } from './Sprite.tsx';
import { useStage } from './Stage.tsx';
import { floatingRoom, isCut, lockedTurn, pageKeyStep, placeFloating, routeWheel, scrollRoom, toStage, WHEEL_LATCH_MS, wheelScrollsBox, wheelStep, type WheelLatch } from '../floating.ts';

/**
 * The last pointer position in stage px. Captured on the window, so a hover handler that runs
 * on the same mouse event already sees the new position.
 */
export function usePointer(): React.MutableRefObject<{ x: number; y: number }> {
  const stage = useStage();
  const mouse = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const on = (e: MouseEvent) => {
      const wrap = document.querySelector('.stage')?.parentElement;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      mouse.current = { x: ((e.clientX - r.left) / r.width) * stage.w, y: ((e.clientY - r.top) / r.height) * stage.h };
    };
    // mouseout too: React runs onMouseEnter from the mouseout of the element left behind, before
    // the browser's mouseover or mousemove, so without it a tooltip opens where the pointer was
    const kinds = ['mousemove', 'mouseover', 'mouseout'] as const;
    for (const k of kinds) window.addEventListener(k, on, true);
    return () => {
      for (const k of kinds) window.removeEventListener(k, on, true);
    };
  }, [stage.w, stage.h]);
  return mouse;
}

/** A floating box on screen: its scrolling element and the stage height it is drawn on. */
interface ShownBox {
  ref: React.RefObject<HTMLDivElement>;
  stageH: React.MutableRefObject<number>; // read at each turn, so a resize keeps the box's place
  lock: boolean; // it takes every wheel turn and Page key while it is the newest (Floating's lock)
}

// The floating boxes on screen, oldest first (useTallWheel), and what the wheel is latched to.
const shownBoxes: ShownBox[] = [];
let wheelLatch: WheelLatch<ShownBox> | null = null;

/** @return The newest shown box that is cut short, with its element. */
function newestTall(): { box: ShownBox; el: HTMLDivElement } | null {
  for (let i = shownBoxes.length - 1; i >= 0; i--) {
    const box = shownBoxes[i]!;
    const el = box.ref.current;
    if (el && isCut(el)) return { box, el };
  }
  return null;
}

/**
 * Whether a pop-up or dialog is open: a layer marked POPUP_LAYER is on screen. A tooltip left
 * under or over one takes no wheel turn or Page key then.
 *
 * @return Whether one is open.
 */
function popupOpen(): boolean {
  return document.querySelector('[data-popup]') !== null;
}

/** @return Whether a box is still shown and cut short (a wheel latch to it lasts only that long). */
function stillTall(b: ShownBox): boolean {
  const el = b.ref.current;
  return shownBoxes.includes(b) && !!el && isCut(el);
}

/** @return The newest shown box when it holds the wheel (Floating's lock, and cut short), with its element. */
function newestLocked(): { box: ShownBox; el: HTMLDivElement } | null {
  const box = shownBoxes[shownBoxes.length - 1];
  const el = box?.ref.current;
  return box?.lock && el && isCut(el) ? { box, el } : null;
}

/** The window's wheel listener while a floating box is shown (routeWheel decides where a turn goes). */
function onBoxWheel(e: WheelEvent): void {
  const locked = newestLocked();
  if (locked) {
    // a locked box cut short keeps every turn, at its end too, over a pop-up too
    const turn = lockedTurn(e, locked.el);
    if (turn.swallow) e.preventDefault();
    if (!turn.scroll) return;
    const wrap = document.querySelector('.stage')?.parentElement?.getBoundingClientRect();
    locked.el.scrollTop += wheelStep(e, wrap?.height ? locked.box.stageH.current / wrap.height : 1, locked.el.clientHeight);
    return;
  }
  const tall = newestTall();
  const route = routeWheel(e, performance.now(), wheelLatch, tall && { box: tall.box, scroll: tall.el }, stillTall);
  wheelLatch = route.latch;
  const el = route.box?.ref.current;
  if (!route.box || !el || popupOpen()) return;
  e.preventDefault(); // a box keeps its gesture even at its end
  if (!wheelScrollsBox(e, el)) return;
  const wrap = document.querySelector('.stage')?.parentElement?.getBoundingClientRect();
  el.scrollTop += wheelStep(e, wrap?.height ? route.box.stageH.current / wrap.height : 1, el.clientHeight);
}

/**
 * Page Up / Page Down scroll the newest cut-short box while it is shown and can move that way; at
 * its end, while typing, or with a pop-up open, the key does what it would anyway.
 */
function onBoxKey(e: KeyboardEvent): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const t = e.target instanceof HTMLElement ? e.target : null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const locked = newestLocked();
  const tall = locked ?? newestTall();
  const step = tall ? pageKeyStep(e.key, tall.el.clientHeight) : 0;
  if (!tall || !step) return;
  if (locked) {
    // a locked box keeps the key even at its end: the list under it stays where it is
    e.preventDefault();
    if (wheelScrollsBox({ deltaY: step, ctrlKey: false }, tall.el)) tall.el.scrollTop += step;
    return;
  }
  if (!wheelScrollsBox({ deltaY: step, ctrlKey: false }, tall.el) || popupOpen()) return;
  e.preventDefault();
  tall.el.scrollTop += step;
}

/**
 * The wheel while no floating box is shown: a turn latches the gesture to the screen, so a tall
 * tooltip that appears under the pointer as a list scrolls doesn't stop the list (routeWheel,
 * step 2). Sideways movement keeps a latch going too.
 */
function onScreenWheel(e: WheelEvent): void {
  if (!shownBoxes.length && !e.ctrlKey && (e.deltaY || e.deltaX)) wheelLatch = { box: null, until: performance.now() + WHEEL_LATCH_MS };
}

if (typeof window !== 'undefined') {
  window.addEventListener('wheel', onScreenWheel, { capture: true, passive: true });
  // the dev server reloads this file in place: take the old copy's listener away with it
  import.meta.hot?.dispose(() => window.removeEventListener('wheel', onScreenWheel, { capture: true }));
}

/**
 * Scroll a floating box with the mouse wheel, and Page Up / Page Down, while it is cut short
 * (taller than floatingRoom).
 *
 * The box lets the pointer through, so it never takes the hover from the bar under it, and the
 * wheel goes to the screen below. A wheel gesture that starts while the newest cut-short box can
 * move that way scrolls the box instead, and stays with it until the wheel rests; one that starts
 * past the box's end, or on the list before the box appeared, scrolls the list (routeWheel).
 *
 * A locked box (the pet pane's power cards) that is cut short takes every turn and Page key while
 * it is the newest, at its end too, so what is under it never scrolls away (lockedTurn); one that
 * fits lets them through.
 *
 * @param ref The box (its scrolling element).
 * @param stageH The stage's height in stage px.
 * @param lock It takes every turn.
 */
function useTallWheel(ref: React.RefObject<HTMLDivElement>, stageH: number, lock: boolean): void {
  const height = useRef(stageH);
  useLayoutEffect(() => {
    height.current = stageH;
  }, [stageH]);
  useEffect(() => {
    const entry: ShownBox = { ref, stageH: height, lock };
    shownBoxes.push(entry);
    if (shownBoxes.length === 1) {
      window.addEventListener('wheel', onBoxWheel, { capture: true, passive: false });
      window.addEventListener('keydown', onBoxKey, true);
    }
    return () => {
      shownBoxes.splice(shownBoxes.indexOf(entry), 1);
      if (!shownBoxes.length) {
        window.removeEventListener('wheel', onBoxWheel, { capture: true });
        window.removeEventListener('keydown', onBoxKey, true);
      }
    };
  }, [ref, lock]);
}

/**
 * A floating box under a point (or above it, or beside the hovered bar: placeFloating), kept on
 * screen and sized to its content. `left` is where the box starts relative to x; `pad` reserves room on the left for
 * anything drawn outside the box (the description tip's icon ring); `avoid` is the hovered bar
 * (window px), which the box keeps clear of (placeFloating). The box gets `maxH` (floatingRoom):
 * one that is taller is cut to it and scrolls with the wheel (useTallWheel). While it is cut short
 * it also gets `bar` and `gutter` (scrollRoom): the box widens by `bar` and pads its right side by
 * `gutter`, so its text keeps its width and doesn't rewrap. The scrollbar only shows there is more
 * (the box lets the pointer through, so it can't be dragged). Give each item its own `key`, so a
 * new one starts at the top. With `lock` a box cut short takes every wheel turn while it shows, even
 * at its end (useTallWheel).
 */
export function Floating({ x, y, w, gap, left = -140, pad = 0, avoid, lock = false, render }: { x: number; y: number; w: number; gap: number; left?: number; pad?: number; avoid?: DOMRect; lock?: boolean; render: (box: { x: number; y: number; h: number; maxH: number; bar: number; gutter: number }, measure: React.RefObject<HTMLDivElement>) => ReactNode }) {
  const stage = useStage();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ h: 0, bar: 0, gutter: 0 });
  const last = useRef(size); // the size last asked for (measure)
  // the box's height and, while it is cut short, its scrollbar's room; it settles once they match
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const borders = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const { bar, gutter } = scrollRoom(isCut(el), Math.max(0, el.offsetWidth - el.clientWidth - borders));
    const h = el.offsetHeight;
    // no update at all when nothing changed: the ResizeObserver's update waits at a lower priority,
    // and React replays the layout effect's updates over it on every render, each a new object,
    // so an update that only repeats the size would never let the box settle
    // `last` may run ahead of the rendered size only until React renders the queued update, which
    // it keeps (a discarded render replays it); an unmounted box no longer matters
    const was = last.current;
    if (was.h === h && was.bar === bar && was.gutter === gutter) return;
    last.current = { h, bar, gutter };
    setSize(last.current);
  }, []);
  // measured after every render on purpose (the content changes size)
  useLayoutEffect(() => measure());
  // and when the box resizes without this component rendering: a part inside it that redraws on
  // its own (the Advanced info, when the version's pets or info file arrives) would otherwise leave
  // the box where its shorter height put it, and without its scrollbar's room
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => measure());
    watch.observe(el);
    return () => watch.disconnect();
  }, [measure]);
  useTallWheel(ref, stage.h, lock);
  const { h, bar, gutter } = size;
  const { x: bx, y: by } = placeFloating({ x, y, w: w + bar, h, gap, left, pad }, stage, toStage(avoid, stage));
  return (
    // over the side Totals tab and pane (60), under the phone menu, notices and dialogs
    <div className="abs" style={{ left: 0, top: 0, width: 0, height: 0, zIndex: 65, pointerEvents: 'none' }}>
      {render({ x: bx, y: by, h, maxH: floatingRoom(stage), bar, gutter }, ref)}
    </div>
  );
}

const SHIFT_HINT = 'Hold SHIFT for the advanced tooltip.';

/**
 * The build screen's normal hover tip: the power's description drawn like the level-up help box
 * (DescBox) -- a framed panel, the icon in powers_description_iconring on its left edge and the
 * long help in the skin's description green.
 */
export function DescTip({ skin, power, x, y, avoid, hint }: { skin: Skin; power: Power; x: number; y: number; avoid?: DOMRect; hint?: boolean }) {
  const ring = 72 * S;
  const px = FONTS.smf_12.size * S;
  const pad = 12 * S;
  const w = 900;
  return (
    <Floating
      key={power.id}
      x={x}
      y={y}
      w={w}
      gap={80}
      pad={ring / 2}
      avoid={avoid}
      render={(b, ref) => {
        const h = Math.max(ring + 2 * pad, b.h);
        return (
          <>
            <MenuFrame x={b.x} y={b.y} w={w} h={h} skin={skin} style={{ background: skin.panel }} />
            <Sprite src={ui('creation/powers/powers_description_iconring', skin)} x={b.x - ring / 2} y={b.y + h / 2 - ring / 2} w={ring} h={ring} z={3} />
            <Sprite src={icon('powers', power.icon || 'power_missing')} x={b.x - 16 * S} y={b.y + h / 2 - 16 * S} w={32 * S} h={32 * S} z={4} />
            <div
              ref={ref}
              className="abs scroll-y"
              style={{ left: b.x + ring / 2 + pad, top: b.y, width: w - ring / 2 - 2 * pad + b.bar, maxHeight: b.maxH, boxSizing: 'border-box', padding: `${pad}px ${b.gutter}px ${pad}px 0`, color: skin.desc, fontFamily: "'Montreal'", fontSize: px, lineHeight: `${Math.round(1.255 * px)}px`, zIndex: 5 }}
            >
              {smf(power.lh || power.sh)}
              {hint ? <div style={{ marginTop: 6, color: '#8fa1b8', fontSize: px * 0.8 }}>{SHIFT_HINT}</div> : null}
            </div>
          </>
        );
      }}
    />
  );
}

// the game's power tooltip (power name, short help, allowed enhancement types and set categories)
export const TIP_PX = 11 * S;
export const TIP = { name: '#a9dcff', text: '#ffffff', list: '#8fcfff' };

/**
 * The slot details block: name, short help, allowed enhancements and set categories. Sizes are
 * relative to the box's font size.
 *
 * @param props.longColor Show the long description in this color instead of the short help
 *   (the phone's long-press tooltip, which stands in for both desktop tooltips).
 */
export function SlotDetails({ gd, power, longColor }: { gd: GameData; power: Power; longColor?: string }) {
  const types = allowedTypes(gd, power);
  const cats = allowedSetCategories(gd, power);
  return (
    <>
      <div style={{ color: TIP.name, fontWeight: 700, fontSize: '1.1em' }}>{power.dn}</div>
      {longColor ? <div style={{ color: longColor }}>{smf(power.lh || power.sh)}</div> : <div style={{ color: TIP.text }}>{smf(power.sh)}</div>}
      {types.length ? (
        <>
          <div style={{ color: TIP.text, marginTop: '0.9em' }}>Allowed Enhancements:</div>
          <div style={{ color: TIP.list }}>{types.join(', ')}</div>
        </>
      ) : (
        <div style={{ color: TIP.list, marginTop: '0.9em' }}>This power cannot be enhanced.</div>
      )}
      {cats.length ? (
        <>
          <div style={{ color: TIP.text, marginTop: '0.9em' }}>Allowed Enhancements Set Categories:</div>
          <div style={{ color: TIP.list }}>{cats.join(', ')}</div>
        </>
      ) : null}
    </>
  );
}

/**
 * The game's power hover tooltip box (screenshot: a dark panel with a thin rounded blue border):
 * the slot details, and in the Advanced view a divider and the detailed info below them.
 */
export function SlotTip({ gd, skin, power, x, y, avoid, hint, advanced, w = 640 }: { gd: GameData; skin: Skin; power: Power; x: number; y: number; avoid?: DOMRect; hint?: boolean; advanced?: ReactNode; w?: number }) {
  return (
    <Floating
      key={power.id}
      x={x}
      y={y}
      w={advanced ? 760 : w}
      gap={34}
      left={30}
      avoid={avoid}
      render={(b, ref) => (
        <div
          ref={ref}
          className="abs scroll-y"
          style={{ left: b.x, top: b.y, width: (advanced ? 760 : w) + b.bar, maxHeight: b.maxH, boxSizing: 'border-box', padding: `${TIP_PX * 0.6}px ${TIP_PX * 0.8 + b.gutter}px ${TIP_PX * 0.6}px ${TIP_PX * 0.8}px`, background: skin.panel, border: `2px solid ${skin.panelBorder}`, borderRadius: TIP_PX * 0.6, fontFamily: "'Montreal'", fontSize: TIP_PX, lineHeight: 1.3, color: TIP.text }}
        >
          <SlotDetails gd={gd} power={power} />
          {advanced ? (
            <>
              <div style={{ borderTop: '1px solid #6d7fd8', margin: `${TIP_PX * 0.8}px 0` }} />
              {advanced}
            </>
          ) : null}
          {hint ? <div style={{ marginTop: 6, color: '#8fa1b8', fontSize: TIP_PX * 0.8 }}>{SHIFT_HINT}</div> : null}
        </div>
      )}
    />
  );
}

/** @return Whether the Shift hint belongs on a normal tooltip (only while tooltips are Enabled). */
export function useShiftHint(): boolean {
  return useStore((s) => s.tips === 'enabled');
}

// the client's named SMF colors (smf_util.c)
const SMF = { infoBlue: '#aadeff', paragon: '#00deff', springGreen: '#00ff7f', gray: '#808080', red: '#ff0000', goldenRod: '#daa520' };

/** @return CSS that paints text with a left-to-right gradient. */
const gradientText = (from: string, to: string): CSSProperties => ({
  backgroundImage: `linear-gradient(90deg, ${from}, ${to})`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
});

// The Set Rarity line's colours, chosen by the owner from the Homecoming wiki's rarity icons. The
// game's own tooltip doesn't name the rarity (only the icon border shows it), so none of this is
// ported from the client.
const RARITY_STYLE: Record<Exclude<RarityKind, 'event'>, CSSProperties> = {
  uncommon: { color: '#dcb600' },
  rare: { color: '#fc7337' },
  veryRare: { color: '#a85df3' },
  pvp: gradientText('#6b8cf0', '#f04a32'), // the icon's blue left half to its red right half, lightened
  archetype: { color: '#f0b480' },
  // a brighter Archetype Origin colour with a glow in the base colour, in the regular face: the
  // heavy one under the glow was hard to read
  superiorArchetype: { fontFamily: "'Montreal'", color: '#ffe2c6', textShadow: '1px 0 #f0b480, -1px 0 #f0b480, 0 1px #f0b480, 0 -1px #f0b480' },
  winter: gradientText('#d4eafc', '#f0c070'), // snowflake (a little bluer) to the border's gold
  superiorWinter: gradientText('#d4eafc', '#ca7dde'),
};
// event sets: the event's name in its icon's centre-to-outer-ring colours
const EVENT_STYLE: Record<string, CSSProperties> = {
  'Summer Blockbuster': gradientText('#fef002', '#e16e64'),
  'Spring Event Wedding': gradientText('#ffd5d4', '#fa2b29'),
};

/**
 * The colour a set's rarity is written in: the Set Rarity line's own (RARITY_STYLE), an event
 * set's by its event.
 *
 * @param r The set's rarity (setRarity), or undefined for a set without one.
 * @return The CSS for its text; nothing for no rarity.
 */
export function rarityStyle(r: SetRarity | undefined): CSSProperties {
  if (!r) return {};
  return r.kind === 'event' ? (EVENT_STYLE[r.event ?? ''] ?? {}) : RARITY_STYLE[r.kind];
}

// bold in the game's heavy face (mont_hvbold, the client's bold game font) instead of a
// browser-synthesised bold of the tooltip's demibold face, which barely shows
const BOLD: CSSProperties = { fontFamily: "'MontrealHeavy'", fontWeight: 'normal' };

/** The rarity name on the tooltip's Set Rarity line, in its tier's colours (bold, but for a glowing one). */
function RarityText({ r }: { r: SetRarity }) {
  if (r.kind === 'event') {
    return (
      <span style={BOLD}>
        {r.name}
        {r.event ? (
          <>
            {' ('}
            <span style={EVENT_STYLE[r.event]}>{r.event}</span>
            {')'}
          </>
        ) : null}
      </span>
    );
  }
  return <span style={{ ...BOLD, ...RARITY_STYLE[r.kind] }}>{r.name}</span>;
}

/**
 * The game's enhancement tooltip (uiEnhancementFormatText + uiEnhancementGetInfoText) as a
 * floating box under the pointer; the text is EnhDetails. Give it a `key` naming the power and
 * slot (as the overview does), so a tall one starts at the top for each slot.
 *
 * @param props.slots The power's slots (which pieces of the set are in it).
 * @param props.slot Index of the hovered slot.
 * @param props.level 0-based character level (attuned values and help-text numbers).
 */
export function EnhTip({ gd, skin, at, slots, slot, level, x, y }: { gd: GameData; skin: Skin; at: Archetype; slots: Slot[]; slot: number; level: number; x: number; y: number }) {
  if (!slots[slot]?.enh) return null;
  return (
    <Floating
      key={`${slot}:${slots[slot]?.enh?.boost}`}
      x={x}
      y={y}
      w={620}
      gap={34}
      left={30}
      render={(box, ref2) => (
        <div
          ref={ref2}
          className="abs scroll-y"
          style={{ left: box.x, top: box.y, width: 620 + box.bar, maxHeight: box.maxH, boxSizing: 'border-box', padding: `${TIP_PX * 0.6}px ${TIP_PX * 0.8 + box.gutter}px ${TIP_PX * 0.6}px ${TIP_PX * 0.8}px`, background: skin.panel, border: `2px solid ${skin.panelBorder}`, borderRadius: TIP_PX * 0.6, fontFamily: "'Montreal'", fontSize: TIP_PX, lineHeight: 1.3, color: '#ffffff' }}
        >
          <EnhDetails gd={gd} at={at} slots={slots} slot={slot} level={level} />
        </div>
      )}
    />
  );
}

/**
 * The enhancement tooltip's text: name, short help, the category line for non-set pieces, the
 * help text with its values, the red / paragon notes, and for set pieces the set (n slotted in
 * this power / pieces), its category, every piece (highlighted when slotted here) and the set
 * bonuses (green once earned). Sizes are relative to the box's font size.
 *
 * @param props.slots The power's slots (which pieces of the set are in it).
 * @param props.slot Index of the slot.
 * @param props.level 0-based character level (attuned values and help-text numbers).
 */
export function EnhDetails({ gd, at, slots, slot, level }: { gd: GameData; at: Archetype; slots: Slot[]; slot: number; level: number }) {
  const e = slots[slot]?.enh;
  const b = e ? gd.powerById.get(e.boost) : undefined;
  if (!e || !b) return null;
  const ref = gd.boostSetOf.get(b.id);
  const set = ref?.set;
  const rarity = set ? setRarity(set) : undefined;
  const inPower = slots.map((s) => s.enh?.boost).filter((id): id is number => id !== undefined);
  const numSlotted = set ? inPower.filter((id) => gd.boostSetOf.get(id)?.set.id === set.id).length : 0;
  const notes: { text: string; color: string }[] = [];
  if (!b.bcm) notes.push({ text: 'You may not combine this Enhancement with any others.', color: SMF.red });
  if (b.ntr) notes.push({ text: 'You may not trade this Enhancement.', color: SMF.red });
  if (b.bab) notes.push({ text: 'ACCOUNT BOUND - This enhancement can only traded to other characters on this account via global mail.', color: SMF.goldenRod });
  if (b.bup) notes.push({ text: "ATTUNED - This enhancement's effective level is always the same as the user's.  In addition, its effectiveness will increase when the user levels up.", color: SMF.goldenRod });
  if (b.bie) notes.push({ text: 'Effectiveness does not vary as Security Level changes', color: SMF.paragon });
  const gap = { marginTop: '0.9em' };
  return (
    <>
          <div style={{ color: SMF.infoBlue, fontWeight: 700, fontSize: '1.1em' }}>{b.dn}</div>
          <div style={{ color: SMF.paragon }}>{b.sh}</div>
          {!set && b.cat ? <div style={{ color: SMF.paragon }}>{b.cat}</div> : null}
          <div>{smf(boostHelpText(gd, at, e, level))}</div>
          {notes.length ? (
            <div style={gap}>
              {notes.map((n, i) => (
                <div key={i} style={{ color: n.color }}>
                  {n.text}
                </div>
              ))}
            </div>
          ) : null}
          {set ? (
            <>
              <div style={gap}>
                <div style={{ color: SMF.infoBlue }}>
                  Set: {set.dn} ({numSlotted}/{set.slots.length})
                </div>
                <div>Enhancements Set Category: {set.grp}</div>
                {rarity ? (
                  <div>
                    Set Rarity: <RarityText r={rarity} />
                  </div>
                ) : null}
                {set.slots.map((variants, i) => {
                  const master = variants[0] !== undefined ? gd.powerById.get(variants[0]) : undefined;
                  const here = variants.some((id) => inPower.includes(id));
                  return (
                    <div key={i} style={{ color: here ? SMF.paragon : SMF.gray }}>
                      {master?.dn ?? ''}
                    </div>
                  );
                })}
              </div>
              <div style={gap}>
                <SetBonusList gd={gd} set={set} pieces={numSlotted} />
              </div>
            </>
          ) : null}
    </>
  );
}

// the picker's set bonuses: a bonus already earned glows; one the chosen pieces would newly earn is
// about a fifth lighter and glows stronger
const BONUS_GLOW = '0 0 6px rgba(0, 255, 127, 0.55)';
const BONUS_NEW = '#66ffb2';
const BONUS_NEW_GLOW = '0 0 5px rgba(255, 255, 255, 0.45), 0 0 12px #00ff7f';

/**
 * A set's bonuses as the game's enhancement tooltip lists them: "Set Bonus:", then one line per
 * bonus with the pieces it takes, green once the power holds that many and grey until then.
 *
 * @param props.set The set.
 * @param props.pieces How many of its pieces the power holds.
 */
export function SetBonusList({ gd, set, pieces }: { gd: GameData; set: BoostSet; pieces: number }) {
  const lines = set.bon.filter((bn) => bn.min > 1).flatMap((bn) => [...bn.auto, ...(bn.bp !== undefined ? [bn.bp] : [])].map((power): SetBonusLine => ({ min: bn.min, power, state: pieces >= bn.min ? 'earned' : 'none' })));
  return <BonusLines gd={gd} lines={lines} rest={SMF.gray} />;
}

/**
 * "Set Bonus:" and its lines, each colored by how it stands.
 *
 * @param props.lines The bonuses, in the set's order.
 * @param props.rest Color of the bonuses not earned.
 * @param props.glow The earned bonuses glow, and the newly earned ones are lighter and glow
 *   stronger (the enhancement picker); without it an earned bonus is plain green.
 */
function BonusLines({ gd, lines, rest, glow }: { gd: GameData; lines: SetBonusLine[]; rest: string; glow?: boolean }) {
  /** @return A line's look. */
  const look = (l: SetBonusLine): CSSProperties => {
    if (l.state === 'none') return { color: rest };
    if (!glow) return { color: SMF.springGreen };
    return l.state === 'earned' ? { color: SMF.springGreen, textShadow: BONUS_GLOW } : { color: BONUS_NEW, textShadow: BONUS_NEW_GLOW };
  };
  return (
    <>
      <div style={{ color: SMF.infoBlue }}>Set Bonus:</div>
      {lines.map((l, i) => (
        <div key={i} data-bonus={l.state} style={look(l)}>
          ({l.min}) {gameText(gd.powerById.get(l.power)?.lh)}
        </div>
      ))}
    </>
  );
}

/**
 * A set's name and its bonuses: what the enhancement picker shows for a set name (hovered, or
 * long pressed on a phone). The bonuses not earned read white here, where the list is the whole
 * point; the earned ones glow, the newly earned more. Sizes are relative to the box's font size.
 *
 * @param props.set The set.
 * @param props.lines Its bonuses as they stand for the power with the chosen pieces placed
 *   (setBonusLines).
 */
export function SetDetails({ gd, set, lines }: { gd: GameData; set: BoostSet; lines: SetBonusLine[] }) {
  return (
    <>
      <div style={{ color: SMF.infoBlue, fontWeight: 700, fontSize: '1.1em' }}>{set.dn}</div>
      <BonusLines gd={gd} lines={lines} rest="#ffffff" glow />
    </>
  );
}

/**
 * The enhancement picker's hover box for a set name (useHover.setTip): the set's bonuses, in the
 * enhancement tooltip's box. Nothing while tooltips are Disabled.
 */
export function SetTipLayer({ gd, skin }: { gd: GameData; skin: Skin }) {
  const tip = useHover((h) => h.setTip);
  const level = useTipLevel();
  if (!tip || level === 'off') return null;
  return (
    <Floating
      key={tip.set.id}
      x={tip.x}
      y={tip.y}
      w={620}
      gap={34}
      left={30}
      render={(box, ref) => (
        <div
          ref={ref}
          className="abs scroll-y"
          role="tooltip"
          style={{ left: box.x, top: box.y, width: 620 + box.bar, maxHeight: box.maxH, boxSizing: 'border-box', padding: `${TIP_PX * 0.6}px ${TIP_PX * 0.8 + box.gutter}px ${TIP_PX * 0.6}px ${TIP_PX * 0.8}px`, background: skin.panel, border: `2px solid ${skin.panelBorder}`, borderRadius: TIP_PX * 0.6, fontFamily: "'Montreal'", fontSize: TIP_PX, lineHeight: 1.3, color: '#ffffff' }}
        >
          <SetDetails gd={gd} set={tip.set} lines={tip.lines} />
        </div>
      )}
    />
  );
}
