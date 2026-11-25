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
  /**
   * A property of the entity's creator (`source.owner>`, `source.creator>`), for a pseudo-pet's
   * powers, whose damage the power info totals: `arch source.owner> Class_Brute eq` reads the
   * class of the character that made it. Absent for the character's own powers, which have no
   * creator (the answer is then 0).
   */
  ownerProp?(name: string): string | number;
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
  /**
   * The target is the character itself (the totals: what lands on the character), so
   * `entref target> entref source> eq` holds; absent: the two differ (an effect on someone else).
   */
  targetIsSource?: boolean;
  /**
   * Whether the target is the named villain def (`MastermindPets_Droid target.VillainName>`: Equip
   * Robot's grants to a Battle Drone; TargetTypeMatches in the server's combat eval). Absent: 0.
   */
  targetVillain?(name: string): boolean;
  /**
   * A property of the target other than its entity type (`kRage target>`: a Grave Knight's rage
   * meter; `group target>`: a pet's villain group). Absent, or undefined for a name: 0, as before.
   */
  targetProp?(name: string): number | string | undefined;
  /**
   * Seconds since a power event (`Attacked source.EventTimeSince> 10 >`), as the totals' combat
   * state has it (combatHooks). Absent, or undefined for an event: the old answers, long ago for
   * `target.EventTimeSince>` and 0 for `source.EventTimeSince>`.
   */
  sinceEvent?(event: string): number | undefined;
  /**
   * Whether a mod's suppressions (its Suppress pairs) stop it in the combat state, given the
   * attributes it changes (combatHooks). Absent: never.
   */
  suppressed?(sup: unknown, attribs?: readonly number[]): boolean;
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
        else if (name === 'entref') st.push('source');
        else if (name.startsWith('arch') || name.startsWith('rank')) st.push(ctx.prop('archetype'));
        else st.push(ctx.prop(name));
        continue;
      }
      case 'target>': {
        const name = popStr().toLowerCase();
        if (name === 'entref') st.push(ctx.targetIsSource ? 'source' : 'target');
        else st.push(name === 'enttype' ? (ctx.targetEntType ?? 'critter') : (ctx.targetProp?.(name) ?? 0));
        continue;
      }
      case 'target.villainname>':
        st.push(ctx.targetVillain?.(popStr()) ? 1 : 0);
        continue;
      case 'source.owner>':
      case 'source.creator>':
        if (ctx.ownerProp) {
          st.push(ctx.ownerProp(popStr().toLowerCase()));
          continue;
        }
        break; // no creator: answered 0 below, as before
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
      case 'eventtimesince>': {
        const since = ctx.sinceEvent?.(popStr());
        st.push(since ?? 1e9);
        continue;
      }
      case 'source.eventtimesince>': {
        // the combat state's answer; else 0, as every unknown `>` function reads
        const since = ctx.sinceEvent?.(popStr());
        st.push(since ?? 0);
        continue;
      }
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

// First characters the client's power-info check reads as a two-operand operator (0x1404dfdd0's
// bit set 0xc000ac2000000000): % * + - / > ?
const INFO_BINARY_FIRST = new Set(['%', '*', '+', '-', '/', '>', '?']);

/**
 * The live client's power-info requirement check: whether the power info lists an effect group,
 * and whether its damage counts (requiresArchetypePvPEval in the source's uiPowerInfo.c; Homecoming
 * i28p4 0x1404dfdd0 and Thunderspy 9.6 0x1404d4cc0, called by power_AddEffects and getTotalDamage;
 * decompiled, both as the source).
 *
 * It is not the game's evaluator (evalRequires) but a cut-down stack machine that only tells the
 * caster's archetype, the creator's archetype, a critter target from a player one, and PvP maps
 * apart. Everything else reads as true: a value, a comparison, `source.ownPower?` (and the `!`
 * after it), `Source.Mode?`, `target.HasTag?`. So the game lists every Combo Level line and the
 * "Only if hidden" lines, and leaves out what another archetype or PvP gets.
 *
 * 1. `arch source> X` pushes whether the caster's class is X, `arch source.owner> X` (or
 *    `source.creator>`) whether the creator's is, any other `arch` 1; then 1. Three tokens.
 * 2. `enttype target> X` pushes whether X is "critter" (PvE), any other `enttype` 1; then 1.
 * 3. `isPVPMap?` pushes 0 in PvE.
 * 4. `source.ownPower?` / `target.ownPower?` replace their operand with 1 and swallow a `!` after.
 * 5. A token ending in `>` replaces its operand with 1; `<`, `<=`, `>=`, a token starting with one
 *    of % * + - / > ? or ending in `?` pops two and pushes 1; `minmax` pops three and pushes 1.
 * 6. `&&`, `||`, `!`, `eq` and `==` work on the 0/1 values; any other token pushes 1.
 * 7. A pop from an empty stack reads 0; the answer is the bottom of the stack.
 *
 * @param tokens One group's requirement tokens.
 * @param cls The caster's class (Class_Stalker; the pet's for a pet's power).
 * @param owner The creator's class for a pet's power, else null.
 * @param pvp Whether PvP effects are shown (the planner shows PvE).
 * @return Whether the client counts the requirement as met.
 */
export function infoRequires(tokens: readonly string[], cls: string, owner: string | null, pvp = false): boolean {
  const st: number[] = [];
  const pop = (): number => (st.length ? st.pop()! : 0);
  const is = (a: string | undefined, b: string | null): boolean => a !== undefined && b !== null && a.toLowerCase() === b.toLowerCase();
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i]!;
    const lt = t.toLowerCase();
    if (lt === 'arch') {
      const who = tokens[i + 1]?.toLowerCase();
      if (who === 'source>') st.push(is(tokens[i + 2], cls) ? 1 : 0);
      else if (who === 'source.owner>' || who === 'source.creator>') st.push(is(tokens[i + 2], owner) ? 1 : 0);
      else st.push(1);
      st.push(1);
      i += 3;
    } else if (lt === 'source.ownpower?' || lt === 'target.ownpower?') {
      pop();
      st.push(1);
      if (i < tokens.length - 1 && tokens[i + 1] === '!') i++;
      i++;
    } else if (lt === 'enttype') {
      st.push(tokens[i + 1]?.toLowerCase() === 'target>' ? (is(tokens[i + 2], pvp ? 'player' : 'critter') ? 1 : 0) : 1);
      st.push(1);
      i += 3;
    } else if (lt === 'ispvpmap?') {
      st.push(pvp ? 1 : 0);
      i++;
    } else {
      if (t.length > 1 && t.endsWith('>')) {
        pop();
      } else if (t === '<' || t === '<=' || t === '>=' || INFO_BINARY_FIRST.has(t[0] ?? '') || t.endsWith('?')) {
        pop();
        pop();
      } else if (t === '&&' || t === '||') {
        const a = pop();
        const b = pop();
        st.push(t === '&&' ? (a && b ? 1 : 0) : a || b ? 1 : 0);
        i++;
        continue;
      } else if (t === '!') {
        st.push(pop() ? 0 : 1);
        i++;
        continue;
      } else if (lt === 'eq' || t === '==') {
        st.push(pop() === pop() ? 1 : 0);
        i++;
        continue;
      } else if (lt === 'minmax') {
        pop();
        pop();
        pop();
      }
      st.push(1);
      i++;
    }
  }
  return (st[0] ?? 0) !== 0;
}
