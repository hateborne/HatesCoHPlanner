import { useMemo, useState } from 'react';
import type { Power } from '../../data/types.ts';
import { BuildRules, type SetOption } from '../../engine/rules.ts';
import { currentPick, useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { DescBox, InfoButton, MenuFrame, NextButton, TitleBar } from '../components/Chrome.tsx';
import { PowerColumn } from '../components/PowerColumn.tsx';
import { icon, type Skin } from '../skin/skin.ts';

const PANEL_Y = 103;
const PANEL_H = 759;
const PANELS = [33, 689, 1345];
const PANEL_W = 622;

/**
 * "CHOOSE A NEW POWER" (uiLevelPower.c): primary and secondary panels, a third panel for pools,
 * the epic pool and VEAT branches, the green description line, and Back/Cancel + Finish.
 */
export function ChooseNewPower({ skin }: { skin: Skin }) {
  const { gd, steps, level, choosePower, openSetPicker, finishLevel, backLevel } = useStore();
  const [hover, setHover] = useState<Power | null>(null);
  const pick = level ? currentPick(steps, level) : -1;
  const rules = useMemo(() => (gd && level ? new BuildRules(gd, level.base) : null), [gd, level]);
  if (!gd || !level || !rules) return null;

  const options = rules.setOptions(pick);
  const primary = options.filter((o) => o.kind === 'primary');
  const secondary = options.filter((o) => o.kind === 'secondary');
  const extra: SetOption[] = options.filter((o) => o.kind !== 'primary' && o.kind !== 'secondary');
  if (level.pendingSet !== undefined && !extra.some((o) => o.set.id === level.pendingSet)) {
    // A set chosen on the pool/epic picker shows only the chosen power, as in the game.
    const s = gd.powerset(level.pendingSet);
    const chosen = s.p.filter((pid) => pid === level.pendingPower).map((pid) => rules.powerOption(pid, pick));
    extra.push({ set: s, kind: rules.setKind(s), owned: false, powers: chosen });
  }
  const canPool = rules.canAddNewSet('pool', pick);
  const canEpic = rules.canAddNewSet('epic', pick);
  const shown = hover ?? (level.pendingPower !== undefined ? gd.power(level.pendingPower) : null);
  const onPick = (p: Power) => {
    choosePower(p.id === level.pendingPower ? undefined : p.id);
    // a power from a set chosen on the pool picker keeps that set shown; others drop it
  };
  const firstStep = level.step === 0 && level.pickInStep === 0;
  const lvl = steps[level.step]?.level ?? 0;
  const extraButtons = (canPool ? 1 : 0) + (canEpic ? 1 : 0);

  return (
    <>
      <TitleBar skin={skin} text="CHOOSE A NEW POWER" />
      <div className="title-text abs" style={{ right: 50, top: 22, fontSize: 34 }}>
        LEVEL {lvl + 1}
      </div>
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer />
      {PANELS.map((x) => (
        <MenuFrame key={x} x={x} y={PANEL_Y} w={PANEL_W} h={PANEL_H} />
      ))}
      <InfoButton x={343} y={PANEL_Y} text="Show Detailed Info Here" disabled />
      <InfoButton x={999} y={PANEL_Y} text="Show Detailed Info Here" disabled />
      <PowerColumn skin={skin} x={PANELS[0]!} y={PANEL_Y + 4} w={PANEL_W} h={PANEL_H - 8} sets={primary} pending={level.pendingPower} onPick={onPick} onHover={setHover} />
      <PowerColumn skin={skin} x={PANELS[1]!} y={PANEL_Y + 4} w={PANEL_W} h={PANEL_H - 8} sets={secondary} pending={level.pendingPower} onPick={onPick} onHover={setHover} />
      {canPool ? (
        <CheckBar skin={skin} x={1370} y={126} wd={572} text="Choose from new pool power set" state={level.pendingSet !== undefined && rules.setKind(gd.powerset(level.pendingSet)) === 'pool' ? 'selected' : 'standard'} onClick={() => openSetPicker('pool')} scale={1.05} />
      ) : null}
      {canEpic ? (
        <CheckBar skin={skin} x={1370} y={126 + (canPool ? 48 : 0)} wd={572} text="Choose new epic pool" state={level.pendingSet !== undefined && rules.setKind(gd.powerset(level.pendingSet)) === 'epic' ? 'selected' : 'standard'} onClick={() => openSetPicker('epic')} scale={1.05} />
      ) : null}
      <PowerColumn
        skin={skin}
        x={PANELS[2]!}
        y={PANEL_Y + 4 + extraButtons * 48}
        w={PANEL_W}
        h={PANEL_H - 8 - extraButtons * 48}
        sets={extra}
        pending={level.pendingPower}
        onPick={onPick}
        onHover={setHover}
      />
      <DescBox iconSrc={shown ? icon('powers', shown.icon || 'power_missing') : undefined} text={shown ? shown.lh || shown.sh : ''} />
      <NextButton skin={skin} dir="left" text={level.mode === 'edit' ? 'Cancel' : firstStep ? 'Cancel' : 'Back'} onClick={backLevel} />
      <NextButton skin={skin} dir="right" text="Finish" locked={level.pendingPower === undefined} glow={level.pendingPower !== undefined} onClick={finishLevel} />
    </>
  );
}
