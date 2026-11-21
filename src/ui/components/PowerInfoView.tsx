import { Fragment, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { Archetype } from '../../data/types.ts';
import { damageBoost } from '../../engine/boost.ts';
import { powerStrength } from '../../engine/enhance.ts';
import { INFO_LABEL_COLOR, powerInfo, type InfoRow, type PowerInfo, type Seg } from '../../engine/powerinfo.ts';
import type { BuildEntry, BuildRules } from '../../engine/rules.ts';
import { TIP_PX } from './PowerTip.tsx';

/** Colored runs; a "\n" run breaks the line as the client's <br> does. */
export function Segs({ segs }: { segs: readonly Seg[] }) {
  return (
    <>
      {segs.map((s, i) => {
        const parts = s.text.split('\n');
        return (
          <span key={i} style={{ color: s.color, fontStyle: s.italic ? 'italic' : undefined }}>
            {parts.map((p, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {p}
              </Fragment>
            ))}
          </span>
        );
      })}
    </>
  );
}

// a slotted bonus beside the value it changes: the totals' green
const BONUS_COLOR = '#58e849';

/** @return A bonus as the picker writes enhancement strength: "58.74%". */
const bonusText = (v: number): string => `${(v * 100).toFixed(2)}%`;

/**
 * A "Label: value" table (the stats and target blocks).
 *
 * @param props.bonus Add a right-hand column with each row's slotted bonus (InfoRow.bonus): no
 *   label, the row it stands on says what it is for.
 */
export function Rows({ rows, bonus }: { rows: InfoRow[]; bonus?: boolean }) {
  if (!rows.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: bonus ? 'auto 1fr auto' : 'auto 1fr', columnGap: TIP_PX * 1.5 }}>
      {rows.map((r, i) => (
        <Fragment key={i}>
          <div style={{ color: INFO_LABEL_COLOR }}>{r.label}</div>
          <div style={{ color: '#ffffff' }}>
            <Segs segs={r.value} />
          </div>
          {bonus ? <div data-testid={r.bonus !== undefined ? 'tip:bonus' : undefined} style={{ color: BONUS_COLOR, textAlign: 'right' }}>{r.bonus !== undefined ? bonusText(r.bonus) : ''}</div> : null}
        </Fragment>
      ))}
    </div>
  );
}

const Divider = () => <div style={{ borderTop: '1px solid #5a6aa8', margin: `${TIP_PX * 0.6}px 0` }} />;

/**
 * The detailed power info (the game's "Show Detailed Info Here" panel, ported in
 * engine/powerinfo.ts) for an Advanced tooltip: the stats and target tables and every effect
 * line (enhanced values with the base in parentheses), at the tooltip's font size. The panel's
 * title line, PvP switch and level slider are left out (nothing to adjust in a tooltip). Each
 * value the power's own enhancements change has their bonus at the right end of its row.
 *
 * @param props.entry The hovered power with its slots (their enhancements give the enhanced values).
 * @param props.level 0-based character level the values are shown at.
 * @param props.rules Rules view of the build the power is in: its damage boosts (damageBoost) are
 *   counted in the damage shown.
 */
export function AdvancedInfo({ gd, at, entry, level, rules }: { gd: GameData; at: Archetype; entry: BuildEntry; level: number; rules: BuildRules }) {
  const files = useInfoFiles(gd);
  const boost = useMemo(() => damageBoost(gd, rules, level), [gd, rules, level]);
  const info = useMemo(() => {
    void files; // read through gd: recomputed when the pets or info file arrives
    const enhs = entry.slots.filter((s) => s.level <= level).map((s) => s.enh);
    const str = powerStrength(gd, at, entry.power, enhs, level).post;
    return powerInfo(gd, at, entry.power, level, str, undefined, boost);
  }, [gd, at, entry, level, files, boost]);
  return <InfoBlocks info={info} bonus />;
}

/**
 * The version's optional files a power info reads, as they arrive: its pets file (pet damage) and
 * its info file (the client's effect notes, grants and wording). Put in a memo's dependencies, so
 * the info is worked out again when one comes.
 *
 * @param gd Game data.
 * @return Both files (null while missing).
 */
export function useInfoFiles(gd: GameData): readonly [unknown, unknown] {
  const pets = useSyncExternalStore(gd.subscribePets, () => gd.pets);
  const extras = useSyncExternalStore(gd.subscribeInfo, () => gd.info);
  return useMemo(() => [pets, extras] as const, [pets, extras]);
}

/**
 * A power info's stats and target tables and its effect lines, with dividers between them.
 *
 * @param props.info The power info (powerInfo).
 * @param props.bonus Show each row's and each effect line's slotted bonus at its right end (no
 *   column when the info has none: nothing slotted, or nothing that changes a number).
 */
export function InfoBlocks({ info, bonus: wanted }: { info: PowerInfo; bonus?: boolean }) {
  const bonus = !!wanted && ([...info.stats, ...info.target].some((r) => r.bonus !== undefined) || info.effects.some((e) => e.bonus !== undefined));
  const blocks: ReactNode[] = [];
  if (info.stats.length) blocks.push(<Rows key="s" rows={info.stats} bonus={bonus} />);
  if (info.target.length) blocks.push(<Rows key="t" rows={info.target} bonus={bonus} />);
  if (info.effects.length) {
    blocks.push(
      <div key="e">
        {info.effects.map((e, i) => (
          <div key={i} style={{ marginTop: i ? TIP_PX * 0.6 : 0 }}>
            {bonus && e.bonus !== undefined ? (
              <div style={{ display: 'flex', alignItems: 'baseline', columnGap: TIP_PX * 1.5 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Segs segs={e.line} />
                </div>
                <div data-testid="tip:bonus" style={{ flex: 'none', color: BONUS_COLOR }}>{bonusText(e.bonus)}</div>
              </div>
            ) : (
              <Segs segs={e.line} />
            )}
            {e.notes.map((n, j) => (
              <div key={j} style={{ fontStyle: 'italic', color: '#aaaa88' }}>
                <Segs segs={n} />
              </div>
            ))}
          </div>
        ))}
      </div>,
    );
  }
  // no "as used by level N <class>" title or values note: the tooltip has no class / level slider
  return (
    <>
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {i ? <Divider /> : null}
          {b}
        </Fragment>
      ))}
    </>
  );
}
