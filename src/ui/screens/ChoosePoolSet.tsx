import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Power, Powerset } from '../../data/types.ts';
import { earlierOption } from '../../engine/actions.ts';
import { BuildRules, isPatronSet, patronArcNote } from '../../engine/rules.ts';
import { autoAdvanceReady, currentPick, inRespec, useStore } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { useFreshHover, useHover } from '../hover.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { DescBox, MenuFrame, NextButton, SetFrame, TitleBar } from '../components/Chrome.tsx';
import { GameScroll } from '../components/GameScroll.tsx';
import { GameText } from '../components/GameText.tsx';
import { S, vx, vy } from '../skin/metrics.ts';
import { PHONE_DESC_H, phoneGeom, phonePanel, PhoneTabs } from '../components/Phone.tsx';
import { PhoneTipLayer } from '../components/PhoneTip.tsx';
import { PickTip, pressPickTip } from '../components/PickTip.tsx';
import { useStage } from '../components/Stage.tsx';
import { icon, SKINS, type Skin } from '../skin/skin.ts';

const ROW = vy(61); // PSET_SPACER / POW_SPACER
// planner: the Patron pools' own frame sits this far (virtual px) below the other epic sets' frame
const PATRON_GAP = 15;
// planner: the Patron pools always show in the villain skin, whatever the build's, to set them apart
const PATRON_SKIN = SKINS.villain;

type SetChoice = ReturnType<BuildRules['newSetChoices']>[number];

/**
 * The description box: the hovered set or power. The client shows help only while the mouse is
 * over the lists (uiPowers.c); phones have no hover, so there the chosen set / power stays described.
 * A Patron pool in its own box, and its powers, are described in the villain skin's colour.
 */
function PoolDesc({ skin, phone, power, chosen, patronIds }: { skin: Skin; phone: boolean; power?: Power; chosen?: Powerset; patronIds: ReadonlySet<number> }) {
  const hover = useHover((h) => h.desc);
  const shownP = hover?.p ?? (phone && !hover ? power : undefined);
  const shownS = hover?.s ?? (hover || !phone ? undefined : chosen);
  const descText = hover?.s ? hover.s.lh || hover.s.sh : shownP ? shownP.lh || shownP.sh : shownS ? shownS.lh || shownS.sh : '';
  // the powers listed are always the chosen set's
  const patron = shownS ? patronIds.has(shownS.id) : shownP !== undefined && chosen !== undefined && patronIds.has(chosen.id);
  return <DescBox skin={skin} iconSrc={shownP ? icon('powers', shownP.icon || 'power_missing') : undefined} text={descText} color={(patron ? PATRON_SKIN : skin).poolDesc} textScale={1.05} />;
}

/**
 * "CHOOSE A POOL POWER SET" (uiPowers.c): 1. choose one pool (or epic) set on the left,
 * 2. choose one power from it on the right; Finish returns to Choose a New Power with it picked.
 */
export function ChoosePoolSet({ skin, kind }: { skin: Skin; kind: 'pool' | 'epic' }) {
  const { gd, steps, level, closeSetPicker, finishLevel, tell, advanced } = useStore(
    useShallow((s) => ({ gd: s.gd, steps: s.steps, level: s.level, closeSetPicker: s.closeSetPicker, finishLevel: s.finishLevel, tell: s.tell, advanced: s.advancedRespec })),
  );
  useFreshHover(); // hover lives in useHover: hovering a bar redraws only the description box
  useEscape(() => closeSetPicker()); // back to the power list
  const pick = level ? currentPick(steps, level) : -1;
  const rules = useMemo(() => (gd && level ? new BuildRules(gd, level.base) : null), [gd, level]);
  const [setId, setSetId] = useState<number | undefined>(level?.pendingSet);
  const [power, setPower] = useState<number | undefined>(level?.pendingSet !== undefined ? level.pendingPower : undefined);
  const [tab, setTab] = useState(level?.pendingSet !== undefined ? 1 : 0);
  const [patronTold, setPatronTold] = useState(false); // the hero Patron note, once a visit
  const stage = useStage();
  const { phone } = stage;
  if (!gd || !level || !rules) return null;

  const choices = rules.newSetChoices(kind, pick);
  // the Patron pools get their own villain-coloured box below the other epic sets; Arachnos Soldiers
  // and Widows, whose only epic sets they are, see them as plain epic sets
  const patronSets = kind === 'epic' ? choices.filter((c) => isPatronSet(gd, c.set)) : [];
  const patron = patronSets.length < choices.length ? patronSets : [];
  const others = choices.filter((c) => !patron.includes(c));
  const patronIds = new Set(patron.map((c) => c.set.id));
  // first Patron bar below the first set bar: past the others' frame, the gap and its own top margin
  const patronOff = others.length && patron.length ? vy((others.length - 1) * 61 + 48 + PATRON_GAP + 48) : 0;
  const chosen = setId !== undefined ? gd.powerset(setId) : undefined;
  const powSkin = chosen && patronIds.has(chosen.id) ? PATRON_SKIN : skin;
  // reopened from the overview, or chosen again after a swap: a power the build takes later can be
  // taken here instead
  const earlier = level.mode === 'edit';
  const powers = chosen ? chosen.p.map((pid) => rules.powerOption(pid, pick)).map((o) => (earlier ? earlierOption(gd, level.base, pick, o) : o)) : [];
  const desc = <PoolDesc skin={skin} phone={phone} power={power !== undefined ? gd.power(power) : undefined} chosen={chosen} patronIds={patronIds} />;
  const setBars = (list: SetChoice[], sk: Skin, x0: number, y0: number, wd: number) =>
    list.map((c, i) => (
      <CheckBar
        key={c.set.id}
        testId={`set:${c.set.id}`}
        skin={sk}
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
          // the Patron arcs that unlock these are villain content: say so, once a visit (not to Arachnos
          // Soldiers and Widows, for whom they are the only choice)
          const note = patronIds.has(c.set.id) && !patronTold ? patronArcNote(gd, level.base, c.set) : null;
          if (note) {
            setPatronTold(true);
            void tell({ title: 'Patron Power Pool', ...note });
          }
        }}
        onHover={(on) => useHover.setState({ desc: on ? { s: c.set } : null })}
      />
    ));
  // both groups of sets, each in its own frame (the frame 10/270 narrower than the bars, as uiPowers.c
  // draws it: 260 wide under 270 wide bars); `frameOthers` false leaves the others' frame to the caller
  const setLists = (x0: number, y0: number, wd: number, frameOthers: boolean) => (
    <>
      {frameOthers && others.length ? <SetFrame skin={skin} x={x0} y={y0 - vy(48)} w={(wd * 26) / 27} h={vy((others.length - 1) * 61 + 96)} /> : null}
      {setBars(others, skin, x0, y0, wd)}
      {patron.length ? <SetFrame skin={PATRON_SKIN} x={x0} y={y0 + patronOff - vy(48)} w={(wd * 26) / 27} h={vy((patron.length - 1) * 61 + 96)} /> : null}
      {setBars(patron, PATRON_SKIN, x0, y0 + patronOff, wd)}
    </>
  );
  // Advanced Respec (a Respec build): a click on a power takes it and moves on, as on Choose a New Power
  const auto = advanced && inRespec(gd, level.base, pick) && setId !== undefined;
  const pickPower = (id: number) => {
    if (auto) {
      // the second click of a double-click would take a power on the next screen too
      if (!autoAdvanceReady()) return;
      closeSetPicker(setId, id);
      finishLevel();
      return;
    }
    setPower(id === power ? undefined : id);
  };
  const powerBars = (x0: number, y0: number, wd: number) =>
    powers.map((o, i) => (
      <CheckBar
        key={o.power.id}
        testId={`power:${o.power.id}`}
        skin={powSkin}
        x={x0}
        y={y0 + i * ROW}
        wd={wd}
        text={o.power.dn}
        state={o.state === 'available' ? 'selected' : 'unselectable'}
        down={o.power.id === power}
        isPower
        icon={o.power.id === power ? icon('powers', o.power.icon || 'power_missing') : undefined}
        title={o.reason}
        onClick={o.state === 'available' ? () => pickPower(o.power.id) : undefined}
        onLongPress={phone ? (pt) => pressPickTip(rules, o.power, pick, pt, o.state === 'available' ? undefined : o.reason) : undefined}
        onHover={(on, at) => useHover.setState({ desc: on ? { p: o.power, at } : null })}
      />
    ));

  if (phone) {
    const pg = phoneGeom(stage, false);
    const P = phonePanel(pg, PHONE_DESC_H + 8);
    const n = tab === 0 ? choices.length : powers.length;
    // with a Patron box the sets (and their powers) get frames, so they start below the frame's top
    const framed = patron.length > 0;
    const top = framed ? vy(48) + 12 : 44;
    // the last bar's y, then room below it for the bar (and its frame's bottom margin)
    const lastY = top + (tab === 1 ? (n - 1) * ROW : patron.length ? patronOff + (patron.length - 1) * ROW : (n - 1) * ROW);
    const listH = Math.max(0, lastY + Math.max(ROW, vy(48)) + 6);
    return (
      <>
        <TitleBar skin={skin} text={kind === 'pool' ? 'CHOOSE A POOL POWER SET' : 'CHOOSE AN EPIC POWER SET'} />
        <PhoneTabs skin={skin} labels={[kind === 'pool' ? '1. Pool set' : '1. Epic set', '2. Power']} active={tab} onChange={setTab} y={pg.tabsY} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={P.h} skin={skin} />
        <GameScroll skin={skin} left={P.x + 4} top={P.y + 12} width={P.w - 8} height={P.h - 24} barX={P.x + P.w}>
          <div style={{ position: 'relative', height: listH }}>
            {tab === 0 ? setLists(52, top, P.w - 90, framed) : null}
            {tab === 1 && framed && powers.length ? <SetFrame skin={powSkin} x={52} y={top - vy(30)} w={((P.w - 90) * 26) / 27} h={vy((powers.length - 1) * 61 + 60)} /> : null}
            {tab === 1 ? powerBars(52, top, P.w - 90) : null}
          </div>
        </GameScroll>
        {desc}
        <NextButton skin={skin} dir="left" text="Back" onClick={() => closeSetPicker()} />
        <NextButton skin={skin} dir="right" text="Finish" locked={power === undefined} onClick={() => closeSetPicker(setId, power)} />
        <PhoneTipLayer gd={gd} skin={skin} at={rules.at} level={rules.pickLevel(pick)} rules={rules} />
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
      {/* no Show Detailed Info button between the frames: the advanced tooltip shows those numbers */}
      <GameScroll skin={skin} left={L.left} top={clipTop} width={L.width} height={clipH} barX={vx(85) + 4 * S} barTop={barTop} barHeight={barH}>
        <div style={{ position: 'relative', height: contentH((choices.length + 1) * 61 + (others.length && patron.length ? 2 * 48 + PATRON_GAP - 61 : 0)) }}>
          {setLists(vx(135) - L.left, setY, vx(270), /*frameOthers=*/ true)}
        </div>
      </GameScroll>
      <GameScroll skin={skin} left={R.left} top={clipTop} width={R.width} height={clipH} barX={vx(950)} barTop={barTop} barHeight={barH}>
        <div style={{ position: 'relative', height: contentH(powers.length * 61) }}>
          {powers.length ? <SetFrame skin={powSkin} x={vx(636) - R.left} y={powY - vy(30)} w={vx(260)} h={vy((powers.length - 1) * 61 + 60)} /> : null}
          {powerBars(vx(636) - R.left, powY, vx(270))}
        </div>
      </GameScroll>
      {desc}
      <NextButton skin={skin} dir="left" text="Back" onClick={() => closeSetPicker()} />
      <NextButton skin={skin} dir="right" text="Finish" locked={power === undefined} onClick={() => closeSetPicker(setId, power)} />
      <PickTip gd={gd} skin={skin} rules={rules} pick={pick} />
    </>
  );
}
