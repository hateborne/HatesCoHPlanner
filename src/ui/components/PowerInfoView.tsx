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

/** A two-column "Label: value" table (the stats and target blocks). */
export function Rows({ rows }: { rows: InfoRow[] }) {
  if (!rows.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: TIP_PX * 1.5 }}>
      {rows.map((r, i) => (
        <Fragment key={i}>
          {/* a row without a value is a heading across both columns */}
          <div style={{ color: INFO_LABEL_COLOR, gridColumn: r.value.length ? undefined : '1 / -1' }}>{r.label}</div>
          {r.value.length ? (
            <div style={{ color: '#ffffff' }}>
              <Segs segs={r.value} />
            </div>
          ) : null}
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
 * title line, PvP switch and level slider are left out (nothing to adjust in a tooltip).
 *
 * @param props.entry The hovered power with its slots (their enhancements give the enhanced values).
 * @param props.level 0-based character level the values are shown at.
 * @param props.rules Rules view of the build the power is in: its damage boosts (damageBoost) give
 *   the boosted damage rows.
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
  return <InfoBlocks info={info} />;
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
 */
export function InfoBlocks({ info }: { info: PowerInfo }) {
  const blocks: ReactNode[] = [];
  if (info.stats.length) blocks.push(<Rows key="s" rows={info.stats} />);
  if (info.target.length) blocks.push(<Rows key="t" rows={info.target} />);
  if (info.effects.length) {
    blocks.push(
      <div key="e">
        {info.effects.map((e, i) => (
          <div key={i} style={{ marginTop: i ? TIP_PX * 0.6 : 0 }}>
            <Segs segs={e.line} />
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
