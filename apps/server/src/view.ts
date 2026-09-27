/**
 * Builds each viewer's TableView. This is the redaction boundary: views are
 * assembled field by field (never by spreading engine state), so the deck and
 * other players' hole cards can't leak by accident.
 */
import { cardToString, handLabel, ledgerRows, legalActions, potTotal } from "@garagepoker/engine";
import type { RequestView, SeatView, TableView } from "@garagepoker/protocol";
import type { SeatRequest, TableData } from "./table.js";

const cards = (cs: readonly number[]) => cs.map(cardToString);

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
  const hand = data.hand;
  const viewerSeat = data.seats.findIndex((s) => s?.playerId === viewerId) + 1 || null;
  const isOwner = viewerId === data.ownerId;

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

  return {
    tableId: data.id,
    rev: data.rev,
    serverNow: now,
    status: data.status,
    pauseRequested: data.pauseRequested,
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
      label: hand && you && !you.folded ? handLabel(hand.config.variant, you.hole, hand.board).text : null,
    },
    seats,
    hand: hand
      ? {
          number: data.handNumber,
          street: hand.street,
          board: cards(hand.board),
          pot: potTotal(hand),
          currentBet: hand.currentBet,
          toAct: hand.toAct,
          decisionDeadline: data.turn?.decisionDeadline ?? null,
          bankDeadline: data.turn?.bankDeadline ?? null,
        }
      : null,
    lastHand: data.lastHand
      ? {
          number: data.lastHand.number,
          board: cards(data.lastHand.board),
          pots: data.lastHand.pots,
          shown: data.lastHand.shown.map((x) => ({
            seat: x.seat,
            nickname: x.nickname,
            cards: cards(x.cards),
            label: x.label,
          })),
        }
      : null,
    requests: isOwner ? data.requests.map(requestView) : null,
    ledger: ledgerRows(data.ledger, stacks),
  };
}
