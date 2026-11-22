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
  { id: 'resistance', name: 'Damage Resistance' },
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

/** One priority row of a search: a goal with its importance, or an importance waiting for a goal. */
export interface GoalPick {
  goal?: GoalId; // which goal; absent: the row is empty and counts for nothing
  importance: Importance; // how much it counts
}

/** A priority row that names a goal. */
export type ChosenGoal = GoalPick & { goal: GoalId };

/** A power a search is kept to: its entry in the build and the power there, so another build's entry of the same key is not taken for it. */
export interface PowerPick {
  key: string; // the power's entry key ('pick:<i>', 'grant:<power id>')
  power: number; // the power's id
}

/** A search. */
export interface FinderQuery {
  goals: GoalPick[]; // up to MAX_GOALS rows, each goal once; rows without a goal are not searched for (chosenGoals)
  tags: SetTag[]; // kinds of sets beyond uncommon and rare
  main?: { stat: string; depth: Depth }; // a bonus every result must add (a totals line key: 'rech', 'def.03')
  extra: string[]; // up to MAX_EXTRA more bonuses, which only order the results
  groups?: string[]; // set categories to keep to ("Ranged Damage", "Defense Sets"); absent: every category
  powers?: PowerPick[]; // the powers to keep to; absent: every power
  attuned?: boolean; // place attuned pieces instead of crafted ones at the highest usable level
}

export const MAX_GOALS = 3;
export const MAX_EXTRA = 2;

/**
 * The priorities a search really names: its rows that hold a goal.
 *
 * @param q The search.
 * @return The rows with a goal, in the form's order.
 */
export function chosenGoals(q: Pick<FinderQuery, 'goals'>): ChosenGoal[] {
  return q.goals.filter((g): g is ChosenGoal => g.goal !== undefined);
}

/**
 * The priority rows after one of them is given a goal, emptied, or given another importance.
 *
 * A goal another row holds moves here: that row is emptied and keeps its importance, so two
 * priorities trade places in two picks. An emptied row stays where it is; no row moves up.
 *
 * @param goals The rows as they are.
 * @param i The row to change (0-based, under MAX_GOALS).
 * @param patch The row's new goal (null empties it) and/or its new importance.
 * @return MAX_GOALS rows.
 */
export function setGoalAt(goals: readonly GoalPick[], i: number, patch: { goal?: GoalId | null; importance?: Importance }): GoalPick[] {
  const rows = Array.from({ length: MAX_GOALS }, (_, k): GoalPick => goals[k] ?? { importance: 'medium' });
  const cur = rows[i];
  if (!cur) return rows;
  const goal = patch.goal === undefined ? cur.goal : (patch.goal ?? undefined);
  const importance = patch.importance ?? cur.importance;
  return rows.map((r, k) => (k === i ? (goal ? { goal, importance } : { importance }) : goal && r.goal === goal ? { importance: r.importance } : r));
}

/**
 * Why a search can't run, if it can't.
 *
 * @param q The search.
 * @return Null when it can run, else a sentence for the player.
 */
export function queryProblem(q: FinderQuery): string | null {
  const goals = chosenGoals(q);
  if (goals.length < 1) return 'Pick at least one priority.';
  if (goals.length > MAX_GOALS) return `Pick at most ${MAX_GOALS} priorities.`;
  if (new Set(goals.map((g) => g.goal)).size !== goals.length) return 'Each priority can be picked once.';
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
