import type { LedgerRow, Payment } from "@garagepoker/engine";

/** Cents as a plain decimal with 2 places, e.g. -3200 -> "-32.00". No floats involved. */
function amount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * A text cell. Quotes it when needed, and neutralises values a spreadsheet
 * would run as a formula (a nickname like "=HYPERLINK(...)").
 */
function text(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The ledger, then the settle-up payments. */
export function ledgerCsv(rows: readonly LedgerRow[], payments: readonly Payment[] | null): string {
  const lines = ["Player,Buy-in,Buy-out,Stack,Net"];
  for (const r of rows) {
    lines.push([text(r.nickname), amount(r.buyIn), amount(r.buyOut), amount(r.stack), amount(r.net)].join(","));
  }
  if (payments) {
    lines.push("", "From,To,Amount");
    for (const p of payments) lines.push([text(p.fromName), text(p.toName), amount(p.amount)].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
