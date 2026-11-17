/**
 * What the player asks the set finder for: goals with an importance each, which kinds of sets to
 * look at, and the bonuses wanted.
 */

/** How much a goal counts. */
export type Importance = 'low' | 'medium' | 'high' | 'critical';

// what each importance multiplies a goal's worth by: Critical is four times High
// UNCONFIRMED: the owner asked for Critical at 3 to 5 times High; the other steps are a default
export const IMPORTANCE: Record<Importance, number> = { low: 0.5, medium: 1, high: 2, critical: 8 };

/** The goals a search can name. */
export type GoalId =
  | 'defense'
  | 'resistance'
  | 'recharge'
  | 'stDamage'
  | 'aoeDamage'
  | 'balancedDamage'
  | 'sustain'
  | 'endurance'
  | 'accuracy'
  | 'control'
  | 'status'
  | 'movement';

/** The goals in the order the search form lists them, with their names. */
export const GOALS: { id: GoalId; name: string }[] = [
  { id: 'defense', name: 'Defense' },
  { id: 'resistance', name: 'Resistance' },
  { id: 'recharge', name: 'Recharge' },
  { id: 'stDamage', name: 'Single-target damage' },
  { id: 'aoeDamage', name: 'Area damage' },
  { id: 'balancedDamage', name: 'Balanced damage' },
  { id: 'sustain', name: 'Sustain' },
  { id: 'endurance', name: 'Endurance' },
  { id: 'accuracy', name: 'Accuracy and To-Hit' },
  { id: 'control', name: 'Control' },
  { id: 'status', name: 'Status and debuff resistance' },
  { id: 'movement', name: 'Movement' },
];

/** How many pieces of a set the wanted bonus may take: 2 or 3, 4 to 6, or any number. */
export type Depth = '2-3' | '4-6' | 'any';

/** Kinds of sets a search adds to the uncommon and rare ones it always looks at. */
export type SetTag = 'pvp' | 'seasonal' | 'purple' | 'archetype';

/** One goal of a search. */
export interface GoalPick {
  goal: GoalId; // which goal
  importance: Importance; // how much it counts
}

/** A search. */
export interface FinderQuery {
  goals: GoalPick[]; // 1 to MAX_GOALS, each goal once
  tags: SetTag[]; // kinds of sets beyond uncommon and rare
  main?: { stat: string; depth: Depth }; // a bonus every result must add (a totals line key: 'rech', 'def.03')
  extra: string[]; // up to MAX_EXTRA more bonuses, which only order the results
  groups?: string[]; // set categories to keep to ("Ranged Damage", "Defense Sets"); absent: every category
  attuned?: boolean; // place attuned pieces instead of crafted ones at the highest usable level
}

export const MAX_GOALS = 3;
export const MAX_EXTRA = 2;

/**
 * Why a search can't run, if it can't.
 *
 * @param q The search.
 * @return Null when it can run, else a sentence for the player.
 */
export function queryProblem(q: FinderQuery): string | null {
  if (q.goals.length < 1) return 'Pick at least one priority.';
  if (q.goals.length > MAX_GOALS) return `Pick at most ${MAX_GOALS} priorities.`;
  if (new Set(q.goals.map((g) => g.goal)).size !== q.goals.length) return 'Each priority can be picked once.';
  if (q.extra.length > MAX_EXTRA) return `Pick at most ${MAX_EXTRA} additional bonuses.`;
  return null;
}

/**
 * The piece counts a depth allows.
 *
 * @param depth The depth, or undefined for a search without a wanted bonus.
 * @return The lowest and highest number of pieces of the set in one power.
 */
export function depthRange(depth: Depth | undefined): [number, number] {
  if (depth === '2-3') return [2, 3];
  if (depth === '4-6') return [4, 6];
  return [1, 6];
}
