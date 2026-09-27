/**
 * The session ledger (SPEC §6): an append-only audit log of chips entering
 * and leaving the table. Chips moving between players in hands are not
 * logged; they show up in current stacks.
 */

export type LedgerKind = "sitIn" | "rebuy" | "add" | "remove" | "set" | "leave" | "kick";

export interface LedgerEvent {
  at: number;
  /** Hands dealt so far when this happened. */
  hand: number;
  playerId: string;
  nickname: string;
  kind: LedgerKind;
  buyIn: number;
  buyOut: number;
  stackBefore: number;
  stackAfter: number;
}

export interface LedgerInput {
  at: number;
  hand: number;
  playerId: string;
  nickname: string;
  stackBefore: number;
  /** Chips added/removed; the new stack for "set"; ignored for leave/kick. */
  amount?: number;
}

export class LedgerError extends Error {
  override name = "LedgerError";
}

const isCents = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

/** Builds a ledger event, working out the buy-in / buy-out effect of the change. */
export function ledgerEvent(kind: LedgerKind, input: LedgerInput): LedgerEvent {
  const { stackBefore } = input;
  const amount = input.amount ?? 0;
  if (!isCents(stackBefore)) throw new LedgerError(`bad stack ${stackBefore}`);
  if (!isCents(amount)) throw new LedgerError(`bad amount ${amount}`);
  let buyIn = 0;
  let buyOut = 0;
  switch (kind) {
    case "sitIn":
    case "rebuy":
    case "add":
      if (amount === 0) throw new LedgerError(`${kind} needs a positive amount`);
      buyIn = amount;
      break;
    case "remove":
      if (amount === 0 || amount > stackBefore) throw new LedgerError("can't remove more than the stack");
      buyOut = amount;
      break;
    case "set":
      if (amount > stackBefore) buyIn = amount - stackBefore;
      else buyOut = stackBefore - amount;
      break;
    case "leave":
    case "kick":
      buyOut = stackBefore;
      break;
  }
  const { at, hand, playerId, nickname } = input;
  return {
    at,
    hand,
    playerId,
    nickname,
    kind,
    buyIn,
    buyOut,
    stackBefore,
    stackAfter: stackBefore + buyIn - buyOut,
  };
}

export interface LedgerRow {
  playerId: string;
  nickname: string;
  buyIn: number;
  buyOut: number;
  stack: number;
  /** buyOut + stack - buyIn */
  net: number;
}

/**
 * One row per player, in order of first appearance. `stacks` holds current
 * stacks by player id; anyone missing has 0 (they left).
 */
export function ledgerRows(
  events: readonly LedgerEvent[],
  stacks: Readonly<Record<string, number>>,
): LedgerRow[] {
  const rows = new Map<string, LedgerRow>();
  for (const e of events) {
    let row = rows.get(e.playerId);
    if (!row) {
      row = { playerId: e.playerId, nickname: e.nickname, buyIn: 0, buyOut: 0, stack: 0, net: 0 };
      rows.set(e.playerId, row);
    }
    row.nickname = e.nickname;
    row.buyIn += e.buyIn;
    row.buyOut += e.buyOut;
  }
  for (const [id, stack] of Object.entries(stacks)) {
    if (stack !== 0 && !rows.has(id)) throw new LedgerError(`player ${id} has chips but no ledger entry`);
  }
  for (const row of rows.values()) {
    row.stack = stacks[row.playerId] ?? 0;
    row.net = row.buyOut + row.stack - row.buyIn;
  }
  return [...rows.values()];
}

/** SPEC §6 invariant: between hands the nets sum to 0. Throws if they don't. */
export function assertLedgerBalanced(rows: readonly LedgerRow[]): void {
  const sum = rows.reduce((s, r) => s + r.net, 0);
  if (sum !== 0) throw new LedgerError(`ledger nets sum to ${sum}, expected 0`);
}
