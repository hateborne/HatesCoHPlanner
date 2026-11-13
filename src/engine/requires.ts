/**
 * Port of the game's postfix requirement evaluator (eval.c + character_eval.c) for the subset
 * of tokens that appear in player power data. See docs/game-rules.md.
 *
 * Values on the stack are numbers or strings. Whenever a number is needed and the top is a
 * string, the string is converted by "does the character own this power / powerset?", exactly as
 * the engine's num> hook does, so a bare power full name means "owns it".
 */

/** What the evaluator may ask about the character being evaluated. */
export interface EvalContext {
  /** @return Whether the character owns this power (full name, case-insensitive). */
  ownsPower(name: string): boolean;
  /** @return Whether the character owns this powerset (Category.Set, case-insensitive). */
  ownsSet(name: string): boolean;
  /**
   * How many owned powers a name covers (ownPowerNum?): 1 or 0 for a power full name, the owned
   * powers of a set (Category.Set) or of a whole category (Homecoming's epic gates use
   * `Epic ownPowerNum? 0 >`: owns at least one power from an epic pool).
   */
  ownsPowerNum?(name: string): number;
  /** @return A character property: archetype, origin, level (1-based), alignment, type. */
  prop(name: string): string | number;
  /** @return Whether the character has earned this badge or accolade (`Owned?`); none when absent. */
  hasBadge?(name: string): boolean;
  /**
   * Whether the character is in a power mode (`kDefensiveAdaptation Source.Mode?`), i.e. a
   * running power sets it with SetMode. The name arrives with the data's `k` prefix.
   */
  inMode?(name: string): boolean;
  /**
   * @return How many of the named enhancement (short name, "Crafted_Aegis_F") the whole character
   *   has slotted: `BoostsSlotted>` (chareval_EntityBoostsSlotted walks every power).
   */
  boostsSlotted?(name: string): number;
  /** @return How many of the named enhancement are slotted in the power being evaluated: `PowerBoostsSlotted>`. */
  powerBoostsSlotted?(name: string): number;
  /** Entity type of the target for effect requires ('critter' in PvE). */
  targetEntType?: string;
}

type Val = number | string;

const LITERAL_INT = /^[+-]?\d+$/;
const LITERAL_FLOAT = /^[+-]?(\d+\.\d*|\.\d+|\d+\.)([eE][+-]?\d+)?$/;

/**
 * Evaluate a requirement token array.
 *
 * @param tokens Postfix tokens from the data (BuyRequires, SetBuyRequires, effect Requires, ...).
 * @param ctx Character context.
 * @return True when the expression's final value is non-zero. An empty array is true.
 */
export function evalRequires(tokens: readonly string[] | undefined, ctx: EvalContext): boolean {
  if (!tokens || tokens.length === 0) return true;
  return evalValue(tokens, ctx) !== 0;
}

/**
 * Evaluate to the final numeric value (strings converted by ownership).
 *
 * @param tokens Postfix tokens.
 * @param ctx Character context.
 * @return The top of the stack as a number (0 for an empty stack).
 */
export function evalValue(tokens: readonly string[], ctx: EvalContext): number {
  const st: Val[] = [];

  const owns = (s: string): number => (ctx.ownsPower(s) || ctx.ownsSet(s) ? 1 : 0);
  const toNum = (v: Val | undefined): number => {
    if (v === undefined) return 0;
    if (typeof v === 'number') return v;
    return owns(v);
  };
  const popNum = (): number => toNum(st.pop());
  const popRaw = (): Val => st.pop() ?? 0;
  const popStr = (): string => {
    const v = st.pop();
    return v === undefined ? '' : String(v);
  };

  for (const raw of tokens) {
    const tok = raw.trim();
    if (tok === '') continue;
    switch (tok) {
      case '&&': {
        const b = popNum();
        const a = popNum();
        st.push(a && b ? 1 : 0);
        continue;
      }
      case '||': {
        const b = popNum();
        const a = popNum();
        st.push(a || b ? 1 : 0);
        continue;
      }
      case '!':
        st.push(popNum() ? 0 : 1);
        continue;
      case '>':
      case '<':
      case '>=':
      case '<=': {
        const b = popNum();
        const a = popNum();
        const r = tok === '>' ? a > b : tok === '<' ? a < b : tok === '>=' ? a >= b : a <= b;
        st.push(r ? 1 : 0);
        continue;
      }
      case '==': {
        const b = popRaw();
        const a = popRaw();
        if (typeof a === 'string' && typeof b === 'string') {
          st.push(a.toLowerCase() === b.toLowerCase() ? 1 : 0);
        } else {
          st.push(toNum(a) === toNum(b) ? 1 : 0);
        }
        continue;
      }
      case 'eq': {
        const b = popRaw();
        const a = popRaw();
        st.push(typeof a === 'string' && typeof b === 'string' && a === b ? 1 : 0);
        continue;
      }
      case '+':
      case '-':
      case '*':
      case '/':
      case '%': {
        const b = popNum();
        const a = popNum();
        let r = 0;
        if (tok === '+') r = a + b;
        else if (tok === '-') r = a - b;
        else if (tok === '*') r = a * b;
        else if (tok === '/') r = b === 0 ? 0 : a / b;
        else r = b === 0 ? 0 : Math.trunc(a) % Math.trunc(b);
        st.push(r);
        continue;
      }
      default:
        break;
    }

    if (tok.startsWith('@')) {
      st.push(tok.slice(1));
      continue;
    }
    if (tok.startsWith('$')) {
      st.push(ctx.prop(tok.slice(1).toLowerCase()));
      continue;
    }

    const fn = tok.toLowerCase();
    switch (fn) {
      case 'pow': {
        const b = popNum();
        const a = popNum();
        st.push(Math.pow(a, b));
        continue;
      }
      case 'negate':
        st.push(-popNum());
        continue;
      case 'minmax': {
        const hi = popNum();
        const lo = popNum();
        const v = popNum();
        st.push(Math.min(hi, Math.max(lo, v)));
        continue;
      }
      case 'dup': {
        const v = st[st.length - 1];
        st.push(v ?? 0);
        continue;
      }
      case 'drop':
      case 'forget':
        st.pop();
        continue;
      case 'powerset?':
        st.push(ctx.ownsSet(popStr()) ? 1 : 0);
        continue;
      case 'owned?':
        st.push(ctx.hasBadge?.(popStr()) ? 1 : 0);
        continue;
      case 'ownpower?':
      case 'source.ownpower?':
      case 'enabledpower?':
        st.push(ctx.ownsPower(popStr()) ? 1 : 0);
        continue;
      case 'ownpowernum?': {
        const name = popStr();
        st.push(ctx.ownsPowerNum ? ctx.ownsPowerNum(name) : ctx.ownsPower(name) ? 1 : 0);
        continue;
      }
      case 'char>':
      case 'auto>':
      case 'ent>':
      case 'source>':
      case 'owner>': {
        const name = popStr().toLowerCase();
        if (name === 'enttype') st.push('player');
        else if (name.startsWith('arch') || name.startsWith('rank')) st.push(ctx.prop('archetype'));
        else st.push(ctx.prop(name));
        continue;
      }
      case 'target>': {
        const name = popStr().toLowerCase();
        st.push(name === 'enttype' ? (ctx.targetEntType ?? 'critter') : 0);
        continue;
      }
      case 'mode?':
      case 'source.mode?':
      case 'target.mode?':
        st.push(ctx.inMode?.(popStr()) ? 1 : 0);
        continue;
      case 'powerboostsslotted>': {
        const name = popStr();
        st.push(ctx.powerBoostsSlotted?.(name) ?? 0);
        continue;
      }
      case 'boostsslotted>': {
        const name = popStr();
        st.push(ctx.boostsSlotted?.(name) ?? 0);
        continue;
      }
      case 'target.eventtimesince>':
      case 'eventtimesince>':
        popRaw();
        st.push(1e9);
        continue;
      case 'isvip?':
      case 'loyaltynodesbought>':
      case 'loyaltypointsearned>':
      case 'badgecount':
      case 'now':
        st.push(0);
        continue;
      default:
        break;
    }
    // Any other `name?` / `name>` function is account, badge, mode, tag or world state that a
    // planner cannot know: consume its argument and answer 0.
    if (fn.endsWith('?') || fn.endsWith('>')) {
      popRaw();
      st.push(0);
      continue;
    }
    if (LITERAL_INT.test(tok)) {
      st.push(parseInt(tok, 10));
      continue;
    }
    if (tok.includes('.') && LITERAL_FLOAT.test(tok)) {
      st.push(parseFloat(tok));
      continue;
    }
    st.push(tok);
  }
  return toNum(st[st.length - 1]);
}
