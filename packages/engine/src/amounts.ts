/**
 * Showing and typing chip amounts (SPEC §5 "Cent mode"). Amounts are always
 * stored as integers; cent mode only changes how they're shown and typed:
 *
 *   cent mode off: 1980 is shown as "1980"; inputs are whole numbers.
 *   cent mode on:  1980 is shown as "19.80"; inputs accept up to 2 decimals
 *                  ("0.50" is stored as 50).
 *
 * Integer arithmetic only: no floats touch an amount.
 */

/** 1980 -> "1980" (off) or "19.80" (on). */
export function formatAmount(amount: number, centMode: boolean): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError(`amount must be an integer, got ${amount}`);
  if (!centMode) return String(amount);
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  const whole = (abs - (abs % 100)) / 100;
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * What the user typed -> the stored integer, or null if it isn't a valid
 * amount in this mode. Off: digits only. On: digits with up to 2 decimals.
 * Commas and surrounding spaces are ignored. Never negative.
 */
export function parseAmount(text: string, centMode: boolean): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!centMode) {
    if (!/^\d{1,13}$/.test(t)) return null;
    return Number(t);
  }
  const m = /^(\d{1,11})(?:\.(\d{0,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
