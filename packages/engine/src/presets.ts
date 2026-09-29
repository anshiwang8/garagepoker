/**
 * Raise presets for the action bar (SPEC §7). Pure: the UI passes in what the
 * server sent (legal actions, pot, blinds) and shows what comes back.
 */

export interface RaisePresetInput {
  /** Preflop with no raise yet: offer big-blind multiples. */
  unopened: boolean;
  bigBlind: number;
  /** All chips in the middle, current bets included. */
  pot: number;
  /** The bet to match on this street. */
  currentBet: number;
  /** Chips the player needs to call. */
  callAmount: number;
  /** Smallest legal raise-to (the all-in amount if that's smaller). */
  minRaiseTo: number;
  /** Largest legal raise-to: the all-in amount, or the pot-sized raise in PL. */
  maxRaiseTo: number;
  /** The player's bet plus stack. */
  allInTo: number;
  potLimit: boolean;
}

export interface RaisePreset {
  label: string;
  /** Total street bet to raise to. */
  to: number;
}

/**
 * - Unopened preflop: Min raise, 2 BB, 3 BB, All in.
 * - Otherwise (preflop after a raise, and postflop): Min raise, ½ pot, ¾ pot, Pot, All in.
 * - A pot fraction raises to the current bet plus that share of the pot after
 *   calling.
 * - Pot-limit: every preset is capped at the pot-sized raise; a capped All in
 *   is labelled "Pot (max)".
 * - Presets below the min raise or above the player's stack are hidden, and
 *   presets that land on the same amount are shown once.
 */
export function raisePresets(i: RaisePresetInput): RaisePreset[] {
  const potAfterCall = i.pot + i.callAmount;
  const fraction = (num: number, den: number) => i.currentBet + Math.floor((potAfterCall * num) / den);
  const candidates: RaisePreset[] = i.unopened
    ? [
        { label: "Min raise", to: i.minRaiseTo },
        { label: "2 BB", to: 2 * i.bigBlind },
        { label: "3 BB", to: 3 * i.bigBlind },
      ]
    : [
        { label: "Min raise", to: i.minRaiseTo },
        { label: "½ pot", to: fraction(1, 2) },
        { label: "¾ pot", to: fraction(3, 4) },
        { label: "Pot", to: fraction(1, 1) },
      ];
  const cap = i.potLimit ? Math.min(i.maxRaiseTo, i.allInTo) : i.allInTo;
  const allIn: RaisePreset = i.potLimit && i.allInTo > cap ? { label: "Pot (max)", to: cap } : { label: "All in", to: i.allInTo };

  const shown = new Map<number, RaisePreset>();
  for (const p of candidates) {
    const to = Math.min(p.to, cap);
    if (to < i.minRaiseTo || to > i.allInTo) continue;
    if (!shown.has(to)) shown.set(to, { label: p.label, to });
  }
  // The top preset keeps its special label if another preset lands on the same amount.
  if (allIn.to >= i.minRaiseTo) shown.set(allIn.to, allIn);
  return [...shown.values()].sort((a, b) => a.to - b.to);
}
