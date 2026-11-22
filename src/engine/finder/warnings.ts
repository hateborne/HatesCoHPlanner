/**
 * What a swap costs that the player should see before keeping it: a need dropped, a power's job
 * gutted, a unique piece's global or a proc without numbers taken out, a bonus the rule of five
 * wastes, a stat that falls out of its cap.
 */
import type { GameData } from '../../data/gamedata.ts';
import type { Slot } from '../build.ts';
import { pieceKind } from './candidates.ts';
import { isDamageProc } from './procs.ts';
import type { Aspect, Role } from './roles.ts';
import type { Scored } from './score.ts';

/** One thing a swap costs. */
export type Warning =
  | { kind: 'needDropped'; stat: string; before: number; after: number; typical: number } // a stat builds like this nearly all hold
  | { kind: 'crippled'; role: Role; aspect: Aspect; lost: number; only: boolean } // lost: share of the multiplier gone
  | { kind: 'globalLost'; boost: number } // a displaced piece with an effect of its own
  | { kind: 'procLost'; boost: number } // a displaced proc the planner has no numbers for (a damage proc shows in the gains and losses)
  | { kind: 'overFive'; bonus: number } // a bonus power the build already has five of
  | { kind: 'capLost'; stat: string }; // a stat at its cap (defense: the soft cap) that falls under it

/**
 * The warnings of a scored swap.
 *
 * @param gd Game data.
 * @param scored The swap's score and what it was made from.
 * @param displaced The slots whose enhancement the swap takes out, as they were.
 * @return The warnings, the gravest kinds first.
 */
export function warningsOf(gd: GameData, scored: Scored, displaced: readonly Slot[]): Warning[] {
  const out: Warning[] = [];
  for (const n of scored.needs) out.push({ kind: 'needDropped', ...n });
  // a power slotted for less recharge is the player's choice, and its recharge time is in the gains and losses
  for (const c of scored.crippled) if (c.aspect !== 'rech') out.push({ kind: 'crippled', ...c });
  for (const s of displaced) {
    const boost = s.enh ? gd.powerById.get(s.enh.boost) : undefined;
    const kind = boost ? pieceKind(gd, boost) : 'plain';
    if (boost && kind === 'global') out.push({ kind: 'globalLost', boost: boost.id });
    if (boost && kind === 'proc' && !isDamageProc(gd, boost)) out.push({ kind: 'procLost', boost: boost.id });
  }
  for (const id of new Set(scored.wasted.map((w) => w.power.id))) out.push({ kind: 'overFive', bonus: id });
  for (const stat of scored.capLost) out.push({ kind: 'capLost', stat });
  return out;
}
