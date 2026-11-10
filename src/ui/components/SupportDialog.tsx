import { useEscape } from '../escape.ts';
import { FONTS, S } from '../skin/metrics.ts';
import type { Skin } from '../skin/skin.ts';
import { MenuFrame } from './Chrome.tsx';
import { useStage } from './Stage.tsx';

/** Where to send money instead of to the planner (opened in a new tab). */
const CHARITIES = [
  { name: "St. Jude Children's Research Hospital", url: 'https://www.stjude.org/give.html' },
  { name: 'Feeding America', url: 'https://www.feedingamerica.org/ways-to-give' },
  { name: 'Habitat for Humanity', url: 'https://www.habitat.org/donate' },
  { name: 'American Humane Society', url: 'https://www.americanhumane.org/support-our-work/donate/' },
];

/**
 * The "Support HateCoHPlanner" answer: a centered box drawn like the build screen's power hover
 * tooltip (the framed dark panel and the description green), pointing donations at charities.
 * Closes on Escape, the Close button or a click outside it.
 */
export function SupportDialog({ skin, onClose }: { skin: Skin; onClose: () => void }) {
  useEscape(onClose);
  const stage = useStage();
  const px = stage.phone ? 19 : FONTS.smf_12.size * S * 1.15;
  const w = stage.phone ? stage.w - 24 : 760;
  // title, intro and four links, then the Close button
  const h = Math.round(px * 9.4 + (stage.phone ? 120 : 100));
  const x = (stage.w - w) / 2;
  const y = (stage.h - h) / 2;
  return (
    <>
      <div className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 90, background: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div className="abs" role="dialog" aria-label="Support HateCoHPlanner" style={{ left: x, top: y, width: w, height: h, zIndex: 91 }}>
        <MenuFrame x={0} y={0} w={w} h={h} skin={skin} style={{ background: '#000314' }} />
        <div className="abs" style={{ left: 28, top: 22, width: w - 56, color: skin.desc, fontFamily: "'Montreal'", fontSize: px, lineHeight: `${Math.round(1.3 * px)}px`, zIndex: 5 }}>
          <div style={{ fontSize: px * 1.35, fontWeight: 'bold', marginBottom: px * 0.6 }}>DON&apos;T SEND ME YOUR MONEY!</div>
          <div style={{ marginBottom: px * 0.3 }}>Send it where it actually helps:</div>
          <ul style={{ margin: 0, paddingLeft: px * 1.4 }}>
            {CHARITIES.map((c) => (
              <li key={c.url}>
                <a className="support-link" href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <button className="info-button" style={{ left: w / 2, top: h - (stage.phone ? 48 : 40), transform: 'translate(-50%, -50%)', zIndex: 6 }} onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}
