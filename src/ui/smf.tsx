import { Fragment, type ReactNode } from 'react';

/**
 * SMF (the client's help-text markup, Game/src/formatter) for the tags the exported text uses:
 * <br>, <p> / </p> (each forces a line wrap), <color ...> / </color> (a stack), entities; any other
 * tag is dropped. Colors parse like sm_GetColor (smf_util.c): "#rrggbb" or "#rrggbbaa", else a
 * case-insensitive name from s_aColors, else black.
 */

// s_aColors (smf_util.c), names lowercased
const NAMED: Record<string, string> = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  black: '#000000',
  blanchedalmond: '#ffebcd',
  blue: '#0000ff',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  cyan: '#00ffff',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgreen: '#006400',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dodgerblue: '#1e90ff',
  feldspar: '#d19275',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#adff2f',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgrey: '#d3d3d3',
  lightgreen: '#90ee90',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslateblue: '#8470ff',
  lightslategray: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  loyalagon: '#e39001',
  magenta: '#ff00ff',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370d8',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#d87093',
  papayawhip: '#ffefd5',
  paragon: '#00deff',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  red: '#ff0000',
  resistagon: '#ffea46',
  rogueagon: '#6e6e6e',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  villagon: '#cc1a1a',
  violetred: '#d02090',
  wheat: '#f5deb3',
  white: '#ffffff',
  whitesmoke: '#f5f5f5',
  yellow: '#ffff00',
  yellowgreen: '#9acd32',
  infoblue: '#aadeff',
};

/** sm_GetColor for one value. */
export function smfColor(v: string): string {
  const s = v.trim().replace(/^['"]|['"]$/g, '');
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hex)) return '#000000';
    if (hex.length <= 6) return `#${hex.padStart(6, '0')}`;
    const n = parseInt(hex.slice(0, 8), 16) >>> 0;
    return `rgba(${(n >>> 24) & 255},${(n >>> 16) & 255},${(n >>> 8) & 255},${((n & 255) / 255).toFixed(3)})`;
  }
  return NAMED[s.toLowerCase()] ?? '#000000';
}

function entities(s: string): string {
  return s.replace(/&nbsp;/g, '\u00a0').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/**
 * Render SMF text as React nodes (spans for color runs, <br> for breaks).
 *
 * @param text Help text with SMF markup.
 * @return Nodes to place inside a block whose CSS color is the default (gTextAttr) color.
 */
export function smf(text: string | undefined): ReactNode {
  if (!text) return null;
  const out: ReactNode[] = [];
  const colors: string[] = [];
  const re = /<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g;
  let last = 0;
  let k = 0;
  const push = (s: string) => {
    if (!s) return;
    const t = entities(s);
    const c = colors[colors.length - 1];
    out.push(c ? <span key={k++} style={{ color: c }}>{t}</span> : <Fragment key={k++}>{t}</Fragment>);
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(text.slice(last, m.index));
    last = re.lastIndex;
    const end = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    if (tag === 'br' || tag === 'p') out.push(<br key={k++} />);
    else if (tag === 'color') {
      if (end) colors.pop();
      else {
        const attr = m[3]!.trim().replace(/^color\s*=\s*/i, '');
        colors.push(smfColor(attr));
      }
    }
  }
  push(text.slice(last));
  return out;
}
