import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { Archetype, Power } from '../../data/types.ts';
import { allowedSetCategories, allowedTypes, boostHelpText, setRarity, type RarityKind, type SetRarity } from '../../engine/enhance.ts';
import type { Slot } from '../../engine/build.ts';
import { useStore } from '../../state/store.ts';
import { FONTS, S } from '../skin/metrics.ts';
import { icon, ui, type Skin } from '../skin/skin.ts';
import { smf } from '../smf.tsx';
import { gameText, MenuFrame } from './Chrome.tsx';
import { Sprite } from './Sprite.tsx';
import { useStage } from './Stage.tsx';
import { placeFloating, toStage } from '../floating.ts';

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

/**
 * A floating box under a point (or above it, or beside the hovered bar: placeFloating), kept on
 * screen and sized to its content. `left` is where the box starts relative to x; `pad` reserves room on the left for
 * anything drawn outside the box (the description tip's icon ring); `avoid` is the hovered bar
 * (window px), which the box keeps clear of (placeFloating).
 */
function Floating({ x, y, w, gap, left = -140, pad = 0, avoid, render }: { x: number; y: number; w: number; gap: number; left?: number; pad?: number; avoid?: DOMRect; render: (box: { x: number; y: number; h: number }, measure: React.RefObject<HTMLDivElement>) => ReactNode }) {
  const stage = useStage();
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  // measured after every render on purpose (the content changes size); it settles once h matches
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const v = ref.current?.offsetHeight ?? 0;
    if (v !== h) setH(v);
  });
  const { x: bx, y: by } = placeFloating({ x, y, w, h, gap, left, pad }, stage, toStage(avoid, stage));
  return (
    // over the side Totals tab and pane (60), under the phone menu, notices and dialogs
    <div className="abs" style={{ left: 0, top: 0, width: 0, height: 0, zIndex: 65, pointerEvents: 'none' }}>
      {render({ x: bx, y: by, h }, ref)}
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
            <MenuFrame x={b.x} y={b.y} w={w} h={h} skin={skin} style={{ background: '#000314' }} />
            <Sprite src={ui('creation/powers/powers_description_iconring', skin)} x={b.x - ring / 2} y={b.y + h / 2 - ring / 2} w={ring} h={ring} z={3} />
            <Sprite src={icon('powers', power.icon || 'power_missing')} x={b.x - 16 * S} y={b.y + h / 2 - 16 * S} w={32 * S} h={32 * S} z={4} />
            <div
              ref={ref}
              className="abs"
              style={{ left: b.x + ring / 2 + pad, top: b.y, width: w - ring / 2 - 2 * pad, padding: `${pad}px 0`, color: skin.desc, fontFamily: "'Montreal'", fontSize: px, lineHeight: `${Math.round(1.255 * px)}px`, zIndex: 5 }}
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
const TIP = { name: '#a9dcff', text: '#ffffff', list: '#8fcfff' };

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
export function SlotTip({ gd, power, x, y, avoid, hint, advanced, w = 640 }: { gd: GameData; power: Power; x: number; y: number; avoid?: DOMRect; hint?: boolean; advanced?: ReactNode; w?: number }) {
  return (
    <Floating
      x={x}
      y={y}
      w={advanced ? 760 : w}
      gap={34}
      left={30}
      avoid={avoid}
      render={(b, ref) => (
        <div
          ref={ref}
          className="abs"
          style={{ left: b.x, top: b.y, width: advanced ? 760 : w, boxSizing: 'border-box', padding: `${TIP_PX * 0.6}px ${TIP_PX * 0.8}px`, background: 'rgba(0,2,24,0.97)', border: '2px solid #3a55d6', borderRadius: TIP_PX * 0.6, fontFamily: "'Montreal'", fontSize: TIP_PX, lineHeight: 1.3, color: TIP.text }}
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
 * floating box under the pointer; the text is EnhDetails.
 *
 * @param props.slots The power's slots (which pieces of the set are in it).
 * @param props.slot Index of the hovered slot.
 * @param props.level 0-based character level (attuned values and help-text numbers).
 */
export function EnhTip({ gd, at, slots, slot, level, x, y }: { gd: GameData; at: Archetype; slots: Slot[]; slot: number; level: number; x: number; y: number }) {
  if (!slots[slot]?.enh) return null;
  return (
    <Floating
      x={x}
      y={y}
      w={620}
      gap={34}
      left={30}
      render={(box, ref2) => (
        <div
          ref={ref2}
          className="abs"
          style={{ left: box.x, top: box.y, width: 620, boxSizing: 'border-box', padding: `${TIP_PX * 0.6}px ${TIP_PX * 0.8}px`, background: 'rgba(0,2,24,0.97)', border: '2px solid #3a55d6', borderRadius: TIP_PX * 0.6, fontFamily: "'Montreal'", fontSize: TIP_PX, lineHeight: 1.3, color: '#ffffff' }}
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
                <div style={{ color: SMF.infoBlue }}>Set Bonus:</div>
                {set.bon
                  .filter((bn) => bn.min > 1)
                  .flatMap((bn, i) =>
                    [...bn.auto, ...(bn.bp !== undefined ? [bn.bp] : [])].map((pid, j) => (
                      <div key={`${i}:${j}`} style={{ color: numSlotted >= bn.min ? SMF.springGreen : SMF.gray }}>
                        ({bn.min}) {gameText(gd.powerById.get(pid)?.lh)}
                      </div>
                    )),
                  )}
              </div>
            </>
          ) : null}
    </>
  );
}
