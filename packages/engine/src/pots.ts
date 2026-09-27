export interface Pot {
  amount: number;
  /** Seats that can win this pot, ascending. */
  eligible: number[];
}

export interface PotContribution {
  seat: number;
  /** Total chips put in this hand, including antes. */
  committed: number;
  folded: boolean;
}

/**
 * Splits the chips committed into a main pot and side pots. Each distinct
 * amount committed by a live player closes a layer; every player (folded or
 * not) contributes up to that layer, and only live players who reached it can
 * win it. Adjacent layers with the same eligible players are merged.
 *
 * Expects uncalled bets to have been returned already. Any dead money above
 * the highest live commitment goes to the top pot.
 */
export function computePots(players: readonly PotContribution[]): Pot[] {
  const levels = [...new Set(players.filter((p) => !p.folded).map((p) => p.committed))].sort(
    (a, b) => a - b,
  );
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of players) amount += Math.max(0, Math.min(p.committed, level) - prev);
    const eligible = players
      .filter((p) => !p.folded && p.committed >= level)
      .map((p) => p.seat)
      .sort((a, b) => a - b);
    prev = level;
    if (amount === 0) continue;
    const last = pots[pots.length - 1];
    if (last && sameSeats(last.eligible, eligible)) last.amount += amount;
    else pots.push({ amount, eligible });
  }
  let dead = 0;
  for (const p of players) dead += Math.max(0, p.committed - prev);
  if (dead > 0) {
    const top = pots[pots.length - 1];
    if (!top) throw new Error("dead money with no live player");
    top.amount += dead;
  }
  return pots;
}

/**
 * Splits a pot evenly between winners. Odd chips go one at a time to the
 * winners in the order given, which callers make "first seat left of the
 * button" order.
 */
export function splitPot(
  amount: number,
  winnersInOrder: readonly number[],
): { seat: number; amount: number }[] {
  const k = winnersInOrder.length;
  if (k === 0) throw new Error("a pot needs at least one winner");
  const share = Math.floor(amount / k);
  const odd = amount - share * k;
  return winnersInOrder.map((seat, i) => ({ seat, amount: share + (i < odd ? 1 : 0) }));
}

function sameSeats(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}
