/**
 * Chip amounts are integer cents everywhere. These helpers only convert for
 * display and input; they never do floating-point arithmetic on amounts.
 */

/** 1000 -> "10", 1050 -> "10.50"; always 2 decimals when displayCents is on. */
export function formatChips(cents: number, displayCents = false): string {
  const whole = Math.trunc(cents / 100);
  const frac = Math.abs(cents % 100);
  const sign = cents < 0 && whole === 0 ? "-" : "";
  const main = sign + whole.toLocaleString("en-US");
  if (!displayCents && frac === 0) return main;
  return `${main}.${String(frac).padStart(2, "0")}`;
}

/** Same as formatChips but without thousands separators, for input fields. */
export function chipsToInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** "10", "10.5", "1,000.25" -> cents. Null if it isn't a valid amount. */
export function parseChips(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  const m = /^(\d{1,11})(?:\.(\d{0,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
