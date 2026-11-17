// the finder's working name until the owner names it
// @TODO the owner's name for the feature
export const FINDER_NAME = 'Set Finder';

/**
 * The set finder's button icon: a magnifying glass, drawn here.
 *
 * @TODO a stand-in until the owner picks an icon from the client's art.
 *
 * @param size Its width and height in stage px.
 */
export function FinderIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="#fff" strokeWidth="2.2" />
      <line x1="12.8" y1="12.8" x2="18" y2="18" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
