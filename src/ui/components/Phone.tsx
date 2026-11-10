import type { Skin } from '../skin/skin.ts';
import { CheckBar } from './CheckBar.tsx';
import { useStage } from './Stage.tsx';

/** A box on the stage, in stage px. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Phone layout bands on the phone stage (PHONE_W wide, as tall as the phone): the title bar and
 * menu button, the top-right label, the tab rows, one panel, and Back / Next over the footer line.
 */
export interface PhoneGeom {
  w: number; // stage size
  h: number;
  titleY: number; // the title bar's center (drawMenuTitle at 30 virtual px)
  line: number; // the backdrop's frame line under the title bar (39 virtual px)
  labelY: number; // baseline of the top-right label (LEVEL N, Current Respec Level)
  tabsY: number; // center of the first tab row
  nextY: number; // center of the Back / Next buttons
  navTop: number; // where what sits above Back / Next stops (a few px above the tray's frame line)
}

// side margin of the phone panels
export const PHONE_PAD = 10;
// tab rows: centers this far apart, each tab's touch box this tall
export const PHONE_TAB_ROW = 58;
// the description box's height
export const PHONE_DESC_H = 150;
// the not-affiliated line's room along the bottom edge
const FOOT = 16;
// the skyline backdrop's bottom frame line (texture rows 711-715 of 768) tops the black tray that
// Back / Next sit in
const TRAY_LINE = 711;
const TRAY_TOP = 716;
// Back / Next on phones: their draw scale (the pair nearly meets in the middle of the phone
// stage) and their arrows' centers this far in from the edges
export const PHONE_NEXT_SCALE = 1.3;
export const PHONE_NEXT_X = 46;

/**
 * The phone layout bands for a phone stage of this size.
 *
 * The skyline backdrop is drawn to the stage's full height on a phone, so its frame line sits at
 * 39 virtual px of that height; the title bar sits on it as in the game, and the rest follows.
 *
 * @param st The phone stage.
 * @param label Leave room for a top-right label line (LEVEL N) above the tabs.
 * @return The bands.
 */
export function phoneGeom(st: { w: number; h: number }, label = true): PhoneGeom {
  const vy = st.h / 768;
  const line = Math.round(39 * vy);
  // Back / Next centered in the black tray between the backdrop's bottom frame line and the
  // not-affiliated line; what sits above them stops a few px above that frame line
  const nextY = (TRAY_TOP * vy + st.h - FOOT) / 2;
  return { w: st.w, h: st.h, titleY: 30 * vy, line, labelY: line + 32, tabsY: line + (label ? 70 : 40), nextY, navTop: TRAY_LINE * vy - 5 };
}

// the menu button at the top right: three bars `pitch` apart
export const PHONE_MENU_BTN = { right: 6, w: 58, bar: 6, pitch: 12, pad: 9 };
// the top row's controls (the menu button, the overview's level-log button): their common center
// sits this far above the backdrop's frame line, so the taller level-log button clears it by 8
const TOP_ROW_ABOVE_LINE = 28;

/** @return The center y of the top row's controls, clear of the backdrop's frame line. */
export function phoneTopRowY(g: PhoneGeom): number {
  return g.line - TOP_ROW_ABOVE_LINE;
}

/** @return The menu button's box: its three bars centered on the top row. */
export function phoneMenuButton(g: PhoneGeom): Rect {
  const b = PHONE_MENU_BTN;
  const h = 3 * b.bar + 2 * (b.pitch - b.bar) + 2 * b.pad;
  return { x: g.w - b.right - b.w, y: phoneTopRowY(g) - h / 2, w: b.w, h };
}

/** @return How many rows `n` tabs take on a phone (four go two by two, more go three to a row). */
export function phoneTabRows(n: number): number {
  return n === 4 ? 2 : Math.ceil(n / 3);
}

/**
 * The phone's one panel: under `tabs` tabs and above a block `below` px tall that sits on top of
 * Back / Next (the description box, a counter).
 *
 * @param g Phone bands.
 * @param tabs How many tabs the screen shows.
 * @param below Height of what sits between the panel and Back / Next.
 * @return The panel's frame.
 */
export function phonePanel(g: PhoneGeom, tabs: number, below: number): Rect {
  const top = g.tabsY + (phoneTabRows(tabs) - 1) * PHONE_TAB_ROW + PHONE_TAB_ROW / 2 + 4;
  return { x: PHONE_PAD, y: top, w: g.w - 2 * PHONE_PAD, h: g.navTop - 8 - below - top };
}

/**
 * The description box, right above Back / Next (or above `above` px of something else there).
 * Its left edge leaves room for the icon ring that straddles it.
 *
 * @param g Phone bands.
 * @param above Height kept clear between the box and Back / Next.
 * @return The box.
 */
export function phoneDesc(g: PhoneGeom, above = 0): Rect {
  const x = 50;
  return { x, y: g.navTop - 8 - above - PHONE_DESC_H, w: g.w - x - PHONE_PAD, h: PHONE_DESC_H };
}

/**
 * Row(s) of in-game check bars used as tabs to switch the visible panel on phones: up to three
 * in a row (four go two by two). Switching plays the character creator's tab sound
 * (drawHybridTab: N_Select) unless `clickSounds` says otherwise.
 *
 * @param props.y Center of the first row (default: the phone's tab band).
 * @param props.x Left edge of the rows (default: the phone margin).
 * @param props.width Width of the rows (default: the stage less both margins).
 * @param props.disabled Tabs shown grey and not tappable (nothing to choose there yet).
 * @param props.flash A tab that blinks green twice as it appears (it just became available).
 */
export function PhoneTabs({ skin, labels, active, onChange, y, x = PHONE_PAD, width, disabled, flash, clickSounds = ['n_select'] }: { skin: Skin; labels: string[]; active: number; onChange: (i: number) => void; y?: number; x?: number; width?: number; disabled?: boolean[]; flash?: number; clickSounds?: string[] }) {
  const stage = useStage();
  const y0 = y ?? phoneGeom(stage).tabsY;
  const wd = width ?? stage.w - 2 * PHONE_PAD;
  const perRow = labels.length === 4 ? 2 : Math.min(3, labels.length);
  const cell = wd / perRow;
  const s = 1.3;
  const bulb = 22 * s + 4; // the check box's center from the cell's left edge
  const at = (i: number) => ({ cx: x + (i % perRow) * cell + bulb, cy: y0 + Math.floor(i / perRow) * PHONE_TAB_ROW, wd: cell - bulb - 8 });
  return (
    <>
      {labels.map((l, i) => {
        const { cx, cy, wd: w } = at(i);
        const off = !!disabled?.[i];
        return (
          <CheckBar
            key={l}
            skin={skin}
            x={cx}
            y={cy}
            wd={w}
            scale={s}
            hitPad={(PHONE_TAB_ROW - 38 * s) / 2}
            text={l}
            state={off ? 'unselectable' : i === active ? 'selected' : 'standard'}
            down={!off && i === active}
            clickSounds={clickSounds}
            onClick={off ? undefined : () => onChange(i)}
          />
        );
      })}
      {flash !== undefined && labels[flash] !== undefined
        ? (() => {
            const { cx, cy, wd: w } = at(flash);
            // LockFlash's shape, in green
            return <div className="abs unlock-flash" style={{ left: cx - 19 * s, top: cy - 16 * s, width: w + 17 * s, height: 32 * s, borderRadius: 16 * s, zIndex: 20 }} />;
          })()
        : null}
    </>
  );
}
