import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Power, Powerset } from '../../data/types.ts';
import { BuildRules } from '../../engine/rules.ts';
import { currentPick, useStore } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { useFreshHover, useHover } from '../hover.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { DescBox, InfoButton, MenuFrame, NextButton, SetFrame, TitleBar } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { GameText } from '../components/GameText.tsx';
import { S, vx, vy } from '../skin/metrics.ts';
import { PHONE_PANEL, PhoneTabs } from '../components/Phone.tsx';
import { useStage } from '../components/Stage.tsx';
import { icon, type Skin } from '../skin/skin.ts';

const ROW = vy(61); // PSET_SPACER / POW_SPACER

/**
 * The description box: the hovered set or power. The client shows help only while the mouse is
 * over the lists (uiPowers.c); phones have no hover, so there the chosen set / power stays described.
 */
function PoolDesc({ skin, phone, power, chosen }: { skin: Skin; phone: boolean; power?: Power; chosen?: Powerset }) {
  const hover = useHover((h) => h.desc);
  const shownP = hover?.p ?? (phone && !hover ? power : undefined);
  const shownS = hover?.s ?? (hover || !phone ? undefined : chosen);
  const descText = hover?.s ? hover.s.lh || hover.s.sh : shownP ? shownP.lh || shownP.sh : shownS ? shownS.lh || shownS.sh : '';
  return <DescBox skin={skin} iconSrc={shownP ? icon('powers', shownP.icon || 'power_missing') : undefined} text={descText} color={skin.poolDesc} textScale={1.05} />;
}

/**
 * "CHOOSE A POOL POWER SET" (uiPowers.c): 1. choose one pool (or epic) set on the left,
 * 2. choose one power from it on the right; Finish returns to Choose a New Power with it picked.
 */
export function ChoosePoolSet({ skin, kind }: { skin: Skin; kind: 'pool' | 'epic' }) {
  const { gd, steps, level, closeSetPicker } = useStore(useShallow((s) => ({ gd: s.gd, steps: s.steps, level: s.level, closeSetPicker: s.closeSetPicker })));
  useFreshHover(); // hover lives in useHover: hovering a bar redraws only the description box
  useEscape(() => closeSetPicker()); // back to the power list
  const pick = level ? currentPick(steps, level) : -1;
  const rules = useMemo(() => (gd && level ? new BuildRules(gd, level.base) : null), [gd, level]);
  const [setId, setSetId] = useState<number | undefined>(level?.pendingSet);
  const [power, setPower] = useState<number | undefined>(level?.pendingSet !== undefined ? level.pendingPower : undefined);
  const [tab, setTab] = useState(level?.pendingSet !== undefined ? 1 : 0);
  const { phone } = useStage();
  if (!gd || !level || !rules) return null;

  const choices = rules.newSetChoices(kind, pick);
  const chosen = setId !== undefined ? gd.powerset(setId) : undefined;
  const powers = chosen ? chosen.p.map((pid) => rules.powerOption(pid, pick)) : [];
  const desc = <PoolDesc skin={skin} phone={phone} power={power !== undefined ? gd.power(power) : undefined} chosen={chosen} />;
  const setBars = (x0: number, y0: number, wd: number) =>
    choices.map((c, i) => (
      <CheckBar
        key={c.set.id}
        skin={skin}
        x={x0}
        y={y0 + i * ROW}
        wd={wd}
        text={c.set.dn}
        state={c.block ? 'unselectable' : c.set.id === setId ? 'selected' : 'standard'}
        down={c.set.id === setId}
        title={c.block ?? undefined}
        onClick={c.block ? undefined : () => {
          setSetId(c.set.id);
          setPower(undefined);
          setTab(1);
        }}
        onHover={(on) => useHover.setState({ desc: on ? { s: c.set } : null })}
      />
    ));
  const powerBars = (x0: number, y0: number, wd: number) =>
    powers.map((o, i) => (
      <CheckBar
        key={o.power.id}
        skin={skin}
        x={x0}
        y={y0 + i * ROW}
        wd={wd}
        text={o.power.dn}
        state={o.state === 'available' ? 'selected' : 'unselectable'}
        down={o.power.id === power}
        isPower
        icon={o.power.id === power ? icon('powers', o.power.icon || 'power_missing') : undefined}
        title={o.reason}
        onClick={o.state === 'available' ? () => setPower(o.power.id === power ? undefined : o.power.id) : undefined}
        onHover={(on) => useHover.setState({ desc: on ? { p: o.power } : null })}
      />
    ));

  if (phone) {
    const P = PHONE_PANEL;
    const n = tab === 0 ? choices.length : powers.length;
    return (
      <>
        <TitleBar skin={skin} text={kind === 'pool' ? 'CHOOSE A POOL POWER SET' : 'CHOOSE AN EPIC POWER SET'} />
        <PhoneTabs skin={skin} labels={[kind === 'pool' ? '1. Pool set' : '1. Epic set', '2. Power']} active={tab} onChange={setTab} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={P.h} skin={skin} />
        <GameScroll skin={skin} left={P.x + 4} top={P.y + 20} width={P.w - 8} height={P.h - 40} barX={P.x + P.w}>
          <div style={{ position: 'relative', height: n * ROW + 60 }}>{tab === 0 ? setBars(70, 50, P.w - 130) : powerBars(70, 50, P.w - 130)}</div>
        </GameScroll>
        {desc}
        <NextButton skin={skin} dir="left" text="Back" onClick={() => closeSetPicker()} />
        <NextButton skin={skin} dir="right" text="Finish" locked={power === undefined} onClick={() => closeSetPicker(setId, power)} />
      </>
    );
  }

  // uiPowers.c: both lists clip to y 80+4px .. +500*sy-7 (powerSetSelector / powerSelector), while
  // their scrollbars (doScrollBarEx) span 104..556 at x 85 + 4s and 950; sets start at y 151 and
  // powers at 133, 61 apart, 270*sx wide at x 135 / 636; each list sits in a drawFrame inner frame
  // 260 wide from first - 48 (sets) or first - 30 (powers); titles title_12 x 1.3 centered at
  // 270 / 771, baseline 75. Scroll range = ht - 452, ht = (sets + 1) * 61 or powers * 61.
  const clipTop = vy(80) + 4;
  const clipH = vy(500) - 7;
  const barTop = vy(104);
  const barH = vy(452);
  const L = { left: vx(85), width: vx(355) };
  const R = { left: vx(590), width: vx(370) };
  const contentH = (ht: number) => Math.max(0, clipH + vy(ht - 452));
  const setY = vy(151) - clipTop;
  const powY = vy(133) - clipTop;
  return (
    <>
      <TitleBar skin={skin} text={kind === 'pool' ? 'CHOOSE A POOL POWER SET' : 'CHOOSE AN EPIC POWER SET'} />
      <GameText font="title_12" scale={1.3 * S} x={vx(270)} y={vy(75)} align="center" colors={skin.heading} text={kind === 'pool' ? '1. Choose One Power Pool Set' : '1. Choose One Epic Power Set'} />
      <GameText font="title_12" scale={1.3 * S} x={vx(771)} y={vy(75)} align="center" colors={skin.heading} text="2. Choose One Power From Set" />
      <MenuFrame x={168} y={118} w={690} h={730} skin={skin} />
      <MenuFrame x={858} y={118} w={295} h={307} skin={skin} />
      <MenuFrame x={858} y={541} w={295} h={307} skin={skin} />
      <MenuFrame x={1153} y={118} w={702} h={730} skin={skin} />
      <InfoButton skin={skin} x={vx(512)} y={vy(330)} text="Show Detailed Info" disabled={setId === undefined} />
      <GameScroll skin={skin} left={L.left} top={clipTop} width={L.width} height={clipH} barX={vx(85) + 4 * S} barTop={barTop} barHeight={barH}>
        <div style={{ position: 'relative', height: contentH((choices.length + 1) * 61) }}>
          {choices.length ? <SetFrame skin={skin} x={vx(135) - L.left} y={setY - vy(48)} w={vx(260)} h={vy((choices.length - 1) * 61 + 96)} /> : null}
          {setBars(vx(135) - L.left, setY, vx(270))}
        </div>
      </GameScroll>
      <GameScroll skin={skin} left={R.left} top={clipTop} width={R.width} height={clipH} barX={vx(950)} barTop={barTop} barHeight={barH}>
        <div style={{ position: 'relative', height: contentH(powers.length * 61) }}>
          {powers.length ? <SetFrame skin={skin} x={vx(636) - R.left} y={powY - vy(30)} w={vx(260)} h={vy((powers.length - 1) * 61 + 60)} /> : null}
          {powerBars(vx(636) - R.left, powY, vx(270))}
        </div>
      </GameScroll>
      {desc}
      <NextButton skin={skin} dir="left" text="Back" onClick={() => closeSetPicker()} />
      <NextButton skin={skin} dir="right" text="Finish" locked={power === undefined} onClick={() => closeSetPicker(setId, power)} />
    </>
  );
}
