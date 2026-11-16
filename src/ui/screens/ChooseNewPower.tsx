import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { GameData } from '../../data/gamedata.ts';
import type { Power } from '../../data/types.ts';
import type { Build } from '../../engine/build.ts';
import { BuildRules, type SetOption } from '../../engine/rules.ts';
import { currentPick, stepsOf, useStore, type LevelCtx } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { hoverPower, useFreshHover, useHover } from '../hover.ts';
import { DescBox, MenuBar, MenuFrame, NextButton, RespecCounter, TitleBar } from '../components/Chrome.tsx';
import { GameText } from '../components/GameText.tsx';
import { PHONE_DESC_H, phoneDesc, phoneGeom, phonePanel, PhoneTabs, type Rect } from '../components/Phone.tsx';
import { PhoneTipLayer } from '../components/PhoneTip.tsx';
import { PickTip, pressPickTip } from '../components/PickTip.tsx';
import { desktopColumn, PowerColumn, type ColumnGeom } from '../components/PowerColumn.tsx';
import { useStage } from '../components/Stage.tsx';
import { S, SY, TOP_LABEL_RIGHT, vx, vy } from '../skin/metrics.ts';
import { icon, type Skin } from '../skin/skin.ts';

/** The green description box: follows the hovered power (on phones, the chosen one when nothing is hovered). */
function HoverDesc({ skin, fallback, box }: { skin: Skin; fallback: Power | null; box?: Rect }) {
  const shown = useHover((h) => h.desc?.p) ?? fallback;
  return <DescBox skin={skin} {...box} iconSrc={shown ? icon('powers', shown.icon || 'power_missing') : undefined} text={shown ? shown.lh || shown.sh : ''} />;
}

// phones: the respec counter's row between the description box and Back / Next
const PHONE_COUNTER_H = 52;

// phones: the tab a pick screen was left on, so coming back from the pool / epic picker (with or
// without a choice) shows Pools again; tied to the screen's build and pick
let tabMemo: { base: Build; step: number; pick: number; tab: number } | null = null;

/**
 * Phones: which of the screen's tabs (Primary, Secondary, Pools) have something to pick now,
 * whether Pools has just opened (nothing new could be added at the previous pick), and whether an
 * epic pool has just become available (none could be opened at the previous pick).
 *
 * @param rules Rules of the build before this pick.
 * @param pick The pick being made.
 * @param extra The third panel's sets (with a set chosen on the pool picker).
 * @return The open tabs, whether Pools just unlocked and whether epic pools just did.
 */
function phoneTabState(rules: BuildRules, pick: number, extra: SetOption[]): { open: boolean[]; unlocked: boolean; epicUnlocked: boolean } {
  const options = rules.setOptions(pick);
  const any = (sets: SetOption[]) => sets.some((o) => o.powers.some((p) => p.state === 'available'));
  const newSet = (i: number) => rules.canAddNewSet('pool', i) || rules.canAddNewSet('epic', i);
  const pools = newSet(pick) || any(extra);
  return {
    open: [any(options.filter((o) => o.column === 0)), any(options.filter((o) => o.column === 1)), pools],
    unlocked: pools && !(pick > 0 && newSet(pick - 1)),
    epicUnlocked: rules.canAddNewSet('epic', pick) && !(pick > 0 && rules.canAddNewSet('epic', pick - 1)),
  };
}

/**
 * Phones: the tab a pick screen opens on: the one it was left on (coming back from the pool
 * picker), Pools for a set just chosen there, the chosen power's tab, else the first tab with
 * something to pick.
 */
function initialTab(gd: GameData, steps: Parameters<typeof currentPick>[0], level: LevelCtx): number {
  if (tabMemo && tabMemo.base === level.base && tabMemo.step === level.step && tabMemo.pick === level.pickInStep) return tabMemo.tab;
  if (level.pendingSet !== undefined) return 2;
  const rules = new BuildRules(gd, level.base);
  const pick = currentPick(steps, level);
  const options = rules.setOptions(pick);
  const own = options.find((o) => o.powers.some((p) => p.power.id === level.pendingPower));
  if (own) return own.column;
  const { open } = phoneTabState(rules, pick, options.filter((o) => o.column === 2));
  const first = open.indexOf(true);
  return first < 0 ? 0 : first;
}

/**
 * "CHOOSE A NEW POWER" (uiLevelPower.c): primary and secondary panels, a third panel for pools,
 * the epic pool and VEAT branches, the green description line, and Back/Cancel + Finish.
 *
 * In a Respec (uiReSpec.c respec_powerLevel) the same screen walks every pick first: it reads
 * "Current Respec Level", counts Powers Bought / Powers Remaining, and steps with Back / Next.
 */
export function ChooseNewPower({ skin }: { skin: Skin }) {
  const { gd, steps, level, choosePower, openSetPicker, finishLevel, backLevel, lockFlash, flashLocked } = useStore(
    useShallow((s) => ({ gd: s.gd, steps: s.steps, level: s.level, choosePower: s.choosePower, openSetPicker: s.openSetPicker, finishLevel: s.finishLevel, backLevel: s.backLevel, lockFlash: s.lockFlash, flashLocked: s.flashLocked })),
  );
  // Escape cancels a level reopened from the overview (in the wizard, Back stays a button)
  useEscape(backLevel, level?.mode === 'edit');
  useFreshHover(); // hover lives in useHover: hovering a bar redraws only the description box
  // phones: the tab shown, and whether the Pools tab blinks green (the first time pools open in a
  // build, and the first time an epic pool can be opened, unless the screen opens on Pools), both
  // decided afresh for each pick: the screen stays mounted from one pick to the next (a respec's
  // powers), and deciding the blink once per pick keeps the store flags set below from cutting it
  // short
  const pickKey = level ? `${level.step}:${level.pickInStep}:${level.mode}` : '';
  const fresh = () => {
    if (!gd || !level) return { key: pickKey, tab: 0, pools: false, epic: false };
    const tab = initialTab(gd, steps, level);
    let pools = false;
    let epic = false;
    const st = useStore.getState();
    if (level.mode === 'wizard' && tab !== 2 && !(st.poolsBlinked && st.epicBlinked)) {
      const r = new BuildRules(gd, level.base);
      const pk = currentPick(steps, level);
      const t = phoneTabState(r, pk, r.setOptions(pk).filter((o) => o.column === 2));
      pools = t.unlocked && !st.poolsBlinked;
      epic = t.epicUnlocked && !st.epicBlinked;
    }
    return { key: pickKey, tab, pools, epic };
  };
  const [ps, setPs] = useState(fresh);
  if (ps.key !== pickKey) setPs(fresh());
  const { tab } = ps;
  const blink = ps.pools || ps.epic;
  const setTab = (t: number) => {
    setPs({ ...ps, tab: t });
    if (level) tabMemo = { base: level.base, step: level.step, pick: level.pickInStep, tab: t };
  };
  const stage = useStage();
  const { phone } = stage;
  useEffect(() => {
    if (!phone) return;
    if (ps.pools) useStore.setState({ poolsBlinked: true });
    if (ps.epic) useStore.setState({ epicBlinked: true });
  }, [ps.pools, ps.epic, phone, pickKey]);
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
  const fallback = phone && level.pendingPower !== undefined ? gd.power(level.pendingPower) : null;
  const onPick = (p: Power) => {
    // reopened from the overview: a power that can't hold this pick's bought slots would leave them
    // hidden, so those slots must be removed first
    const prev = level.mode === 'edit' ? level.orig.picks[pick] : null;
    if (prev && prev.slots.length > 1 && p.id !== prev.power && (!rules.slottable(p) || prev.slots.length > (p.maxB ?? 0))) {
      flashLocked(`power:${p.id}`, 'Remove Slots First!');
      return;
    }
    choosePower(p.id === level.pendingPower ? undefined : p.id);
    // a power from a set chosen on the pool picker keeps that set shown; others drop it
  };
  const firstStep = level.step === 0 && level.pickInStep === 0;
  const lvl = stepsOf(steps, level)[level.step]?.level ?? 0;
  const respec = !!level.flow;
  // respec_powerCounter: picks still to make up to the respec level (this one included)
  const respecEnd = level.base.respecTo ?? 49;
  const remaining = level.base.picks.filter((p, i) => !p && (gd.core.schedule.power[i] ?? 99) <= respecEnd).length;
  const bought = level.base.picks.filter((p) => p).length;
  const chosen = level.pendingPower !== undefined;
  const extraButtons = (canPool ? 1 : 0) + (canEpic ? 1 : 0);
  const tabs = phoneTabState(rules, pick, extra);
  // a tab with nothing to pick is greyed out; the screen never sits on one
  const shownTab = tabs.open[tab] || tab !== 2 ? tab : Math.max(0, tabs.open.indexOf(true));
  const openPicker = (kind: 'pool' | 'epic') => {
    tabMemo = { base: level.base, step: level.step, pick: level.pickInStep, tab: 2 };
    openSetPicker(kind);
  };
  // phones: a long press shows the power's tooltip at this pick's level (with why it can't be picked)
  const onLong = (o: SetOption['powers'][number], pt: { x: number; y: number }) => pressPickTip(rules, o.power, pick, pt, o.state === 'unavailable' ? o.reason : undefined);

  // phones: the new pool / epic set bars a finger's height
  const BAR_H = phone ? 54 : vy(28);
  const pg = phoneGeom(stage);
  const counterBox = { x: (pg.w - 290) / 2, y: pg.navTop - 8 - PHONE_COUNTER_H, w: 290, h: PHONE_COUNTER_H };
  // without the client's Show Detailed Info buttons over the frame tops, the lists start 25
  // higher (the third keeps its place under the new pool / epic set bars)
  const UP = -vy(25);
  const desc = <HoverDesc skin={skin} fallback={fallback} box={phone && respec ? phoneDesc(pg, PHONE_COUNTER_H + 8) : undefined} />;
  const buttons = (
    <>
      <NextButton skin={skin} dir="left" text={level.mode === 'edit' || (firstStep && !respec) ? 'Cancel' : 'Back'} onClick={backLevel} />
      <NextButton skin={skin} dir="right" text={respec ? 'Next' : 'Finish'} locked={level.pendingPower === undefined} onClick={finishLevel} />
      {respec ? (
        <RespecCounter
          done={chosen}
          lines={chosen ? ["Click 'Next' to Continue", `Powers Remaining: ${remaining - 1}`] : [`Powers Bought: ${bought}`, `Powers Remaining: ${remaining}`]}
          {...(phone ? counterBox : {})}
        />
      ) : null}
    </>
  );
  // uiLevelPower.c: drawMenuBar centered on the third panel at y 85 (55 and 85 when both show),
  // FRAME_WIDTH wide, over the panel's top edge; the panel's contents do not move
  const newSetBars = (cx: number, y0: number, step: number, wd: number) => (
    <>
      {canPool ? <MenuBar skin={skin} x={cx} y={y0} wd={wd} sc={phone ? S * 1.2 : S} text="Choose from new pool power set" onClick={() => openPicker('pool')} /> : null}
      {canEpic ? <MenuBar skin={skin} x={cx} y={y0 + (canPool ? step : 0)} wd={wd} sc={phone ? S * 1.2 : S} text="Choose from new Epic power set" onClick={() => openPicker('epic')} /> : null}
    </>
  );
  const levelLabel = (x: number, y: number) =>
    respec && phone ? (
      <GameText font="title_12" scale={S} x={x} y={y} align="right" colors={['#ffffff', '#c0c0c0']} text={`Current Respec Level: ${lvl}`} />
    ) : respec ? (
      // uiReSpec.c respec_powerLevel: prnt(450 sx, 30 sy) in title_12, white to grey, with the
      // character's level as the game holds it (0 for level 1). The live game draws it unstretched
      // at the screen's height scale (about 300 wide at 2000, measured on an in-game screenshot)
      <GameText font="title_12" scale={SY} x={vx(450)} y={vy(30)} colors={['#ffffff', '#c0c0c0']} text={`Current Respec Level: ${lvl}`} />
    ) : (
      <GameText font="title_14" scale={S} x={x} y={y} align="right" colors={skin.heading} text={`LEVEL ${lvl + 1}`} />
    );

  if (phone) {
    const P = phonePanel(pg, 3, PHONE_DESC_H + 8 + (respec ? PHONE_COUNTER_H + 8 : 0));
    const lists = [primary, secondary, extra];
    const off = shownTab === 2 ? extraButtons * (BAR_H + 6) : 0;
    const g: ColumnGeom = { left: P.x, top: P.y + 8 + off, width: P.w, height: P.h - 16 - off, barX: P.x + P.w, headX: 20, barCX: 56, barW: P.w - 90, firstHead: vy(31) };
    return (
      <>
        <TitleBar skin={skin} text="CHOOSE A NEW POWER" />
        {levelLabel(pg.w - 12, pg.labelY)}
        <PhoneTabs skin={skin} labels={['Primary', 'Secondary', 'Pools']} active={shownTab} onChange={setTab} disabled={[false, false, !tabs.open[2]]} flash={blink ? 2 : undefined} />
        <MenuFrame x={P.x} y={P.y} w={P.w} h={P.h} skin={skin} />
        {shownTab === 2 ? newSetBars(P.x + P.w / 2, P.y + 6 + BAR_H / 2, BAR_H + 6, P.w - 12) : null}
        <PowerColumn skin={skin} g={g} sets={lists[shownTab] ?? []} pending={level.pendingPower} onPick={onPick} onHover={hoverPower} onLong={onLong} flash={lockFlash} />
        {desc}
        {buttons}
        <PhoneTipLayer gd={gd} skin={skin} at={rules.at} level={rules.pickLevel(pick)} />
      </>
    );
  }

  return (
    <>
      <TitleBar skin={skin} text="CHOOSE A NEW POWER" />
      {levelLabel(TOP_LABEL_RIGHT, vy(38))}
      {[0, 1, 2].map((i) => (
        <MenuFrame key={i} x={vx(16 + 336 * i)} y={vy(70)} w={vx(320)} h={vy(520)} skin={skin} />
      ))}
      <PowerColumn skin={skin} g={desktopColumn(0, UP)} sets={primary} pending={level.pendingPower} onPick={onPick} onHover={hoverPower} flash={lockFlash} />
      <PowerColumn skin={skin} g={desktopColumn(1, UP)} sets={secondary} pending={level.pendingPower} onPick={onPick} onHover={hoverPower} flash={lockFlash} />
      {newSetBars(vx(1024 - 16 - 160), vy(canPool && canEpic ? 55 : 85), vy(30), vx(320))}
      <PowerColumn skin={skin} g={desktopColumn(2, extraButtons ? 0 : UP)} sets={extra} pending={level.pendingPower} onPick={onPick} onHover={hoverPower} flash={lockFlash} />
      {desc}
      {buttons}
      <PickTip gd={gd} rules={rules} pick={pick} />
    </>
  );
}
