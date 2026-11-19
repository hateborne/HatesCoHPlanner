import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useStore, type DialogLink } from '../../state/store.ts';
import { useEscape } from '../escape.ts';
import { SKINS } from '../skin/skin.ts';
import { skinOf } from '../../engine/build.ts';
import { CheckBar } from './CheckBar.tsx';
import { MenuFrame, SetTitle } from './Chrome.tsx';
import { TitleText } from './GameText.tsx';
import { GameScroll } from './GameScroll.tsx';
import { SELECT } from './OriginAlign.tsx';
import { useStage } from './Stage.tsx';
import { POPUP_LAYER } from '../floating.ts';

/**
 * The planner's confirmation dialog (replacing a build, an origin change that removes
 * enhancements): a framed panel centred on the stage with the question and Proceed / Cancel.
 * A question with a list (the changes a patch move makes) gets a taller panel and the list in a
 * scrolling box under the text. A question with choices (askChoices: a build.txt import's
 * alignment and build type) gets a row of check bars per choice under the text; an option that
 * can't be picked is greyed, with its reason under the row. A message (tell: an import that failed or
 * left gaps) has one OK button; a countdown message (tell's `wait`: a build whose power sets can't
 * go together) shows the seconds left on it, greyed, until it unlocks. A question with two ways
 * forward (askThreeWay: start a new build or open the remembered one) has a third button between
 * them and Cancel.
 * Escape cancels (a countdown message: once OK unlocks), and Cancel starts with the keyboard focus;
 * clicking outside does nothing, so a stray click can't decide for you. It sits above the Build menu's overlay (100), which asks some of these
 * questions.
 */
/**
 * The dialog's text with its link's phrase (the first time it appears) as a link opening in a new
 * tab. Only an https address is linked.
 *
 * @param text The text.
 * @param link The phrase and its address, if any.
 * @return The text, with the link in place.
 */
function linked(text: string, link: DialogLink | undefined): ReactNode {
  const at = link && /^https:\/\//.test(link.href) ? text.indexOf(link.phrase) : -1;
  if (!link || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a className="support-link" href={link.href} target="_blank" rel="noopener noreferrer">
        {link.phrase}
      </a>
      {text.slice(at + link.phrase.length)}
    </>
  );
}

/**
 * The dialog's text with some phrases (power names) in the game's heading yellow to orange.
 *
 * @param text The text.
 * @param phrases The phrases to colour, wherever they appear.
 * @return The text, with the phrases coloured.
 */
function highlighted(text: string, phrases: string[] | undefined): ReactNode {
  const want = (phrases ?? []).filter((p) => p.length > 0);
  if (!want.length) return text;
  const esc = want.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const parts = text.split(new RegExp(`(${esc.join('|')})`));
  return parts.map((part, i) => (i % 2 === 1 ? <span key={i} style={HIGHLIGHT}>{part}</span> : part));
}

// the game's set-heading colours (skin heading: yellow to orange), on body text
const HIGHLIGHT = { background: 'linear-gradient(#ffff00, #ffa500)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', fontWeight: 'bold' } as const;

/** @return The dialog's top edge: centred on a stage of height `stageH`. */
function y0(stageH: number, h: number): number {
  return (stageH - h) / 2;
}

export function ConfirmDialog() {
  const { confirm, closeConfirm, setConfirmChoice, build } = useStore();
  const stage = useStage();
  useEscape(() => closeConfirm(false), !!confirm); // closeConfirm waits out a countdown
  // a countdown message: redrawn while OK is locked, its seconds left on the button
  const until = confirm?.waitUntil;
  const [, tick] = useState(0);
  useEffect(() => {
    if (until === undefined) return;
    const t = window.setInterval(() => {
      tick((n) => n + 1);
      if (performance.now() >= until) window.clearInterval(t);
    }, 200);
    return () => window.clearInterval(t);
  }, [until]);
  const left = until === undefined ? 0 : Math.max(0, Math.ceil((until - performance.now()) / 1000));
  // OK keeps the focus while greyed (aria-disabled, not disabled: closeConfirm refuses the press), so
  // Enter can't reach a button behind the dialog; it takes the focus again once it unlocks
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (until !== undefined && left === 0) okRef.current?.focus();
  }, [until, left]);
  if (!confirm) return null;
  const { phone } = stage;
  const skin = SKINS[build ? skinOf(build.alignment) : 'hero'];
  const sections = confirm.sections?.length ? confirm.sections : undefined;
  const list = confirm.lines?.length ? confirm.lines : undefined;
  const choices = confirm.choices?.length ? confirm.choices : undefined;
  // a choice row: its heading, the bars, then (when an option is blocked) the reason
  const rowH = (c: NonNullable<typeof choices>[number]) => (phone ? 112 : 104) + (c.options.some((o) => o.block) ? (phone ? 84 : 52) : 0);
  const choicesTop = phone ? 76 + 170 : 90 + 110; // under the text (estimated at ~3 lines)
  const choicesH = choices ? choices.reduce((n, c) => n + rowH(c), 0) : 0;
  const w = phone ? stage.w - 24 : list || sections || choices ? 900 : 760;
  const h = list || sections ? (phone ? Math.min(stage.h - 60, 760) : 620) : choices ? choicesTop + choicesH + (phone ? 100 : 90) : phone ? 400 : 330;
  // the list box: under the text (estimated at ~3 lines), above the buttons
  const listTop = y0(stage.h, h) + (phone ? 76 : 90) + (phone ? 150 : 104);
  const listBottom = y0(stage.h, h) + h - (phone ? 100 : 90);
  const x = (stage.w - w) / 2;
  const y = (stage.h - h) / 2;
  // askThreeWay's three buttons share the row
  const btnW = Math.min(170, confirm.altLabel !== undefined && !confirm.alert ? (w - 96) / 3 : (w - 72) / 2);
  const pad = phone ? 24 : 40;
  const rows: ReactElement[] = [];
  let top = y + choicesTop;
  choices?.forEach((c, r) => {
    const cell = (w - 2 * pad) / c.options.length;
    const barY = top + (phone ? 62 : 56);
    rows.push(
      <TitleText key={`h${r}`} style={{ position: 'absolute', left: x + pad, top, fontSize: 20 }}>
        {c.label.toUpperCase()}
      </TitleText>,
    );
    c.options.forEach((o, i) =>
      rows.push(
        <CheckBar
          key={`${r}:${o.id}`}
          testId={`choice:${r}:${o.id}`}
          skin={skin}
          x={x + pad + i * cell + 22}
          y={barY}
          wd={cell - 34}
          text={o.label}
          state={o.block !== undefined ? 'unselectable' : o.id === c.value ? 'selected' : 'standard'}
          down={o.id === c.value}
          clickSounds={SELECT}
          hoverSounds
          onClick={o.block !== undefined ? undefined : () => setConfirmChoice(r, o.id)}
          title={o.block}
        />,
      ),
    );
    const blocked = c.options.filter((o) => o.block);
    if (blocked.length) {
      rows.push(
        <div key={`b${r}`} className="abs body-text" style={{ left: x + pad, top: barY + (phone ? 34 : 28), width: w - 2 * pad, fontSize: 17, lineHeight: 1.3, color: '#8fa1b8', whiteSpace: 'pre-line' }}>
          {blocked.map((o) => `${o.label}: ${o.block}`).join('\n')}
        </div>,
      );
    }
    top += rowH(c);
  });
  return (
    <div {...POPUP_LAYER} className="abs" style={{ left: 0, top: 0, width: stage.w, height: stage.h, zIndex: 105, background: 'rgba(0,0,0,0.55)' }}>
      <MenuFrame x={x} y={y} w={w} h={h} r25 skin={skin} style={{ background: skin.panel }} />
      <SetTitle skin={skin} x={x + (phone ? 22 : 36)} y={y + 26} size={phone ? 26 : 28} text={confirm.title} />
      <div className="abs body-text" style={{ left: x + (phone ? 24 : 40), top: y + (phone ? 76 : 90), width: w - (phone ? 48 : 80), fontSize: 19, lineHeight: 1.35, color: '#cfe8ff', whiteSpace: 'pre-line' }}>
        {confirm.link ? linked(confirm.text, confirm.link) : highlighted(confirm.text, confirm.highlight)}
      </div>
      {list ? (
        <GameScroll skin={skin} left={x + pad} top={listTop} width={w - 2 * pad - 14} height={listBottom - listTop} barX={x + w - pad / 2}>
          <div className="body-text" style={{ fontSize: 18, lineHeight: 1.4, color: '#e8f4ff' }}>
            {list.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </GameScroll>
      ) : null}
      {sections ? (
        <GameScroll skin={skin} left={x + pad} top={listTop} width={w - 2 * pad - 14} height={listBottom - listTop} barX={x + w - pad / 2}>
          <div className="body-text" style={{ fontSize: 18, lineHeight: 1.4, color: '#e8f4ff' }}>
            {sections.map((sec, i) => (
              <div key={i} style={{ marginTop: i ? 14 : 0 }}>
                {sec.heading ? <div style={{ color: '#cfe8ff', fontSize: 19 }}>{sec.heading}</div> : null}
                {sec.lines.map((l, k) => (
                  <div key={k} style={{ paddingLeft: 18, textIndent: -14 }}>
                    {`* ${l}`}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </GameScroll>
      ) : null}
      {rows}
      <div className="abs" style={{ left: x, top: y + h - (phone ? 84 : 72), width: w, display: 'flex', justifyContent: 'center', gap: 24 }}>
        <button ref={okRef} className="info-button" style={{ position: 'static', width: btnW, padding: 0 }} onClick={() => closeConfirm(true)} aria-disabled={left > 0 || undefined} autoFocus={confirm.alert}>
          {left > 0 ? String(left) : (confirm.okLabel ?? 'Proceed')}
        </button>
        {confirm.alert || confirm.altLabel === undefined ? null : (
          <button className="info-button" style={{ position: 'static', width: btnW, padding: 0 }} onClick={() => closeConfirm('alt')}>
            {confirm.altLabel}
          </button>
        )}
        {confirm.alert ? null : (
          <button className="info-button" style={{ position: 'static', width: btnW, padding: 0 }} onClick={() => closeConfirm(false)} autoFocus>
            {confirm.cancelLabel ?? 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}
