/**
 * Wrapping a long title bar text (a build's name on the overview) onto two lines.
 */

/**
 * Wrap a title onto two lines the way text wraps: the first line keeps every word that fits it,
 * and the word that crosses its end moves to the second line with everything after it. Nothing is
 * rebalanced between the lines.
 *
 * A first word too long for the line on its own is cut where it crosses the end (as CSS
 * `overflow-wrap: break-word` does), so the first line is never empty.
 *
 * @param text The title.
 * @param fits Whether a string fits on the first line.
 * @return The two lines; the second is empty when the whole title fits on the first.
 */
export function wrapTitle(text: string, fits: (s: string) => boolean): [string, string] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return ['', ''];
  const first = words[0]!;
  if (!fits(first)) {
    // the longest start of the word that fits (at least one character)
    const chars = Array.from(first);
    let n = 1;
    while (n < chars.length && fits(chars.slice(0, n + 1).join(''))) n++;
    return [chars.slice(0, n).join(''), [chars.slice(n).join(''), ...words.slice(1)].join(' ').trim()];
  }
  let line = first;
  let i = 1;
  for (; i < words.length; i++) {
    const next = `${line} ${words[i]!}`;
    if (!fits(next)) break;
    line = next;
  }
  return [line, words.slice(i).join(' ')];
}
