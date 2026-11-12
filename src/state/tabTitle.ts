/**
 * The browser tab's title, which follows the build's name so a bookmark or a copied tab carries it.
 */

/** The page's own title (index.html), kept for a build with no name. */
export const APP_TITLE = "Hate's CoH Planner";

// control characters (newlines, tabs, NUL, ...) become spaces
const CONTROL = /\p{Cc}/gu;
// bidirectional embeddings, overrides and isolates, which could reorder the rest of the title
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * The browser tab title for a build: "HCP: <name>", or the app's own title for an unnamed build.
 *
 * The name is untrusted text (share links, saved builds, Mids imports): control characters turn
 * into spaces, bidirectional controls are dropped, and runs of whitespace collapse to one space.
 * The result is meant for `document.title`, which never parses markup.
 *
 * @param name The build's name; missing, empty or all whitespace keeps APP_TITLE.
 * @return The tab title.
 */
export function tabTitle(name: string | undefined): string {
  const clean = (name ?? '').replace(CONTROL, ' ').replace(BIDI, '').replace(/\s+/gu, ' ').trim();
  return clean ? `HCP: ${clean}` : APP_TITLE;
}
