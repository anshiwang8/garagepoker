/**
 * Builds each viewer's TableView. This is the redaction boundary: views are
 * assembled field by field (never by spreading engine state), so the deck and
 * other players' hole cards can't leak by accident.
 */
import { cardToString, handLabel, ledgerRows, legalActions, potTotal, settleUp, splitEven } from "@garagepoker/engine";
import type { HandState, LogEntry } from "@garagepoker/engine";
import type { LogEntryView, RequestView, SeatView, TableView } from "@garagepoker/protocol";
import { proofFor } from "./fairness.js";
import { rabbitAvailable, type SeatRequest, showableCards, type TableData } from "./table.js";

const cards = (cs: readonly number[]) => cs.map(cardToString);

/** Field by field, like everything else in a view. The log never holds a card. */
function logView(log: readonly LogEntry[]): LogEntryView[] {
  return log.map((e) => ({
    street: e.street,
    seat: e.seat,
    type: e.type,
    amount: e.amount,
    ...(e.to !== undefined && { to: e.to }),
    ...(e.allIn !== undefined && { allIn: e.allIn }),
  }));
}

/** Each dealt-in seat's net for a finished hand: won minus put in (uncalled bets are already returned). */
function netsOf(hand: HandState): { seat: number; net: number }[] {
  const won = new Map((hand.result?.payouts ?? []).map((p) => [p.seat, p.amount]));
  return hand.players.map((p) => ({ seat: p.seat, net: (won.get(p.seat) ?? 0) - p.committed }));
}

function requestView(r: SeatRequest): RequestView {
  return {
    id: r.id,
    playerId: r.playerId,
    kind: r.kind,
    nickname: r.nickname,
    seat: r.seat,
    amount: r.amount,
    postBlind: r.postBlind,
  };
}

/** The view for one player (seated or spectating). */
export function buildView(
  data: TableData,
  viewerId: string,
  connected: ReadonlySet<string>,
  now: number,
): TableView {
  const viewerSeat = data.seats.findIndex((s) => s?.playerId === viewerId) + 1 || null;
  const isOwner = viewerId === data.ownerId;
  // SPEC §4: with spectators off, people without a seat (other than the owner)
  // see who's sitting where, so they can ask for a seat, but not the game.
  const watchBlocked = !data.settings.spectators && viewerSeat === null && !isOwner;
  const hand = watchBlocked ? null : data.hand;
  const lastHand = watchBlocked ? null : data.lastHand;
  const seatedIds = new Set(data.seats.flatMap((s) => (s ? [s.playerId] : [])));
  const fairness = data.fairness;

  const seats = data.seats.slice(0, data.settings.seats).map((s, i): SeatView | null => {
    if (!s) return null;
    const seat = i + 1;
    const hp = hand?.players.find((p) => p.seat === seat);
    const mine = seat === viewerSeat;
    const last = hand?.log.findLast((e) => e.seat === seat && e.street === hand.street);
    return {
      seat,
      playerId: s.playerId,
      nickname: s.nickname,
      stack: hp ? hp.stack : s.stack,
      isOwner: s.playerId === data.ownerId,
      connected: connected.has(s.playerId),
      away: s.away,
      waitingForBB: s.waitingForBB,
      leaving: s.leaving !== null,
      timeBankMs: s.timeBankMs,
      inHand: !!hp,
      folded: hp?.folded ?? false,
      allIn: !!hp && !hp.folded && hp.stack === 0,
      bet: hp?.bet ?? 0,
      // Only your own hole cards, ever. Showdown cards go in lastHand.
      cards: hp ? hp.hole.map((c) => (mine ? cardToString(c) : null)) : null,
      lastAction: last ? { type: last.type, amount: last.amount, ...(last.to !== undefined && { to: last.to }) } : null,
    };
  });

  const you = hand?.players.find((p) => p.seat === viewerSeat);
  const stacks: Record<string, number> = {};
  for (const s of data.seats) if (s) stacks[s.playerId] = s.stack;
  const ledger = ledgerRows(data.ledger, stacks);

  return {
    tableId: data.id,
    rev: data.rev,
    serverNow: now,
    status: data.status,
    pauseRequested: data.pauseRequested,
    pausedReason: data.pausedReason ?? null,
    endRequested: data.endRequested,
    settings: data.settings,
    pendingSettings: data.pendingSettings,
    handNumber: data.handNumber,
    buttonSeat: data.button,
    you: {
      playerId: viewerId,
      isOwner,
      seat: viewerSeat,
      request: (() => {
        const r = data.requests.find((x) => x.playerId === viewerId);
        return r ? requestView(r) : null;
      })(),
      notice: data.players.find((p) => p.playerId === viewerId)?.notice ?? null,
      legal: hand && viewerSeat !== null && hand.toAct === viewerSeat ? legalActions(hand) : null,
      // One label per board; in Hi/Lo each shows both halves.
      labels:
        hand && you && !you.folded ? hand.boards.map((b) => handLabel(hand.config.variant, you.hole, b).text) : null,
      watchBlocked,
      // Only ever your own cards.
      showable: (() => {
        const mine = watchBlocked ? [] : showableCards(data, viewerId);
        return mine.length ? cards(mine) : null;
      })(),
    },
    seats,
    hand: hand
      ? {
          number: data.handNumber,
          street: hand.street,
          boards: hand.boards.map(cards),
          bombPot: hand.bombPot,
          pot: potTotal(hand),
          boardShares: splitEven(potTotal(hand), hand.boards.length),
          currentBet: hand.currentBet,
          toAct: hand.toAct,
          decisionDeadline: data.turn?.decisionDeadline ?? null,
          bankDeadline: data.turn?.bankDeadline ?? null,
          discard:
            hand.discard && data.discardDeadline !== null
              ? { seats: [...hand.discard.pending], deadline: data.discardDeadline }
              : null,
          ritOffer:
            hand.ritOffer && data.ritDeadline !== null
              ? { seats: [...hand.ritOffer.seats], accepted: [...hand.ritOffer.accepted], deadline: data.ritDeadline }
              : null,
          commitment: fairness?.hand === data.handNumber ? fairness.commitment : null,
          log: logView(hand.log),
        }
      : null,
    lastHand: lastHand
      ? {
          number: lastHand.number,
          bombPot: lastHand.bombPot,
          hiLo: lastHand.hiLo,
          boards: lastHand.boards.map(cards),
          pots: lastHand.pots.map((p) => ({
            amount: p.amount,
            slices: p.slices.map((s) => ({
              // (Hands saved before run it twice have no run.)
              run: s.run ?? (s.board === null ? null : 0),
              board: s.board,
              half: s.half,
              amount: s.amount,
              winners: s.winners.map((w) => ({ seat: w.seat, amount: w.amount })),
            })),
          })),
          shown: lastHand.shown.map((x) => ({
            seat: x.seat,
            nickname: x.nickname,
            cards: cards(x.cards),
            labels: x.labels,
            secondRunLabels: x.secondRunLabels ?? null,
          })),
          // Only the cards each player chose to show.
          showed: (lastHand.showed ?? []).map((x) => ({ seat: x.seat, nickname: x.nickname, cards: cards(x.cards) })),
          secondRun: lastHand.secondRun?.map(cards) ?? null,
          rabbitAvailable: rabbitAvailable(data),
          // Rabbit cards appear only once a seated player asked for them.
          rabbit: lastHand.rabbit ? { boards: lastHand.rabbit.boards.map(cards), by: lastHand.rabbit.by } : null,
          fairness: fairnessProof(data),
          // prevHand is the same hand's final state (it's replaced together with lastHand).
          nets: data.prevHand ? netsOf(data.prevHand) : [],
          log: data.prevHand ? logView(data.prevHand.log) : [],
        }
      : null,
    requests: isOwner ? data.requests.map(requestView) : null,
    ledger: watchBlocked ? [] : ledger,
    settlement: data.status === "ended" && !watchBlocked ? settleUp(ledger) : null,
    spectators: [...connected].filter((id) => !seatedIds.has(id)).length,
  };
}

/**
 * The last hand's fairness proof: every position hash, plus salt and card for
 * the cards that became public: boards (both runs), showdown hands, cards
 * shown after the hand, and the rabbit cards once hunted. Folded hands (unless
 * shown) and discards are never revealed.
 */
function fairnessProof(data: TableData) {
  const { fairness, lastHand, prevHand } = data;
  if (!fairness || !lastHand || !prevHand || fairness.hand !== lastHand.number) return null;
  const shown = [
    ...prevHand.boards.flat(),
    ...(prevHand.secondRun?.flat() ?? []),
    ...lastHand.shown.flatMap((s) => s.cards),
    ...(lastHand.showed ?? []).flatMap((s) => s.cards),
    ...(lastHand.rabbit?.boards.flat() ?? []),
  ];
  return proofFor(fairness, shown);
}
