/**
 * Chip amounts are integers everywhere. Cent mode (SPEC §5) only changes how
 * they're shown and typed; the rules live in @garagepoker/engine so the
 * browser and the tests use the same code, and no floats touch an amount.
 *
 *   cent mode off: 1980 <-> "1980"
 *   cent mode on:  1980 <-> "19.80", and "0.50" is typed as 50
 */
import { formatAmount, parseAmount } from "@garagepoker/engine";

/** For display: stacks, pots, bets, blinds, ledger, settle-up. */
export function formatChips(amount: number, centMode: boolean): string {
  return formatAmount(amount, centMode);
}

/** The editable text for an amount field. */
export function chipsToInput(amount: number, centMode: boolean): string {
  return formatAmount(amount, centMode);
}

/** What the user typed -> the stored integer, or null if it isn't valid in this mode. */
export function parseChips(text: string, centMode: boolean): number | null {
  return parseAmount(text, centMode);
}
