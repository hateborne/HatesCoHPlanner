import { useMemo, useState } from 'react';
import type { Power } from '../../data/types.ts';
import { BuildRules, type SetOption } from '../../engine/rules.ts';
import { currentPick, useStore } from '../../state/store.ts';
import { DescBox, InfoButton, MenuBar, MenuFrame, NextButton, TitleBar } from '../components/Chrome.tsx';
import { GameText } from '../components/GameText.tsx';
import { PHONE_PANEL, PhoneTabs } from '../components/Phone.tsx';
import { desktopColumn, PowerColumn, type ColumnGeom } from '../components/PowerColumn.tsx';
import { useStage } from '../components/Stage.tsx';
import { S, vx, vy } from '../skin/metrics.ts';
import { icon, type Skin } from '../skin/skin.ts';

/**
 * "CHOOSE A NEW POWER" (uiLevelPower.c): primary and secondary panels, a third panel for pools,
 * the epic pool and VEAT branches, the green description line, and Back/Cancel + Finish.
 */
export function ChooseNewPower({ skin }: { skin: Skin }) {
  const { gd, steps, level, choosePower, openSetPicker, finishLevel, backLevel } = useStore();
  const [hover, setHover] = useState<Power | null>(null);
  const [tab, setTab] = useState(0);
  const { phone } = useStage();
  const pick = level ? currentPick(steps, level) : -1;
  const rules = useMemo(() => (gd && level ? new BuildRules(gd, level.base) : null), [gd, level]);
  if (!gd || !level || !rules) return null;

  const options = rules.setOptions(pick);
  const primary = options.filter((o) => o.column === 0);
  const secondary = options.filter((o) => o.column === 1);
  const extra: SetOption[] = options.filter((o) => o.column === 2);
  if (level.pendingSet !== undefined && !extra.some((o) => o.set.id === level.pendingSet)) {
    // A set chosen on the pool/epic picker shows only the chosen power, as in the game.
    const s = gd.powerset(level.pendingSet);
    const chosen = s.p.filter((pid) => pid === level.pendingPower).map((pid) => rules.powerOption(pid, pick));
    extra.push({ set: s, kind: rules.setKind(s), column: 2, owned: false, powers: chosen });
  }
  const canPool = rules.canAddNewSet('pool', pick);
  const canEpic = rules.canAddNewSet('epic', pick);
  // the client clears the help text when the mouse leaves a bar (uiLevelPower.c); phones have no
  // hover, so there the chosen power's text stays up
  const shown = hover ?? (phone && level.pendingPower !== undefined ? gd.power(level.pendingPower) : null);
  const onPick = (p: Power) => {
    choosePower(p.id === level.pendingPower ? undefined : p.id);
    // a power from a set chosen on the pool picker keeps that set shown; others drop it
  };
  const firstStep = level.step === 0 && level.pickInStep === 0;
  const lvl = steps[level.step]?.level ?? 0;
  const extraButtons = (canPool ? 1 : 0) + (canEpic ? 1 : 0);

  const BAR_H = vy(28);
  const desc = <DescBox skin={skin} iconSrc={shown ? icon('powers', shown.icon || 'power_missing') : undefined} text={shown ? shown.lh || shown.sh : ''} />;
  const buttons = (
    <>
      <NextButton skin={skin} dir="left" text={level.mode === 'edit' || firstStep ? 'Cancel' : 'Back'} onClick={backLevel} />
      <NextButton skin={skin} dir="right" text="Finish" locked={level.pendingPower === undefined} onClick={finishLevel} />
    </>
  );
  // uiLevelPower.c: drawMenuBar centered on the third panel at y 85 (55 and 85 when both show),
  // FRAME_WIDTH wide, over the panel's top edge; the panel's contents do not move
  const newSetBars = (cx: number, y0: number, step: number, wd: number) => (
    <>
      {canPool ? <MenuBar skin={skin} x={cx} y={y0} wd={wd} text="Choose from new pool power set" onClick={() => openSetPicker('pool')} /> : null}
      {canEpic ? <MenuBar skin={skin} x={cx} y={y0 + (canPool ? step : 0)} wd={wd} text="Choose from new Epic power set" onClick={() => openSetPicker('epic')} /> : null}
    </>
  );
  const levelLabel = (x: number, y: number) => <GameText font="title_14" scale={S} x={x} y={y} align="right" colors={skin.heading} text={`LEVEL ${lvl + 1}`} />;

  if (phone) {
    const P = PHONE_PANEL;
    const lists = [primary, secondary, extra];
    const off = tab === 2 ? extraButtons * (BAR_H + 6) : 0;
    const g: ColumnGeom = { left: P.x, top: P.y + 8 + off, width: P.w, height: P.h - 16 - off, barX: P.x + P.w, headX: 26, barCX: 70, barW: P.w - 120, firstHead: vy(31) };
    return (
      <>
        <TitleBar skin={skin} text="CHOOSE A NEW POWER" />
        {levelLabel(980, 118)}
        <PhoneTabs skin={skin} labels={['Primary', 'Secondary', extraButtons || extra.length ? 'Pools' : 'Other']} active={tab} onChange={setTab} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={P.h} skin={skin} />
        {tab === 2 ? newSetBars(P.x + P.w / 2, P.y + 6 + BAR_H / 2, BAR_H + 6, P.w - 12) : null}
        <PowerColumn skin={skin} g={g} sets={lists[tab] ?? []} pending={level.pendingPower} onPick={onPick} onHover={setHover} />
        {desc}
        {buttons}
      </>
    );
  }

  return (
    <>
      <TitleBar skin={skin} text="CHOOSE A NEW POWER" />
      {levelLabel(vx(1010), vy(38))}
      {[0, 1, 2].map((i) => (
        <MenuFrame key={i} x={vx(16 + 336 * i)} y={vy(70)} w={vx(320)} h={vy(520)} skin={skin} />
      ))}
      <InfoButton skin={skin} x={vx(16 + 160)} y={vy(70)} text="Show Detailed Info Here" />
      <InfoButton skin={skin} x={vx(352 + 160)} y={vy(70)} text="Show Detailed Info Here" />
      <PowerColumn skin={skin} g={desktopColumn(0)} sets={primary} pending={level.pendingPower} onPick={onPick} onHover={setHover} />
      <PowerColumn skin={skin} g={desktopColumn(1)} sets={secondary} pending={level.pendingPower} onPick={onPick} onHover={setHover} />
      {newSetBars(vx(1024 - 16 - 160), vy(canPool && canEpic ? 55 : 85), vy(30), vx(320))}
      <PowerColumn skin={skin} g={desktopColumn(2)} sets={extra} pending={level.pendingPower} onPick={onPick} onHover={setHover} />
      {desc}
      {buttons}
    </>
  );
}
