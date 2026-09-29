import type { LastHandView, SeatView, TableView } from "@garagepoker/protocol";
import type { VariantName } from "@garagepoker/engine";
import { formatChips } from "@/lib/chips";
import type { Countdown } from "./Seat";

/** Short variant names for the table info line: "NLH ~ 10 / 20". */
export const VARIANT_SHORT: Record<VariantName, string> = {
  NLH: "NLH",
  PLO: "PLO",
  PLO5: "PLO5",
  PLOHL: "PLO HL",
  PLO5HL: "PLO5 HL",
  PINEAPPLE: "Pineapple",
  SHORT: "Short deck",
};

export function countdownFor(view: TableView, now: number): Countdown | null {
  const hand = view.hand;
  if (!hand?.toAct || hand.decisionDeadline === null || hand.bankDeadline === null) return null;
  const decisionMs = view.settings.decisionTimeSec * 1000;
  const left = hand.decisionDeadline - now;
  if (left > 0) return { fraction: left / decisionMs, seconds: Math.ceil(left / 1000), inBank: false, bankElapsed: 0 };
  const bankLeft = Math.max(0, hand.bankDeadline - now);
  const bankTotal = Math.max(1, hand.bankDeadline - hand.decisionDeadline);
  return { fraction: bankLeft / bankTotal, seconds: Math.ceil(bankLeft / 1000), inBank: true, bankElapsed: now - hand.decisionDeadline };
}

/** The finished hand is still on the table (until the next deal). */
export const showingResult = (view: TableView): view is TableView & { lastHand: LastHandView } =>
  !view.hand && !!view.lastHand && view.lastHand.number === view.handNumber;

/**
 * The table's state, in place of the blinds line, when no hand is running and
 * none has just finished: "Waiting for players", "Paused by owner".
 */
export function tableStateText(view: TableView): string | null {
  if (view.you.watchBlocked) return "Spectating is off. Take a seat to watch.";
  if (view.hand) return null;
  if (view.status === "ended") return "Game over";
  const active = view.seats.filter((s) => s && !s.away && s.stack > 0).length;
  if (view.status === "paused") {
    if (view.pausedReason === "waitingForPlayers" || active < 2) return "Waiting for players";
    if (view.handNumber === 0) return "Waiting for the owner to start";
    return "Paused by owner";
  }
  if (showingResult(view)) return null;
  return active < 2 ? "Waiting for players" : null;
}

/** "Waiting for Bob…", or how many players act before you. */
export function waitingText(view: TableView): string | null {
  const hand = view.hand;
  if (!hand?.toAct || hand.ritOffer || hand.discard) return null;
  const name = view.seats[hand.toAct - 1]?.nickname ?? `Seat ${hand.toAct}`;
  const me = view.you.seat !== null ? view.seats[view.you.seat - 1] : null;
  const canAct = (s: SeatView | null | undefined) => !!s && s.inHand && !s.folded && !s.allIn;
  if (!me || !canAct(me)) return `Waiting for ${name}…`;
  // You still owe an action this street if you haven't acted voluntarily or are behind the bet.
  const forced = ["smallBlind", "bigBlind", "straddle", "post", "ante"];
  const owes = !me.lastAction || forced.includes(me.lastAction.type) || me.bet < hand.currentBet;
  if (!owes) return `Waiting for ${name}…`;
  const n = view.seats.length;
  let before = 0;
  for (let i = 0; i < n; i++) {
    const seat = ((hand.toAct - 1 + i) % n) + 1;
    if (seat === me.seat) break;
    if (canAct(view.seats[seat - 1])) before++;
  }
  return before >= 2 ? `Your turn in ${before}` : `Waiting for ${name}…`;
}

/**
 * One line under the pot after a hand: "Ann wins 1.20", or each share of a
 * split pot, "B1 high: Ann 0.60 · B2 high: Bob 0.60".
 */
export function resultSummary(view: TableView, last: LastHandView): string {
  const dc = view.settings.displayCents;
  const name = (seat: number) => last.shown.find((s) => s.seat === seat)?.nickname ?? view.seats[seat - 1]?.nickname ?? `Seat ${seat}`;
  const slices = last.pots.flatMap((pot, p) => pot.slices.map((slice) => ({ slice, p })));
  if (slices.length === 1) {
    const { slice } = slices[0]!;
    return slice.winners.map((w) => `${name(w.seat)} wins ${formatChips(w.amount, dc)}`).join(" · ");
  }
  return slices
    .map(({ slice, p }) => {
      const parts: string[] = [];
      if (last.pots.length > 1) parts.push(p === 0 ? "Main" : `Side ${p}`);
      if (last.secondRun && slice.run !== null) parts.push(`R${slice.run + 1}`);
      if (last.boards.length > 1 && slice.board !== null) parts.push(`B${slice.board + 1}`);
      if (last.hiLo && slice.half) parts.push(slice.half);
      const who = slice.winners.map((w) => `${name(w.seat)} ${formatChips(w.amount, dc)}`).join(", ");
      return parts.length ? `${parts.join(" ")}: ${who}` : who;
    })
    .join(" · ");
}
