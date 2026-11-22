import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { GameData } from '../../data/gamedata.ts';
import { boostPog, enhLevelLabel, setRarity, type SetRarity } from '../../engine/enhance.ts';
import { shoppingList, type ShopItem, type ShoppingList, type ShopRow, type ShopSet } from '../../engine/finder/shopping.ts';
import { shopItems, useFinder } from '../../state/finder.ts';
import { CheckBar } from '../components/CheckBar.tsx';
import { SlotRing } from '../components/Chrome.tsx';
import { TitleText } from '../components/GameText.tsx';
import { rarityStyle } from '../components/PowerTip.tsx';
import { pressText } from '../hover.ts';
import { icon, type Skin } from '../skin/skin.ts';
import { EnhIcon } from './EnhancementPicker.tsx';

const TEXT = '#cfe8ff';
const MUTED = '#8fa1b8';
// the game's last level (0-based): a crafted piece's level number is drawn as it is there
const LAST_LEVEL = 49;
// recipe and salvage rarity -> the colour its set rarity is written in (1, common, stays white)
const RARITY_KIND: Record<number, SetRarity['kind']> = { 2: 'uncommon', 3: 'rare', 4: 'veryRare' };

const NO_ITEMS: ShopItem[] = [];

/** Where this game version's recipes stand: in, on their way, none on the site, or a download that failed. */
export type RecipesState = 'ready' | 'loading' | 'missing' | 'failed';

/**
 * The shopping list as the finder's state has it now.
 *
 * The stored list and the recipes are used only when they are this game data's: for the moment
 * after another build opens, the store still holds the last server's list and the last version's
 * recipes.
 *
 * @param gd Game data.
 * @return The sets, the rows still needed and the auction house search lines; where this game version's recipes stand.
 */
export function useShoppingList(gd: GameData): { list: ShoppingList; recipes: RecipesState } {
  const { shop, shopFor, kept, shopOwned, settled, recipes, recipesFor, missing, failed } = useFinder(
    useShallow((s) => ({
      shop: s.shop,
      shopFor: s.shopFor,
      kept: s.kept,
      shopOwned: s.shopOwned,
      settled: s.settled,
      recipes: s.recipes,
      recipesFor: s.recipesFor,
      missing: s.recipesMissing,
      failed: s.recipesFailed,
    })),
  );
  const version = gd.core.manifest.dataVersion;
  const mine = shopFor === gd.server ? shop : NO_ITEMS;
  const fit = recipes && recipes.dataVersion === version ? recipes : null;
  const items = useMemo(() => shopItems({ shop: mine, kept, shopOwned, settled }), [mine, kept, shopOwned, settled]);
  const list = useMemo(() => shoppingList(gd, fit, items), [gd, fit, items]);
  // not asked for yet (the list has only just shown, or another version's are held) reads as on their way
  const state: RecipesState = fit ? 'ready' : recipesFor === version && missing ? 'missing' : failed === version ? 'failed' : 'loading';
  return { list, recipes: state };
}

/**
 * One set on the list, drawn like a power on the build overview: a bar with the set's name, then
 * its pieces. Clicking the bar marks every piece owned (or none, when all are); clicking a piece
 * marks that one. An owned piece is greyed out. Phones have no hover text: a long press names a
 * piece and says what a tap does.
 */
const SetBar = memo(function SetBar({ gd, skin, group, phone, width }: { gd: GameData; skin: Skin; group: ShopSet; phone: boolean; width: number }) {
  const setOwned = useFinder((s) => s.setOwned);
  const all = group.pieces.every((p) => p.item.owned);
  const scale = phone ? 1.3 : 1.2;
  const barH = Math.round(38 * scale) + 10;
  const ring = phone ? 50 : 46;
  const step = ring + 6;
  const barX = Math.round(22 * scale) + 4; // the check box's center
  const barW = phone ? width - barX - 12 : 400;
  const ringsX = phone ? 4 : barX + barW + 26;
  const ringsY = phone ? barH : (barH - step) / 2;
  const perRow = Math.max(1, Math.floor((width - ringsX) / step));
  // what a hint calls a press of the bar or of a piece
  const press = phone ? 'tap' : 'click';
  const barHint = all ? `You have all of these: ${press} to mark them as still needed` : `${phone ? 'Tap' : 'Click'} to mark every piece as owned`;
  const rows = Math.ceil(group.pieces.length / perRow);
  const height = (phone ? barH + rows * step : Math.max(barH, ringsY + rows * step)) + 8;
  return (
    <div data-testid={`shop:set:${group.set.id}`} style={{ position: 'relative', height }}>
      <CheckBar
        testId={`shop:bar:${group.set.id}`}
        skin={skin}
        x={barX}
        y={barH / 2}
        wd={barW}
        scale={scale}
        text={group.set.dn}
        state="standard"
        down={all}
        title={barHint}
        onLongPress={phone ? pressText(barHint) : undefined}
        onClick={() => setOwned(group.pieces.map((p) => p.index), /*owned=*/ !all)}
      />
      {group.pieces.map((p, i) => {
        const hint = `${p.boost.dn} (${p.item.owned ? `owned: ${press} to mark it as still needed` : `${press} to mark it as owned`})`;
        return (
          // a box of no size around the ring, to grey out an owned piece without moving it
          <div key={p.index} className="abs" style={{ left: 0, top: 0, width: 0, height: 0, opacity: p.item.owned ? 0.35 : 1, filter: p.item.owned ? 'grayscale(1)' : undefined }}>
            <SlotRing
              testId={`shop:piece:${p.index}`}
              skin={skin}
              x={ringsX + (i % perRow) * step + step / 2}
              y={ringsY + Math.floor(i / perRow) * step + step / 2}
              size={ring}
              enhIcon={icon('enh', p.boost.icon)}
              frames={p.boost.bf}
              pog={boostPog(gd, p.boost)}
              level={enhLevelLabel(gd, p.boost, { boost: p.boost.id, ioLevel: p.item.level ?? undefined }, LAST_LEVEL)}
              title={hint}
              onLongPress={phone ? pressText(hint) : undefined}
              onClick={() => setOwned([p.index], /*owned=*/ !p.item.owned)}
            />
          </div>
        );
      })}
    </div>
  );
}, sameBar);

/**
 * Whether a set's bar would draw the same: the list is put together anew on every change, so its
 * groups are new objects each time, and a mark on one piece would otherwise draw every bar (up to
 * 600 rings) again.
 *
 * @param a The bar's last props.
 * @param b Its next props.
 * @return True when nothing it draws from differs.
 */
function sameBar(a: { gd: GameData; skin: Skin; group: ShopSet; phone: boolean; width: number }, b: { gd: GameData; skin: Skin; group: ShopSet; phone: boolean; width: number }): boolean {
  if (a.gd !== b.gd || a.skin !== b.skin || a.phone !== b.phone || a.width !== b.width) return false;
  const x = a.group;
  const y = b.group;
  if (x.set !== y.set || x.pieces.length !== y.pieces.length) return false;
  return x.pieces.every((p, i) => {
    const q = y.pieces[i]!;
    return p.index === q.index && p.boost === q.boost && p.item.owned === q.item.owned && p.item.level === q.item.level;
  });
}

/** The sets on the list, one bar each. */
export function ShopSets({ gd, skin, list, phone, width }: { gd: GameData; skin: Skin; list: ShoppingList; phone: boolean; width: number }) {
  if (!list.sets.length) {
    return (
      <div className="desc-text" data-testid="shop:empty">
        Nothing is on the shopping list. The pieces of the swaps you keep show here, and stay once those swaps are applied.
      </div>
    );
  }
  return (
    <div data-testid="shop:sets">
      {list.sets.map((g) => (
        <SetBar key={g.set.id} gd={gd} skin={skin} group={g} phone={phone} width={width} />
      ))}
      {list.unknown ? (
        <div className="body-text" style={{ color: MUTED, fontSize: phone ? 16 : 13 }}>
          {list.unknown} {list.unknown === 1 ? 'item is' : 'items are'} not shown: this game version has no such set piece.
        </div>
      ) : null}
    </div>
  );
}

/**
 * One thing to get: its icon, how many and its name in its rarity's colour.
 *
 * @param props.recipe The row is a recipe: its set's round icon alone, without the frame a crafted enhancement has.
 */
function NeedRow({ gd, row, phone, recipe }: { gd: GameData; row: ShopRow; phone: boolean; recipe: boolean }) {
  const size = phone ? 36 : 30;
  // a recipe or a salvage item has its own rarity; an enhancement to buy has its set's
  const set = row.boost ? gd.boostSetOf.get(row.boost.id)?.set : undefined;
  const kind = RARITY_KIND[row.rarity];
  const colour = kind ? rarityStyle({ kind, name: '' }) : row.rarity ? { color: '#fff' } : { color: '#fff', ...rarityStyle(set ? setRarity(set) : undefined) };
  return (
    <div data-testid={`shop:row:${row.key}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: size + 4 }}>
      <div style={{ width: size, height: size, flexShrink: 0 }}>
        {row.boost && recipe ? (
          <img src={icon('enh', row.boost.icon)} width={size} height={size} alt="" />
        ) : row.boost ? (
          <EnhIcon gd={gd} b={row.boost} size={size} />
        ) : row.icon ? (
          <img src={icon('salvage', row.icon)} width={size} height={size} alt="" />
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <span style={{ color: '#fff' }}>{row.count}x</span> <span style={colour}>{row.name}</span>
        {row.level !== undefined ? <span style={{ color: MUTED }}> level {row.level}</span> : null}
      </div>
    </div>
  );
}

/** A line to paste into the auction house's search, with the button that copies it. */
function SearchLine({ line, testId }: { line: string; testId: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  const copy = () => {
    // no clipboard (an old browser, a page without permission): the line can still be selected by hand
    if (!navigator.clipboard) return setState('failed');
    navigator.clipboard.writeText(line).then(
      () => setState('copied'),
      () => setState('failed'),
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div data-testid={testId} style={{ flex: 1, minWidth: 0, userSelect: 'text', overflowWrap: 'anywhere', border: '1px solid #35507a', borderRadius: 8, padding: '4px 8px', color: '#fff', background: 'rgba(0,0,0,0.35)' }}>
        {line}
      </div>
      <button className="info-button" data-testid={`${testId}:copy`} aria-label={`Copy this search: ${line}`} style={{ position: 'static', flexShrink: 0, width: 96 }} onClick={copy}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy'}
      </button>
    </div>
  );
}

/**
 * What is still needed: recipes, their salvage added up, and enhancements no recipe makes; then,
 * on desktop, the same as search lines for the auction house (a phone can't paste into the game).
 *
 * @param props.recipes Where this game version's recipes stand (useShoppingList).
 */
export function ShopNeeds({ gd, list, phone, recipes }: { gd: GameData; list: ShoppingList; phone: boolean; recipes: RecipesState }) {
  const text: CSSProperties = { fontSize: phone ? 19 : 16, color: TEXT };
  const small: CSSProperties = { fontSize: phone ? 16 : 13, color: MUTED };
  const head = (t: string, first = false) => <TitleText style={{ fontSize: 18, marginTop: first ? 0 : 14, marginBottom: 4 }}>{t}</TitleText>;
  if (!list.sets.length) return null;
  if (recipes === 'loading') return <div className="desc-text">Loading the recipes...</div>;
  const rows = (title: string, id: string, items: ShopRow[], first: boolean): ReactNode =>
    items.length ? (
      <div data-testid={`shop:${id}`}>
        {head(title, first)}
        {items.map((r) => (
          <NeedRow key={r.key} gd={gd} row={r} phone={phone} recipe={id === 'recipes'} />
        ))}
      </div>
    ) : null;
  const lines = (title: string, id: string, items: string[]): ReactNode =>
    items.length ? (
      <div>
        <div style={{ ...small, margin: '6px 0 2px' }}>{title}</div>
        {items.map((l, i) => (
          <SearchLine key={`${i}:${l}`} line={l} testId={`shop:line:${id}:${i}`} />
        ))}
      </div>
    ) : null;
  const nothing = !list.recipes.length && !list.buy.length;
  return (
    <div className="body-text" style={text}>
      {recipes === 'ready' ? null : (
        <div data-testid="shop:norecipes" style={{ ...small, marginBottom: 8 }}>
          {recipes === 'missing' ? 'This game version has no recipe list' : "The recipes couldn't be loaded"}, so every piece is listed as an enhancement.
        </div>
      )}
      {nothing ? <div data-testid="shop:done">You have everything on the list.</div> : null}
      {rows('Recipes', 'recipes', list.recipes, /*first=*/ true)}
      {rows('Salvage', 'salvage', list.salvage, /*first=*/ false)}
      {rows('Enhancements', 'buy', list.buy, /*first=*/ !list.recipes.length)}
      {nothing || phone ? null : (
        <div data-testid="shop:lines">
          {head('Auction house searches')}
          {lines('Recipes', 'recipes', list.lines.recipes)}
          {lines('Salvage', 'salvage', list.lines.salvage)}
          {lines('Enhancements', 'buy', list.lines.buy)}
        </div>
      )}
    </div>
  );
}
