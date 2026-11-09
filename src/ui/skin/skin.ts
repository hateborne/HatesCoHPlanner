/**
 * In-game UI skins. Colors are the client's own (Game/src/UI/uiUtil.h + setupUIColors in
 * uiUtilMenu.c), stored as CSS rgba() strings. Texture variants use the V_ / P_ prefixes the
 * client uses for the villain and Praetorian skins.
 */

export type SkinName = 'hero' | 'villain' | 'praetorian';

/** One element state's colors (setElemColors: base, frame, fill, text, text2, highlight). */
export interface ElemColors {
  base: string;
  frame: string;
  fill: string;
  text: string;
  text2: string;
  highlight: string;
}

export interface Skin {
  name: SkinName;
  prefix: '' | 'v_' | 'p_';
  standard: ElemColors;
  selected: ElemColors;
  unselectable: ElemColors;
  title: [string, string]; // heading gradient (top, bottom)
  menuBorder: string;
}

/** 0xRRGGBBAA -> CSS rgba(). */
export function rgba(c: number): string {
  const r = (c >>> 24) & 0xff;
  const g = (c >>> 16) & 0xff;
  const b = (c >>> 8) & 0xff;
  const a = (c & 0xff) / 255;
  return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`;
}

const CLR_WHITE = 0xffffffff;
const CLR_HIGH = 0xffffff88;
const CLR_GREY = 0xa0a0a0ff;
const DARK_GREY = 0x444444ff;

const grey: ElemColors = {
  base: rgba(0x1e1e1eff),
  frame: rgba(0x444444ff),
  fill: rgba(0x6e6e6e68),
  text: rgba(CLR_WHITE),
  text2: rgba(0x8fa1b8ff),
  highlight: rgba(0xffffff22),
};

export const SKINS: Record<SkinName, Skin> = {
  hero: {
    name: 'hero',
    prefix: '',
    standard: {
      base: rgba(0x0061d9ff),
      frame: rgba(0x4f94ffff),
      fill: rgba(0x0061d968),
      text: rgba(CLR_WHITE),
      text2: rgba(0x90e2fcff),
      highlight: rgba(CLR_HIGH),
    },
    selected: {
      base: rgba(0x00d919ff),
      frame: rgba(0x00d919ff),
      fill: rgba(0x00d91968),
      text: rgba(CLR_WHITE),
      text2: rgba(0x88ffaaff),
      highlight: rgba(CLR_HIGH),
    },
    unselectable: grey,
    title: ['#ffff00', '#ffa500'],
    menuBorder: rgba(0x4f94ffff),
  },
  villain: {
    name: 'villain',
    prefix: 'v_',
    standard: {
      base: rgba(0x580008ff),
      frame: rgba(CLR_WHITE),
      fill: rgba(0x58000868),
      text: rgba(CLR_WHITE),
      text2: rgba(0xfce290ff),
      highlight: rgba(CLR_HIGH),
    },
    selected: {
      base: rgba(0xa00008ff),
      frame: rgba(0xfca91aff),
      fill: rgba(0xa0000868),
      text: rgba(CLR_WHITE),
      text2: rgba(0xff88aaff),
      highlight: rgba(CLR_HIGH),
    },
    unselectable: grey,
    title: ['#ffff00', '#ffa500'],
    menuBorder: rgba(0xff944fff),
  },
  praetorian: {
    name: 'praetorian',
    prefix: 'p_',
    standard: {
      base: rgba(0x424242ff),
      frame: rgba(CLR_WHITE),
      fill: rgba(0x151515ff),
      text: rgba(CLR_WHITE),
      text2: rgba(CLR_WHITE),
      highlight: rgba(0xffffff88),
    },
    selected: {
      base: rgba(0x989898ff),
      frame: rgba(0xe0ff00ff),
      fill: rgba(DARK_GREY),
      text: rgba(CLR_WHITE),
      text2: rgba(CLR_WHITE),
      highlight: rgba(0xffffff88),
    },
    unselectable: { ...grey, text2: rgba(0x8fa1b8ff) },
    title: ['#ffffff', '#c8c8c8'],
    menuBorder: rgba(CLR_GREY),
  },
};

export const CLR_SHADOW = rgba(0x0000007a);
export const CLR_CBLOW = rgba(0x00000093);
export const CLR_CRDS = rgba(0x000000bf);
export const CLR_DESC = rgba(0x48ff48ff);

/** URL of an exported UI texture, e.g. ui('creation/common/checkbar/checkbar_meat_base_mid'). */
export function ui(path: string): string {
  const big = path.includes('/backgrounds/');
  return `${import.meta.env.BASE_URL}assets/ui/${path.toLowerCase()}.${big ? 'webp' : 'png'}`;
}

/** Skin-specific texture when the client ships one (V_/P_ prefix on the file name), else the base. */
export function skinned(skin: Skin, dir: string, file: string, available: Set<string>): string {
  if (skin.prefix) {
    const alt = `${dir}/${skin.prefix}${file}`.toLowerCase();
    if (available.has(alt)) return ui(alt);
  }
  return ui(`${dir}/${file}`);
}

/** URL of an icon: kind = powers | enh | at | origin. */
export function icon(kind: 'powers' | 'enh' | 'at' | 'origin', name: string): string {
  return `${import.meta.env.BASE_URL}assets/icons/${kind}/${name.toLowerCase()}.png`;
}
