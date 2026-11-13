import { useMemo } from 'react';
import type { GameData } from '../../data/gamedata.ts';
import type { Power } from '../../data/types.ts';
import type { BuildEntry, BuildRules } from '../../engine/rules.ts';
import { useHover } from '../hover.ts';
import { useTipLevel } from '../../state/store.ts';
import { AdvancedInfo } from './PowerInfoView.tsx';
import { SlotTip, usePointer } from './PowerTip.tsx';
import { useStage } from './Stage.tsx';

/**
 * The build entry a power-picking screen's tooltip describes: the power as the build has it (with
 * its slots), or, not taken yet, unenhanced at the pick's level.
 *
 * @param entries The build's entries.
 * @param power The power.
 * @param level 0-based level of the pick being made.
 * @return The entry.
 */
export function pickEntry(entries: BuildEntry[], power: Power, level: number): BuildEntry {
  return entries.find((e) => e.power.id === power.id) ?? { key: `power:${power.id}`, power, level, slots: [], source: 'pick' };
}

/**
 * Phones: open the long-press tooltip for a power on a power-picking screen.
 *
 * @param rules Rules of the build before this pick.
 * @param power The pressed power.
 * @param pick The pick being made.
 * @param pt The press point (window px).
 * @param why Why it can't be picked, if it can't (shown in red at the top).
 */
export function pressPickTip(rules: BuildRules, power: Power, pick: number, pt: { x: number; y: number }, why?: string): void {
  useHover.setState({ press: { kind: 'power', entry: pickEntry(rules.entries(), power, rules.pickLevel(pick)), notes: why ? [why] : [], ...pt } });
}

/**
 * The Advanced power tooltip on the power-picking screens (Choose a New Power, Choose a Pool Power
 * Set): while tooltips are Advanced, or Enabled with Shift held, the hovered power's slot details
 * and detailed numbers, the same box the build overview shows.
 *
 * The Enabled tooltip is left out here: these screens already describe the hovered power in their
 * box at the bottom. Phones have no hover: a long press opens the same details there
 * (pressPickTip, PhoneTipLayer).
 *
 * @param props.gd Game data.
 * @param props.rules Rules of the build before this pick (a power already in it keeps its slots).
 * @param props.pick The pick being made: the numbers are at its level.
 */
export function PickTip({ gd, rules, pick }: { gd: GameData; rules: BuildRules; pick: number }) {
  const desc = useHover((h) => h.desc);
  const power = desc?.p;
  const tipLevel = useTipLevel();
  const mouse = usePointer();
  const { phone } = useStage();
  const entries = useMemo(() => rules.entries(), [rules]);
  if (!power || tipLevel !== 'advanced' || phone) return null;
  const level = rules.pickLevel(pick);
  const entry = pickEntry(entries, power, level);
  return <SlotTip gd={gd} power={power} x={mouse.current.x} y={mouse.current.y} avoid={desc?.at} advanced={<AdvancedInfo gd={gd} at={rules.at} entry={entry} level={level} />} />;
}
