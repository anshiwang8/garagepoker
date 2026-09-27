import { LedgerError } from "./ledger";

export interface NetEntry {
  playerId: string;
  nickname: string;
  /** buyOut + stack - buyIn, in cents. */
  net: number;
}

export interface Payment {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  /** Integer cents, always > 0. */
  amount: number;
}

/**
 * SPEC §6 settle-up: the payments that settle the ledger. Greedily matches the
 * largest remaining debtor to the largest remaining creditor. Each payment
 * fully settles at least one of them, so there are at most n - 1 payments.
 * Ties go to whoever comes first in `entries`, so the result is deterministic.
 *
 * Throws LedgerError if the nets don't sum to 0.
 */
export function settleUp(entries: readonly NetEntry[]): Payment[] {
  let sum = 0;
  for (const e of entries) {
    if (!Number.isSafeInteger(e.net)) throw new LedgerError(`bad net ${e.net} for ${e.playerId}`);
    sum += e.net;
  }
  if (sum !== 0) throw new LedgerError(`ledger nets sum to ${sum}, expected 0`);

  const open = entries.map((e, order) => ({ ...e, left: Math.abs(e.net), order }));
  let debtors = open.filter((e) => e.net < 0);
  let creditors = open.filter((e) => e.net > 0);
  const byLeft = (a: { left: number; order: number }, b: { left: number; order: number }) =>
    b.left - a.left || a.order - b.order;

  const payments: Payment[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byLeft);
    creditors.sort(byLeft);
    const d = debtors[0]!;
    const c = creditors[0]!;
    const amount = Math.min(d.left, c.left);
    payments.push({ from: d.playerId, fromName: d.nickname, to: c.playerId, toName: c.nickname, amount });
    d.left -= amount;
    c.left -= amount;
    debtors = debtors.filter((x) => x.left > 0);
    creditors = creditors.filter((x) => x.left > 0);
  }
  return payments;
}
