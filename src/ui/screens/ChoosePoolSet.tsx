import { useMemo, useState } from 'react';
import type { Power, Powerset } from '../../data/types.ts';
import { BuildRules } from '../../engine/rules.ts';
import { currentPick, useStore } from '../../state/store.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { DescBox, InfoButton, MenuFrame, NextButton, SetTitle, TitleBar } from '../components/Chrome.tsx';
import { PHONE_PANEL, PhoneTabs } from '../components/Phone.tsx';
import { useStage } from '../components/Stage.tsx';
import { icon, type Skin } from '../skin/skin.ts';

const ROW = 89.3;

/**
 * "CHOOSE A POOL POWER SET" (uiPowers.c): 1. choose one pool (or epic) set on the left,
 * 2. choose one power from it on the right; Finish returns to Choose a New Power with it picked.
 */
export function ChoosePoolSet({ skin, kind }: { skin: Skin; kind: 'pool' | 'epic' }) {
  const { gd, steps, level, closeSetPicker } = useStore();
  const pick = level ? currentPick(steps, level) : -1;
  const rules = useMemo(() => (gd && level ? new BuildRules(gd, level.base) : null), [gd, level]);
  const [setId, setSetId] = useState<number | undefined>(level?.pendingSet);
  const [power, setPower] = useState<number | undefined>(level?.pendingSet !== undefined ? level.pendingPower : undefined);
  const [hover, setHover] = useState<{ p?: Power; s?: Powerset } | null>(null);
  const [tab, setTab] = useState(level?.pendingSet !== undefined ? 1 : 0);
  const { phone } = useStage();
  if (!gd || !level || !rules) return null;

  const choices = rules.newSetChoices(kind, pick);
  const chosen = setId !== undefined ? gd.powerset(setId) : undefined;
  const powers = chosen ? chosen.p.map((pid) => rules.powerOption(pid, pick)) : [];
  const shownP = hover?.p ?? (power !== undefined ? gd.power(power) : undefined);
  const shownS = hover?.s ?? (hover ? undefined : chosen);
  const descText = hover?.s ? hover.s.lh || hover.s.sh : shownP ? shownP.lh || shownP.sh : shownS ? shownS.lh || shownS.sh : '';
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
        onHover={(on) => setHover(on ? { s: c.set } : null)}
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
        icon={o.power.id === power ? icon('powers', o.power.icon || 'power_missing') : undefined}
        title={o.reason}
        onClick={o.state === 'available' ? () => setPower(o.power.id === power ? undefined : o.power.id) : undefined}
        onHover={(on) => setHover(on ? { p: o.power } : null)}
      />
    ));

  if (phone) {
    const P = PHONE_PANEL;
    const n = tab === 0 ? choices.length : powers.length;
    return (
      <>
        <TitleBar skin={skin} text={kind === 'pool' ? 'CHOOSE A POOL POWER SET' : 'CHOOSE AN EPIC POWER SET'} />
        <PhoneTabs skin={skin} labels={[kind === 'pool' ? '1. Pool set' : '1. Epic set', '2. Power']} active={tab} onChange={setTab} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={P.h} />
        <div className="abs scroll-y" style={{ left: P.x + 4, top: P.y + 6, width: P.w - 8, height: P.h - 12 }}>
          <div style={{ position: 'relative', height: n * ROW + 60 }}>{tab === 0 ? setBars(70, 60, P.w - 130) : powerBars(70, 60, P.w - 130)}</div>
        </div>
        <DescBox iconSrc={shownP ? icon('powers', shownP.icon || 'power_missing') : undefined} text={descText} />
        <NextButton skin={skin} dir="left" text="Back" onClick={() => closeSetPicker()} />
        <NextButton skin={skin} dir="right" text="Finish" locked={power === undefined} glow={power !== undefined} onClick={() => closeSetPicker(setId, power)} />
      </>
    );
  }

  return (
    <>
      <TitleBar skin={skin} text={kind === 'pool' ? 'CHOOSE A POOL POWER SET' : 'CHOOSE AN EPIC POWER SET'} />
      <MenuFrame x={32} y={58} w={1937} h={988} r25 outer />
      <SetTitle x={168} y={78} width={690} center size={28} text={kind === 'pool' ? '1. Choose one power pool set' : '1. Choose one epic power set'} />
      <SetTitle x={1153} y={78} width={702} center size={28} text="2. Choose one power from set" />
      <MenuFrame x={168} y={118} w={690} h={730} />
      <MenuFrame x={858} y={118} w={295} h={307} />
      <MenuFrame x={858} y={541} w={295} h={307} />
      <MenuFrame x={1153} y={118} w={702} h={730} />
      <InfoButton x={999} y={483} text="Show Detailed Info" disabled />
      <div className="abs scroll-y" style={{ left: 172, top: 130, width: 682, height: 712 }}>
        <div style={{ position: 'relative', height: choices.length * ROW + 60 }}>{setBars(95, 90, 525)}</div>
      </div>
      <div className="abs scroll-y" style={{ left: 1157, top: 122, width: 694, height: 722 }}>
        <div style={{ position: 'relative', height: powers.length * ROW + 60 }}>{powerBars(85, 72, 525)}</div>
      </div>
      <DescBox iconSrc={shownP ? icon('powers', shownP.icon || 'power_missing') : undefined} text={descText} />
      <NextButton skin={skin} dir="left" text="Back" onClick={() => closeSetPicker()} />
      <NextButton skin={skin} dir="right" text="Finish" locked={power === undefined} glow={power !== undefined} onClick={() => closeSetPicker(setId, power)} />
    </>
  );
}
