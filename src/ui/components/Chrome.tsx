/**
 * Shared front-end chrome, each ported from its client drawing function (uiUtilMenu.c unless
 * noted) with sizes from the source: positions in virtual 1024x768 units (vx/vy), sprites and
 * text at the uniform screen scale S.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { FONTS, getDevPx, REF_SCREEN_SCALE, S, snap, SY, textWidth, vs, vx, vy } from '../skin/metrics.ts';
import { CLR_HIGH, CLR_SHADOW, icon as iconUrl, ui, type Skin } from '../skin/skin.ts';
import { longPress, pressKeys, touchPress } from '../press.ts';
import { play } from '../sound.ts';
import { GameText, useFontsReady } from './GameText.tsx';
import { PHONE_NEXT_SCALE, PHONE_NEXT_X, phoneDesc, phoneGeom } from './Phone.tsx';
import { Sprite } from './Sprite.tsx';
import { smf } from '../smf.tsx';
import { useStage } from './Stage.tsx';

const TITLE_SCALE = 1.5;
// phones: the title bar ends this far from the right edge, clear of the menu button
const PHONE_TITLE_END = 72;

/**
 * drawMenuTitle(10*sx, 30*sy, s): glowing dot, black bar with pipes and right cap that slides
 * open by 30s per frame, and the title_18 x 1.5 title starting on top of the dot.
 *
 * @param props.reserve Phones: stage px kept free at the right besides the menu button (the
 *   overview's level-log button).
 */
export function TitleBar({ skin, text, scale: scaleIn, reserve = 0 }: { skin: Skin; text: string; scale?: number; reserve?: number }) {
  useFontsReady();
  const stage = useStage();
  const x = stage.phone ? 10 : vx(10);
  // phones: shrunk to end before the menu button at the top right (and `reserve` more stage px)
  const fitPhone = () => (stage.w - PHONE_TITLE_END - reserve - x) / (textWidth(FONTS.title_18, FONTS.title_18.size * TITLE_SCALE, text) + 45);
  const s = scaleIn ?? (stage.phone ? Math.min(S * 0.8, fitPhone()) : S);
  const y = stage.phone ? phoneGeom(stage).titleY : vy(30);
  const strwd = textWidth(FONTS.title_18, FONTS.title_18.size * TITLE_SCALE * s, text);
  const wd = strwd + 45 * s;
  const [acwd, setAcwd] = useState(45 * s);
  // the bar slides open for a new title; a resize (which re-measures the title) just resizes it
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (opened.current === text) {
      setAcwd(wd);
      return;
    }
    opened.current = text;
    setAcwd(45 * s);
    let w = 45 * s;
    const t = window.setInterval(() => {
      w = Math.min(wd, w + 30 * s);
      setAcwd(w);
      if (w >= wd) window.clearInterval(t);
    }, 1000 / 30);
    return () => window.clearInterval(t);
  }, [text, wd, s]);
  const dir = 'creation/common/titlebar';
  const praet = skin.name === 'praetorian';
  const colors: [string, string] = praet ? ['#e6daa4', '#e6daa4'] : ['#ffff00', '#ffa500'];
  return (
    <div className="abs" style={{ left: 0, top: 0, width: 0, height: 0, zIndex: 30 }}>
      {/* drawMenuTitle's black: a white_tex rectangle from the dot (Praetorian: the screen edge) plus
          the frame_blue_background UR / LR corners stretched over each other (a square end), all
          ending 7 short of the cap's right edge -- inside the cap, never past it */}
      <div className="abs" style={{ left: praet ? 0 : x + 24.5 * s, top: y - 15 * s, width: Math.max(0, praet ? x + acwd - 7 * s : acwd - 31.5 * s), height: 30 * s, background: '#000' }} />
      <Sprite src={ui(`${dir}/titlebar_frame_horiz`, skin)} x={x + 23.5 * s} y={y - 19 * s} w={Math.max(0, acwd - 45 * s)} h={4 * s} z={2} />
      <Sprite src={ui(`${dir}/titlebar_frame_horiz`, skin)} x={x + 23.5 * s} y={y + 15 * s} w={Math.max(0, acwd - 45 * s)} h={4 * s} z={2} />
      <Sprite src={ui(`${dir}/titlebar_frame_cap_r`, skin)} x={x + acwd - 22 * s} y={y - 19 * s} w={22 * s} h={38 * s} z={3} />
      {!praet ? (
        <>
          <Sprite src={ui(`${dir}/titlebar_dot_glow`, skin)} x={x - (1.25 * 47 * s - 47 * s) / 2} y={y - (1.25 * 47 * s) / 2} w={1.25 * 47 * s} h={1.25 * 47 * s} z={3} tint="rgba(255,255,255,0.53)" style={{ animation: 'dotpulse 2.09s ease-in-out infinite' }} />
          <Sprite src={ui(`${dir}/titlebar_dot`, skin)} x={x} y={y - 23 * s} w={47 * s} h={47 * s} z={4} />
        </>
      ) : null}
      {/* text clipped to (x + 13.5s, acwd - 72s) while the bar animates open */}
      <div className="abs" style={{ left: x + 13.5 * s, top: y - 40 * s, width: acwd < wd ? Math.max(0, acwd - 72 * s) : strwd + 40, height: 80 * s, overflow: 'hidden', zIndex: 6 }}>
        <GameText font="title_18" scale={TITLE_SCALE * s} x={0} y={40 * s + 13.5 * s} colors={colors} text={text} />
      </div>
    </div>
  );
}

/**
 * drawMenuFrame: 16px corner pieces and 4px pipes, which the client never upscales, over a
 * 0x00000088 fill. Hero frames use the blue textures; villain/Praetorian use their V_/P_ sets.
 */
export function MenuFrame({ x: x0, y: y0, w: w0, h: h0, r25, outer, children, style, skin }: { x: number; y: number; w: number; h: number; r25?: boolean; outer?: boolean; children?: ReactNode; style?: CSSProperties; skin?: Skin }) {
  // device-aligned box so the corner and pipe pieces tile cleanly
  const x = snap(x0);
  const y = snap(y0);
  const w = snap(x0 + w0) - x;
  const h = snap(y0 + h0) - y;
  const c = r25 ? 29 : 16;
  const dir = 'creation/common/frame/frame_blue_4px';
  const r = r25 ? '25r' : '12r';
  const bg = outer ? 'transparent' : 'rgba(0,0,0,0.533)';
  return (
    <div className="abs" style={{ left: x, top: y, width: w, height: h, ...style, background: undefined, border: undefined }}>
      <div className="abs" style={{ left: 2, top: 2, right: 2, bottom: 2, background: style?.background ?? bg, borderRadius: c / 2 }} />
      <Sprite src={ui(`${dir}/frame_blue_4px_${r}_ul`, skin)} x={0} y={0} w={c} h={c} />
      <Sprite src={ui(`${dir}/frame_blue_4px_${r}_ur`, skin)} x={w - c} y={0} w={c} h={c} />
      <Sprite src={ui(`${dir}/frame_blue_4px_${r}_ll`, skin)} x={0} y={h - c} w={c} h={c} />
      <Sprite src={ui(`${dir}/frame_blue_4px_${r}_lr`, skin)} x={w - c} y={h - c} w={c} h={c} />
      <Sprite src={ui(`${dir}/frame_blue_4px_horiz`, skin)} x={c} y={0} w={Math.max(0, w - 2 * c)} h={4} />
      <Sprite src={ui(`${dir}/frame_blue_4px_horiz`, skin)} x={c} y={h - 4} w={Math.max(0, w - 2 * c)} h={4} />
      <Sprite src={ui(`${dir}/frame_blue_4px_vert`, skin)} x={0} y={c} w={4} h={Math.max(0, h - 2 * c)} />
      <Sprite src={ui(`${dir}/frame_blue_4px_vert`, skin)} x={w - 4} y={c} w={4} h={Math.max(0, h - 2 * c)} />
      {children}
    </div>
  );
}

/**
 * drawNextButton: 64x64 arrow, 216x36 fade tail and 64x36 after-image at scale s, label in
 * game_12 x 1.5 (Montreal-DemiBold, outlined) at x + 37s (left) or right-aligned to x - 32s,
 * baseline y + 7s. Called at (40*sx, 740*sy) and (980*sx, 740*sy).
 */
export function NextButton({ skin, dir, text, locked, glow, onClick, y: yIn, scale: scaleIn }: { skin: Skin; dir: 'left' | 'right'; text: string; locked?: boolean; glow?: boolean; onClick?: () => void; y?: number; scale?: number }) {
  useFontsReady();
  const [hover, setHover] = useState(false);
  const stage = useStage();
  const s = scaleIn ?? (stage.phone ? PHONE_NEXT_SCALE : S);
  const y = yIn ?? (stage.phone ? phoneGeom(stage).nextY : vy(740));
  const x = dir === 'left' ? (stage.phone ? PHONE_NEXT_X : vx(40)) : stage.phone ? stage.w - PHONE_NEXT_X : vx(980);
  const d = dir === 'left' ? 'l' : 'r';
  const l = locked ? 'locked_' : '';
  const nb = 'creation/common/nextbuttons';
  const lit = hover && !locked;
  const praet = skin.name === 'praetorian';
  const colors: [string, string] = locked
    ? ['#ffffff', '#aaaaaa']
    : lit
      ? ['#ffffff', skin.name === 'villain' ? '#ff4444' : praet ? '#ffffff' : '#8888ff']
      : praet
        ? ['#e6daa4', '#e6daa4']
        : ['#ffff00', '#ffa500'];
  const ts = 1.5 * s;
  const wdText = textWidth(FONTS.game_12, FONTS.game_12.size * ts, text);
  const arrowSc = lit ? 1.1 * s : s;
  const arrow = 64 * arrowSc;
  const boxL = dir === 'left' ? x - 32 * s : x - 216 * s;
  const glowTint = skin.name === 'hero' ? 'rgb(122,255,116)' : 'rgb(255,255,122)';
  // phones: the glow kit joined into one image, so the pulsing glow has no joints to seam
  const glowMid = Math.max(0, Math.round((wdText - 20 * s) / s));
  const strip = useGlowStrip(stage.phone && glow && !locked ? glowMid : -1, skin.name === 'hero' ? [122, 255, 116] : [255, 255, 122]);
  const press = locked
    ? undefined
    : () => {
        play(dir === 'left' ? 'back' : 'next');
        onClick?.();
      };
  return (
    <div
      className="abs"
      style={{ left: boxL, top: y - 32 * s, width: 248 * s, height: 64 * s, cursor: locked ? 'default' : 'pointer', zIndex: 20 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={press}
      {...pressKeys(press, undefined, text)}
    >
      <div className="abs" style={{ left: -boxL, top: -(y - 32 * s), width: 0, height: 0 }}>
        {dir === 'left' ? (
          <>
            <Sprite src={ui(`${nb}/next_${l}fade_tail_l`, skin)} x={x} y={y - 18 * s} w={216 * s} h={36 * s} z={0} />
            <Sprite src={ui(`${nb}/next_${l}fade_afterimage_l`, skin)} x={x} y={y - 18 * s} w={64 * s} h={36 * s} z={1} />
          </>
        ) : (
          <>
            <Sprite src={ui(`${nb}/next_${l}fade_tail_r`, skin)} x={x - 216 * s} y={y - 18 * s} w={216 * s} h={36 * s} z={0} />
            <Sprite src={ui(`${nb}/next_${l}fade_afterimage_r`, skin)} x={x - 64 * s} y={y - 18 * s} w={64 * s} h={36 * s} z={1} />
            {glow && !locked ? (
              // one group whose alpha pulses 170 +/- 30 (timer += TIMESTEP * .1, a 2.09s sine);
              // the three pieces only fade, they never scale, so their joins stay closed
              <div className="abs" style={{ left: 0, top: 0, width: 0, height: 0, zIndex: 1, animation: 'glowpulse 2.094s linear infinite' }}>
                {strip ? (
                  <Sprite src={strip} x={x - (wdText + (20 + 32) * s)} y={y - 28 * s} w={(70 + glowMid) * s} h={56 * s} />
                ) : (
                  <>
                <Sprite src={ui(`${nb}/next_glowkit_l`)} x={x - (wdText + (20 + 32) * s)} y={y - 28 * s} w={35 * s} h={56 * s} tint={glowTint} />
                <Sprite src={ui(`${nb}/next_glowkit_mid`)} x={x + 35 * s - (wdText + (20 + 32) * s)} y={y - 28 * s} w={Math.max(0, wdText - 20 * s)} h={56 * s} tint={glowTint} />
                <Sprite src={ui(`${nb}/next_glowkit_r`)} x={x + 35 * s - (32 + 40) * s} y={y - 28 * s} w={35 * s} h={56 * s} tint={glowTint} />
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
        <Sprite src={ui(`${nb}/next_${lit ? '' : l}button_${d}${lit ? '_glow' : ''}`, skin)} x={x - arrow / 2} y={y - arrow / 2} w={arrow} h={arrow} z={2} />
        {dir === 'left' ? (
          <GameText font="game_12" scale={ts} x={x + 37 * s} y={y + 7 * s} colors={colors} text={text} z={3} />
        ) : (
          <GameText font="game_12" scale={ts} x={x - 32 * s} y={y + 7 * s} align="right" colors={colors} text={text} z={3} />
        )}
      </div>
    </div>
  );
}

// joined glow strips: (middle texels, tint) -> object URL, or the pending build
const glowStrips = new Map<string, string>();
const glowPending = new Map<string, Promise<void>>();

/** @return A UI texture loaded as an image (null when it can't load). */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Join the Next button's glow kit (35-texel left end, the 2-texel middle stretched to `mid`
 * texels, 35-texel right end) into one texture, tinted like display_sprite (rgb x tint / 255).
 *
 * @param mid The middle's width in texels.
 * @param tint The glow color.
 */
function buildGlowStrip(mid: number, tint: readonly [number, number, number]): Promise<void> {
  const key = `${mid}|${tint.join(',')}`;
  let p = glowPending.get(key);
  if (p) return p;
  const nb = 'creation/common/nextbuttons';
  p = Promise.all(['l', 'mid', 'r'].map((part) => loadImage(ui(`${nb}/next_glowkit_${part}`)))).then(([l, m, r]) => {
    if (!l || !m || !r) return;
    const c = document.createElement('canvas');
    c.width = 70 + mid;
    c.height = 56;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(l, 0, 0, 35, 56);
    if (mid > 0) ctx.drawImage(m, 35, 0, mid, 56);
    ctx.drawImage(r, 35 + mid, 0, 35, 56);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = (d.data[i]! * tint[0]) / 255;
      d.data[i + 1] = (d.data[i + 1]! * tint[1]) / 255;
      d.data[i + 2] = (d.data[i + 2]! * tint[2]) / 255;
    }
    ctx.putImageData(d, 0, 0);
    return new Promise<void>((done) =>
      c.toBlob((blob) => {
        if (blob) glowStrips.set(key, URL.createObjectURL(blob));
        done();
      }),
    );
  });
  glowPending.set(key, p);
  return p;
}

/**
 * @param mid The glow's middle width in texels, or -1 for no joined strip (desktop, no glow).
 * @param tint The glow color.
 * @return The joined glow texture once built (the caller re-renders when it arrives).
 */
function useGlowStrip(mid: number, tint: readonly [number, number, number]): string | undefined {
  const key = mid >= 0 ? `${mid}|${tint.join(',')}` : '';
  const ready = key ? glowStrips.get(key) : undefined;
  const [, force] = useState(0);
  useEffect(() => {
    if (!key || ready) return;
    let alive = true;
    void buildGlowStrip(mid, tint).then(() => {
      if (alive) force((n) => n + 1);
    });
    return () => {
      alive = false;
    };
    // mid and tint are folded into key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
  return ready;
}

/** brightenColor (uiUtilMenu.c) on an rgba() string. */
function brightenRgba(c: string, amt: number): string {
  return c.replace(/rgba?\((\d+),(\d+),(\d+)/, (_, r, g, b) => `rgba(${Math.min(255, +r + amt)},${Math.min(255, +g + amt)},${Math.min(255, +b + amt)}`);
}

/**
 * drawMenuBar -> drawMenuBarSquished (uiUtilMenu.c:859): the full-width pill at the top of the
 * third panel ("Choose from new pool power set", isOn = TRUE so always in the selected colors).
 * L / MID / R frame (white border) and meat pieces over a wd-wide box centered on (x, y);
 * brightened by 45 under the mouse and drawn at 0.9 scale while pressed; game_12 x 1.1 text
 * centered with its baseline at y + 6sc, colored white -> selected.text.
 *
 * @param props.x Center x (stage px).
 * @param props.y Center y (stage px).
 * @param props.wd Width (stage px; the client's FRAME_WIDTH * sx).
 * @param props.sc Draw scale (screenScale).
 */
export function MenuBar({ skin, x, y, wd: wdIn, sc: scIn = S, text, onClick, onHover }: { skin: Skin; x: number; y: number; wd: number; sc?: number; text: string; onClick?: () => void; onHover?: (on: boolean) => void }) {
  useFontsReady();
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const pressed = hover && down;
  const sc = pressed ? scIn * 0.9 : scIn;
  const wd = pressed ? wdIn * 0.9 : wdIn;
  const c = skin.selected;
  const base = hover && !pressed ? brightenRgba(c.base, 45) : c.base;
  const tt = skin.name === 'hero' ? '' : '_tintable';
  const dir = 'creation/common/checkbar';
  const under = skin.name === 'praetorian';
  // snapped columns: left, end of L meat, start of R meat, right; frames abut at L/R frame edges
  const left = snap(x - wd / 2);
  const right = snap(x + wd / 2);
  const rx = (v: number) => snap(v) - left;
  const top = snap(y - 15 * sc);
  const ry = (v: number) => snap(v) - top;
  const m0 = rx(x - wd / 2 + 20 * sc);
  const m1 = rx(x + wd / 2 - 20 * sc);
  const f0 = rx(x - wd / 2 + 22 * sc);
  const f1 = rx(x + wd / 2 - 22 * sc);
  const W = right - left;
  const fH = ry(y + 15 * sc);
  const press = () => {
    play('powerselect2');
    onClick?.();
  };
  // phones, as CheckBar: each meat group runs under the next, the cap meat grows two device px
  // top and bottom (under the frame's border), and the end frames' border rows run under the
  // middle frame, so no joint shows a dark line or sliver
  const phone = useStage().phone;
  const ov = phone ? Math.max(2 * getDevPx(), snap(2 * sc)) : 0;
  const band = snap(2 * sc);
  const frameBridge = (key: string, l: number, r: number) =>
    [0, fH - band].map((t) => (
      <div key={`${key}${t}`} className="abs" style={{ left: l, top: t, width: r - l, height: band, overflow: 'hidden', zIndex: 5 }}>
        <Sprite src={ui(`${dir}/checkbar_frame_lg_selected_mid${tt}`, skin)} x={0} y={-t} w={r - l} h={fH} tint="#ffffff" />
      </div>
    ));
  const meat = (piece: 'l' | 'mid' | 'r', l: number, r: number) => {
    const h = piece === 'mid' ? 32 * sc : 24 * sc;
    const grow = phone && piece !== 'mid' ? 2 * getDevPx() : 0;
    const t = ry(y - h / 2) - grow;
    const hh = ry(y + h / 2) - ry(y - h / 2) + 2 * grow;
    const uT = piece === 'mid' ? ry(y - 12 * sc) - t : 0;
    const uH = piece === 'mid' ? ry(y + 12 * sc) - ry(y - 12 * sc) : hh;
    return (
      <div className="abs" style={{ left: l, top: t, width: r - l, height: hh, isolation: 'isolate' }}>
        <Sprite src={ui(`${dir}/checkbar_meat_base_${piece}`, skin)} x={0} y={0} w={r - l} h={hh} z={0} tint={base} />
        <Sprite src={ui(`${dir}/checkbar_meat_highlight_${piece}`, skin)} x={0} y={0} w={r - l} h={hh} z={1} tint={CLR_HIGH} />
        <Sprite src={ui(`${dir}/checkbar_meat_shadow_${piece}`, skin)} x={0} y={0} w={r - l} h={hh} z={2} tint={CLR_SHADOW} />
        {under ? <Sprite src={ui(`${dir}/checkbar_meat_base_underlight_${piece}`, skin)} x={0} y={uT} w={r - l} h={uH} z={3} /> : null}
      </div>
    );
  };
  return (
    <div
      className="abs"
      onMouseEnter={() => {
        setHover(true);
        onHover?.(true);
      }}
      onMouseLeave={() => {
        setHover(false);
        setDown(false);
        onHover?.(false);
      }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onClick={press}
      {...pressKeys(press, undefined, text)}
      style={{ left, top, width: W, height: fH, cursor: 'pointer', zIndex: 12 }}
    >
      {meat('l', 0, m0 + ov)}
      {meat('mid', m0, m1 + ov)}
      {meat('r', m1, W)}
      {ov ? frameBridge('bl', f0, f0 + ov) : null}
      {ov ? frameBridge('br', f1 - ov, f1) : null}
      <Sprite src={ui(`${dir}/checkbar_frame_lg_selected_l${tt}`, skin)} x={0} y={0} w={f0} h={fH} z={5} tint="#ffffff" />
      <Sprite src={ui(`${dir}/checkbar_frame_lg_selected_mid${tt}`, skin)} x={f0} y={0} w={f1 - f0} h={fH} z={6} tint="#ffffff" />
      <Sprite src={ui(`${dir}/checkbar_frame_lg_selected_r${tt}`, skin)} x={f1} y={0} w={W - f1} h={fH} z={5} tint="#ffffff" />
      <GameText font="game_12" scale={sc * 1.1} x={x - left} y={y - top + 6 * sc} align="center" colors={['#ffffff', c.text]} text={text} z={7} />
    </div>
  );
}

/** CLR_BTN_HERO / VILLAIN / ROGUE after drawStdButton's brightenColor(-20). */
function stdButtonColor(skin?: Skin): [number, number, number] {
  if (skin?.name === 'villain') return [0xeb, 0x0e, 0x0e];
  if (skin?.name === 'praetorian') return [0x3a, 0x3a, 0x3a];
  return [0x16, 0x63, 0xeb];
}

/**
 * drawStdButton (uiUtil.c:134): GenericButton L/MID/R pieces (24x46 caps, dropshadow, shadow and
 * meat tinted by the skin color, white highlight) scaled to ht/46, centered on (x, y), with
 * game_12 text at s centered in white at 75% (100% on hover, 27% locked; shrunk to fit wd - 5).
 * Defaults are the level screens' 120x30 virtual buttons.
 */
export function InfoButton({ x, y, text, onClick, disabled, skin, w = vx(120), h = vy(30) }: { x: number; y: number; text: string; onClick?: () => void; disabled?: boolean; skin?: Skin; w?: number; h?: number }) {
  useFontsReady();
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const lit = hover && !disabled;
  const press = lit && down ? 0.95 : 1;
  const ht = Math.min(h, 46 * SY) * press;
  const sc = ht / 46;
  const wd = Math.max(w * press, 48 * sc);
  const [r, g, b] = stdButtonColor(skin);
  const a = disabled ? 0x88 / 255 : lit ? 0xdf / 255 : 1;
  const color = `rgba(${r},${g},${b},${a})`;
  const drop = disabled ? 'rgba(0,0,0,0.533)' : lit ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
  const textA = disabled ? 0x44 / 255 : lit ? 1 : 0xbf / 255;
  const ts = Math.min(S, textWidth(FONTS.game_12, FONTS.game_12.size * S, text) > w - 5 ? (S * (w - 5)) / textWidth(FONTS.game_12, FONTS.game_12.size * S, text) : S) * press;
  const dir = 'hud/common/select_buttons/genericbutton';
  const st = lit && down ? 'press' : 'rest';
  const piece = (side: 'l' | 'mid' | 'r', px0: number, pw: number) => (
    <>
      <Sprite src={ui(`${dir}_${st}_${side}_dropshadow`, skin)} x={px0} y={0} w={pw} h={ht} z={0} tint={drop} />
      <Sprite src={ui(`${dir}_${st}_${side}_meat`, skin)} x={px0} y={0} w={pw} h={ht} z={1} tint={color} />
      <Sprite src={ui(`${dir}_${st}_${side}_shadow`, skin)} x={px0} y={0} w={pw} h={ht} z={2} tint={color} />
      <Sprite src={ui(`${dir}_${st}_${side}_highlight`, skin)} x={px0} y={0} w={pw} h={ht} z={2} />
    </>
  );
  const cap = 24 * sc;
  return (
    <div
      className="abs"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setDown(false);
      }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onClick={disabled ? undefined : onClick}
      {...pressKeys(disabled ? undefined : onClick, undefined, text)}
      style={{ left: x - wd / 2, top: y - ht / 2, width: wd, height: ht, cursor: disabled || !onClick ? 'default' : 'pointer', zIndex: 12 }}
    >
      {piece('l', 0, cap)}
      {piece('mid', cap, Math.max(0, wd - 2 * cap))}
      {piece('r', wd - cap, cap)}
      <GameText font="game_12" scale={ts} x={wd / 2} y={ht / 2} centerY align="center" colors={[`rgba(255,255,255,${textA})`, `rgba(255,255,255,${textA})`]} text={text} z={3} />
    </div>
  );
}

/** Game help text uses a little markup (<br>, <color ...>, <b>): keep line breaks, drop the rest. */
export function gameText(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * The bottom help frame (85, 600, 865x90 virtual) with powers_description_iconring (72x72 at s)
 * centered at (85, 645) and the description as SMF game_12 text (no outline) at (125, 615),
 * line height round(1.255 x px). `color` is 48ff48 on the level-up screen, 00ff00 on the pool
 * picker (which also draws it at 1.05s).
 */
export function DescBox(props: { x?: number; y?: number; w?: number; h?: number; iconSrc?: string; text?: string; color?: string; textScale?: number; skin?: Skin }) {
  const stage = useStage();
  const d = stage.phone ? phoneDesc(phoneGeom(stage)) : { x: vx(85), y: vy(600), w: vx(865), h: vy(90) };
  const { x = d.x, y = d.y, w = d.w, h = d.h, iconSrc, text, textScale = 1, skin } = props;
  const color = props.color ?? skin?.desc ?? '#48ff48';
  const px = FONTS.smf_12.size * S * textScale;
  // phones: a smaller ring, so it fits in the margin it straddles
  const k = stage.phone ? 0.7 : 1;
  const ring = 72 * S * k;
  return (
    <>
      <MenuFrame x={x} y={y} w={w} h={h} skin={skin} />
      <Sprite src={ui(`creation/powers/powers_description_iconring`, skin)} x={x - ring / 2} y={y + h / 2 - ring / 2} w={ring} h={ring} z={3} />
      {iconSrc ? <Sprite src={iconSrc} x={x - 16 * S * k} y={y + h / 2 - 16 * S * k} w={32 * S * k} h={32 * S * k} z={4} /> : null}
      <div
        className="abs scroll-y"
        style={{
          left: stage.phone ? x + ring / 2 + 8 : vx(125),
          top: stage.phone ? y + 10 : vy(615) - px * 0.15,
          width: stage.phone ? w - ring / 2 - 20 : vx(815),
          height: stage.phone ? h - 20 : y + h - vy(615),
          color,
          fontFamily: "'Montreal'",
          fontSize: px,
          lineHeight: `${Math.round(1.255 * px)}px`,
        }}
      >
        {smf(text)}
      </div>
    </>
  );
}

/**
 * Yellow set heading (setHeadingFontFromSkin: title_12, CLR_YELLOW -> CLR_ORANGE).
 * `size` is the em in stage px (the level-up screens use 1.2s, i.e. 14.4 x S); `y` is the
 * TOP of the text box for layout convenience, `center` centers within `width`.
 */
export function SetTitle({ x, y, text, center, width, size = 12 * 1.2 * S, skin }: { x: number; y: number; text: string; center?: boolean; width?: number; size?: number; skin?: Skin }) {
  useFontsReady();
  const scale = size / FONTS.title_12.size;
  return (
    <div className="abs" style={{ left: 0, top: 0, width: 0, height: 0 }}>
      <GameText
        font="title_12"
        scale={scale}
        x={center && width ? x + width / 2 : x}
        y={y + size * 0.9}
        align={center ? 'center' : 'left'}
        colors={skin?.heading ?? ['#ffff00', '#ffa500']}
        text={text}
      />
    </div>
  );
}

/**
 * drawFrame(PIX2, R6, ...) -- the small inner frame around a set's bars (uiPowers.c / uiLevelSpec.c):
 * a 2px 0xffffffaa border with radius 6 over PSET_FRAME_CLR (0000ff44 / ff000044 / 00000066).
 * The border measures dark grey on the user's screenshots, so it is drawn with those colors.
 */
export function SetFrame({ x, y, w, h, skin }: { x: number; y: number; w: number; h: number; skin: Skin }) {
  const fill = skin.name === 'villain' ? 'rgba(255,0,0,0.153)' : skin.name === 'praetorian' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,255,0.153)';
  return <div className="abs" style={{ left: x, top: y, width: w, height: Math.max(0, h), border: `${2 * S}px solid #3a3a3e`, borderTopColor: '#4d4d50', borderRadius: 6 * S, background: fill, boxSizing: 'border-box' }} />;
}

/**
 * drawFlatFrame -> drawFrameStyleColor (uiUtilGame.c) for kFrameStyle_Flat with every part: the
 * (radius + size)-px corner textures and pipes scaled by sc and tinted with `border`, over a
 * `back` fill. When the box is shorter (or narrower) than two corners,
 * the corners shrink to fit -- which is what turns small R10 frames into capsules.
 */
export function FlatFrame({ x, y, w: wd, h: ht, sc, border, back, size = 3, radius = 10, z }: { x: number; y: number; w: number; h: number; sc: number; border: string; back: string; size?: number; radius?: number; z?: number }) {
  const w = radius + size;
  const xsc = wd < w * 2 * sc ? wd / (w * 2) : sc;
  const ysc = ht < w * 2 * sc ? ht / (w * 2) : sc;
  const cleft = x + w * xsc;
  const cright = x + wd - w * xsc;
  const ctop = y + w * ysc;
  const cbottom = y + ht - w * ysc;
  const midW = wd - 2 * w * xsc;
  const midH = ht - 2 * w * ysc;
  const dir = `hud/common/frame/frame_flat_${size}px`;
  const corner = (c: 'ul' | 'ur' | 'll' | 'lr', l: number, t: number) => <Sprite src={ui(`${dir}/frame_flat_${size}px_${radius}r_${c}`)} x={l} y={t} w={w * xsc} h={w * ysc} z={z} tint={border} />;
  // The client fills the inside with background-corner textures plus four strips and a center
  // quad; one rounded box under the border pieces gives the same shape without the hairline
  // seams that abutting pieces leave at fractional positions.
  const inset = size / 2;
  return (
    <>
      <div className="abs" style={{ left: x + inset * xsc, top: y + inset * ysc, width: wd - 2 * inset * xsc, height: ht - 2 * inset * ysc, background: back, borderRadius: `${(w - inset) * xsc}px / ${(w - inset) * ysc}px`, zIndex: z }} />
      <Sprite src={ui(`${dir}/frame_flat_${size}px_horiz`)} x={cleft} y={y} w={Math.max(0, midW)} h={4 * ysc} z={z} tint={border} />
      <Sprite src={ui(`${dir}/frame_flat_${size}px_horiz`)} x={cleft} y={cbottom + (w - size) * ysc} w={Math.max(0, midW)} h={4 * ysc} z={z} tint={border} />
      <Sprite src={ui(`${dir}/frame_flat_${size}px_vert`)} x={x} y={ctop} w={4 * xsc} h={Math.max(0, midH)} z={z} tint={border} />
      <Sprite src={ui(`${dir}/frame_flat_${size}px_vert`)} x={cright + (w - size) * xsc} y={ctop} w={4 * xsc} h={Math.max(0, midH)} z={z} tint={border} />
      {corner('ul', x, y)}
      {corner('ur', cright, y)}
      {corner('ll', x, cbottom)}
      {corner('lr', cright, cbottom)}
    </>
  );
}

/** "Slots Available: N": game_12 at s in red (slots left) or green (done), centered in a flat frame. */
export function SlotsAvailable({ n, x = vx(412), y = vy(695), w = vx(200), h = vy(30) }: { n: number; x?: number; y?: number; w?: number; h?: number }) {
  useFontsReady();
  const color = n > 0 ? '#ff0000' : '#00ff00';
  return (
    <>
      <FlatFrame x={x} y={y} w={w} h={h} sc={S} border={color} back="#000" />
      <GameText font="game_12" scale={S} x={x + w / 2} y={y + h / 2} centerY align="center" colors={[color, color]} text={`Slots Available: ${Math.max(0, n)}`} z={2} />
    </>
  );
}

/**
 * A respec screen's counter (uiReSpec.c respec_powerCounter / respec_specCounter): a flat frame,
 * red with red text until the screen is complete, then green with a white first line. The game
 * draws it 45 tall at y 705; here it sits just above the planner's bottom switches.
 *
 * @param lines The game_12 lines, top first (the slot screen's single line, or the power screen's two).
 * @param done The screen is complete (green; the top line reads "Click 'Next' to Continue").
 */
export function RespecCounter({ lines, done, x = vx(412), y = vy(691), w = vx(200), h = vy(38) }: { lines: string[]; done: boolean; x?: number; y?: number; w?: number; h?: number }) {
  useFontsReady();
  const color = done ? '#00ff00' : '#ff0000';
  const rows = lines.length === 1 ? [0.5] : [0.3, 0.72];
  return (
    <>
      <FlatFrame x={x} y={y} w={w} h={h} sc={S} border={color} back="#000" />
      {lines.map((t, i) => (
        <GameText key={i} font="game_12" scale={S} x={x + w / 2} y={y + h * (rows[i] ?? 0.5)} centerY align="center" colors={done && i === 0 ? ['#ffffff', '#ffffff'] : [color, color]} text={t} z={2} />
      ))}
    </>
  );
}

// EnhncTray_Ring is 70 px across; a slotted piece is drawn at 1.1x the ring's scale
// (drawMenuEnhancement, uiCombineSpec.c)
const RING_PX = 70;
const PIECE_SCALE = 1.1;

// uiLevelSpec.c enhancementAnim_update: a new slot's scale grows by ENHANCE_GROW_SPEED (.1) per
// tick from 0, so 10 ticks; the slots already there slide by ENHANCE_MOVE_SPEED (10 virtual units)
// per tick, so one SPEC_WD (36) step takes 3.6 ticks
const GROW_MS = (1 / 0.1) * (1000 / 30);
const SLIDE_MS = (36 / 10) * (1000 / 30);

/**
 * Grow an element from scale 0 to 1, linearly over GROW_MS from `born` (a remount part-way
 * through carries on from where it was; one after the end does nothing).
 *
 * @param ref The element.
 * @param born performance.now() when it was added, or undefined for no growth.
 */
function useGrowIn(ref: RefObject<HTMLDivElement | null>, born: number | undefined): void {
  // before paint, so a new ring never shows one frame at full size
  useLayoutEffect(() => {
    const el = ref.current;
    if (born === undefined || !el?.animate) return;
    const into = performance.now() - born;
    if (into >= GROW_MS) return;
    const anim = el.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: GROW_MS, delay: -into, easing: 'linear' });
    return () => anim.cancel();
  }, [ref, born]);
}

/**
 * An enhancement slot: the tray ring over its hole while empty; a slotted piece is drawn in its
 * place, not inside it.
 *
 * As drawMenuEnhancement does: no ring under a piece, and the piece at 1.1x the ring's scale, so
 * an IO's 64 px frame reaches just past where the ring's edge would be.
 *
 * @param props.born A slot just added on the slot screen: performance.now() of the click; it grows
 *   in as enhancementAnim does.
 * @param props.slide Move to a new x at the slot screen's slide speed instead of jumping.
 */
export function SlotRing({ x, y, size = vs(35), enhIcon, frames, pog, pending, born, slide, onClick, onRightClick, onLongPress, onHover, title, skin, testId }: { x: number; y: number; size?: number; enhIcon?: string; frames?: [string, string]; pog?: string; pending?: boolean; born?: number; slide?: boolean; onClick?: () => void; onRightClick?: () => void; onLongPress?: (pt: { x: number; y: number }) => void; onHover?: (on: boolean) => void; title?: string; skin?: Skin; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGrowIn(ref, born);
  const k = (size / RING_PX) * PIECE_SCALE; // stage px per texture px of the piece
  const c = size / 2;
  return (
    <div
      ref={ref}
      className="abs"
      title={title}
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
      onContextMenu={
        onRightClick
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              // a long touch on Android arrives as a contextmenu: it is not a right-click
              if (!touchPress()) onRightClick();
            }
          : undefined
      }
      {...pressKeys(onClick, onRightClick, title ?? 'Enhancement slot')}
      {...longPress(onLongPress)}
      style={{ left: x - size / 2, top: y - size / 2, width: size, height: size, cursor: onClick ? 'pointer' : 'default', zIndex: 8, transition: slide ? `left ${SLIDE_MS}ms linear` : undefined }}
    >
      {enhIcon ? (
        <>
          {/* drawEnhancementOriginLevelEx: frame halves (32 x 64 each), then the type disc (48), then the icon (46) */}
          {frames?.[0] ? <Sprite src={iconUrl('enh', frames[0])} x={c - 32 * k} y={c - 32 * k} w={32 * k} h={64 * k} z={1} /> : null}
          {frames?.[1] ? <Sprite src={iconUrl('enh', frames[1])} x={c} y={c - 32 * k} w={32 * k} h={64 * k} z={1} /> : null}
          {pog ? <Sprite src={iconUrl('enh', pog)} x={c - 24 * k} y={c - 24 * k} w={48 * k} h={48 * k} z={2} /> : null}
          <Sprite src={enhIcon} x={c - 23 * k} y={c - 23 * k} w={46 * k} h={46 * k} z={3} />
        </>
      ) : (
        <>
          <Sprite src={ui('creation/enhancements/enhnctray_ringhole', skin)} x={size * 0.04} y={size * 0.04} w={size * 0.92} h={size * 0.92} z={0} />
          <Sprite src={ui(pending ? 'creation/enhancements/enhnctray_ring_highlight' : 'creation/enhancements/enhnctray_ring', skin)} x={0} y={0} w={size} h={size} z={4} />
        </>
      )}
    </div>
  );
}

// game_18 is a dynamic font: each glyph advances by its 18px advance (plus the outline's 1px)
// times the draw scale, so at this size the letters spread out. Measured on the reference
// screenshot: about 3.25 base px wider per glyph than the font's own advance.
const FADE_SPACING = 3.25;

/**
 * fadingText (uiFx.c): game_18 text centered on x with its baseline at y, fading in and out as
 * sin(pi t) over its 30-tick (1s) life while its scale grows by 0.01 per tick (+0.3 in all).
 * Mount it with a fresh key to replay it.
 *
 * The caller's scale is base * screenScale, and the client's text pass multiplies it by the
 * screen scale a second time (only x and y are virtual), so the text grows with the square of
 * the resolution. It is sized here for the 3840x2160 reference screens, where "No slots to
 * assign!" is about two thirds of the screen wide and the +0.3 adds about 7%.
 *
 * @param props.base The per-call factor before screenScale (1.5 on the slot screen).
 * @param props.maxWidth Optional cap (stage px) for narrow layouts; the text shrinks to fit.
 */
export function FadingText({ x, y, text, color, base, maxWidth }: { x: number; y: number; text: string; color: string; base: number; maxWidth?: number }) {
  useFontsReady();
  const ft = base * REF_SCREEN_SCALE; // the client's FadingText.scale at the start
  const grow = (ft + 0.3) / ft;
  let scale = ft * S; // drawn at ft * screenScale device px = ft * S stage px
  if (maxWidth) {
    const w = textWidth(FONTS.game_18, FONTS.game_18.size * scale * grow, text) + FADE_SPACING * scale * grow * text.length;
    if (w > maxWidth) scale *= maxWidth / w;
  }
  return (
    <div
      className="abs"
      style={{
        left: x,
        top: y,
        width: 0,
        height: 0,
        zIndex: 50,
        pointerEvents: 'none',
        transformOrigin: '0 0',
        animation: 'fadingtext 1s linear forwards, fadinggrow 1s linear forwards',
        ['--grow' as string]: grow,
      }}
    >
      <GameText font="game_18" scale={scale} x={0} y={0} align="center" colors={[color, color]} text={text} spacing={FADE_SPACING * scale} />
    </div>
  );
}
