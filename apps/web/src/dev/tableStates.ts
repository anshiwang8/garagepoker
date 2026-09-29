/**
 * Mocked table views for /dev/table-states (development only), one per state
 * the table UI must get right (SPEC §7). No server: each view is written by
 * hand the way the server would build it for the viewer "anshi".
 */
import { DEFAULT_SETTINGS, type TableSettings } from "@garagepoker/engine";
import type { HandView, LastHandView, LogEntryView, SeatView, TableView } from "@garagepoker/protocol";

export const DEV_NOW = 1_800_000_000_000;

function seat(n: number, nickname: string, stack: number, over: Partial<SeatView> = {}): SeatView {
  return {
    seat: n,
    playerId: `p${String(n).padStart(11, "0")}`,
    nickname,
    stack,
    isOwner: false,
    connected: true,
    away: false,
    waitingForBB: false,
    leaving: false,
    timeBankMs: 60_000,
    inHand: false,
    folded: false,
    allIn: false,
    bet: 0,
    cards: null,
    lastAction: null,
    ...over,
  };
}

function hand(over: Partial<HandView>): HandView {
  return {
    number: 12,
    street: "preflop",
    boards: [[]],
    bombPot: false,
    pot: 0,
    boardShares: [0],
    currentBet: 0,
    toAct: null,
    decisionDeadline: null,
    bankDeadline: null,
    ritOffer: null,
    discard: null,
    commitment: "9f2c4e1ab37d55c0e18f3b2a6d4c9e01f7a3b5c2d8e4f6a1b3c5d7e9f0a2b4c6",
    log: [],
    ...over,
  };
}

function last(over: Partial<LastHandView>): LastHandView {
  return {
    number: 12,
    bombPot: false,
    hiLo: false,
    boards: [[]],
    pots: [],
    shown: [],
    showed: [],
    secondRun: null,
    rabbitAvailable: false,
    rabbit: null,
    fairness: null,
    nets: [],
    log: [],
    ...over,
  };
}

function table(seats: (SeatView | null)[], over: Partial<Omit<TableView, "settings">> & { settings?: Partial<TableSettings> } = {}): TableView {
  const settings: TableSettings = { ...DEFAULT_SETTINGS, seats: seats.length, ...over.settings };
  const { settings: _s, ...rest } = over;
  void _s;
  return {
    tableId: "DevTable01",
    rev: 1,
    serverNow: DEV_NOW,
    status: "running",
    pauseRequested: false,
    pausedReason: null,
    endRequested: false,
    pendingSettings: null,
    handNumber: 12,
    buttonSeat: 1,
    you: {
      playerId: seats[0]?.playerId ?? "p00000000001",
      isOwner: true,
      seat: 1,
      request: null,
      notice: null,
      legal: null,
      labels: null,
      watchBlocked: false,
      showable: null,
    },
    seats,
    hand: null,
    lastHand: null,
    requests: [],
    ledger: [],
    settlement: null,
    spectators: 0,
    ...rest,
    settings,
  };
}

const you = (v: TableView, over: Partial<TableView["you"]>): TableView => ({ ...v, you: { ...v.you, ...over } });
const cents = { displayCents: true, smallBlind: 10, bigBlind: 20 };
const turn = (fraction: number, decisionSec = 20) => ({
  decisionDeadline: DEV_NOW + fraction * decisionSec * 1000,
  bankDeadline: DEV_NOW + fraction * decisionSec * 1000 + 60_000,
});
const log = (entries: [LogEntryView["street"], number, LogEntryView["type"], number, number?][]): LogEntryView[] =>
  entries.map(([street, s, type, amount, to]) => ({ street, seat: s, type, amount, ...(to !== undefined && { to }) }));

const NAMES = ["anshi", "Richard", "Maya", "Theo", "Priya", "Sam", "Jordan", "Alex", "Kenji"];

/** a) A new table: only the owner seated, not started. */
function newTable(): TableView {
  const seats: (SeatView | null)[] = Array.from({ length: 8 }, () => null);
  seats[0] = seat(1, "anshi", 2000, { isOwner: true });
  return table(seats, { status: "paused", handNumber: 0, buttonSeat: null, settings: cents });
}

/** b) Heads-up preflop, hero to act (button, small blind). */
function headsUp(): TableView {
  const seats = [
    seat(1, "anshi", 1990, { isOwner: true, inHand: true, bet: 10, cards: ["As", "Kd"], lastAction: { type: "smallBlind", amount: 10 } }),
    seat(2, "Richard", 1980, { inHand: true, bet: 20, cards: [null, null], lastAction: { type: "bigBlind", amount: 20 } }),
  ];
  const v = table(seats, {
    settings: { ...cents, seats: 6 },
    hand: hand({ pot: 30, currentBet: 20, toAct: 1, ...turn(0.8), log: log([["preflop", 1, "smallBlind", 10], ["preflop", 2, "bigBlind", 20]]) }),
  });
  v.seats = [...seats, null, null, null, null];
  return you(v, { labels: ["Ace high"], legal: { seat: 1, canCheck: false, callAmount: 10, canRaise: true, minRaiseTo: 40, maxRaiseTo: 2000 } });
}

/** d) PLO flop, facing a bet; pot-limit caps the presets. */
function ploPostflop(): TableView {
  const seats = [
    seat(1, "anshi", 1460, { isOwner: true, inHand: true, cards: ["Ah", "Kh", "Qd", "Jc"] }),
    seat(2, "Richard", 1880, { inHand: true, bet: 40, cards: [null, null, null, null], lastAction: { type: "bet", amount: 40, to: 40 } }),
    seat(3, "Maya", 2210, { inHand: true, folded: true, cards: [null, null, null, null], lastAction: { type: "fold", amount: 0 } }),
    seat(4, "Theo", 950, { inHand: true, cards: [null, null, null, null], lastAction: { type: "check", amount: 0 } }),
  ];
  const v = table([...seats, null, null], {
    settings: { variant: "PLO", smallBlind: 10, bigBlind: 20 },
    buttonSeat: 4,
    hand: hand({ street: "flop", boards: [["Th", "9h", "2c"]], pot: 160, boardShares: [160], currentBet: 40, toAct: 1, ...turn(0.7) }),
  });
  return you(v, { labels: ["Ace high"], legal: { seat: 1, canCheck: false, callAmount: 40, canRaise: true, minRaiseTo: 80, maxRaiseTo: 240 } });
}

/** e) Six-handed flop, Richard to act; the hero waits. */
function opponentToAct(): TableView {
  const seats = [
    seat(1, "anshi", 1840, { isOwner: true, inHand: true, bet: 60, cards: ["Qs", "Qd"], lastAction: { type: "bet", amount: 60, to: 60 } }),
    seat(2, "Richard", 2310, { inHand: true, cards: [null, null] }),
    seat(3, "Maya", 1500, { inHand: true, folded: true, cards: [null, null] }),
    seat(4, "Theo", 760, { inHand: true, cards: [null, null], lastAction: { type: "check", amount: 0 } }),
    seat(5, "Priya", 2025, { inHand: true, bet: 60, cards: [null, null], lastAction: { type: "call", amount: 60 } }),
    seat(6, "Sam", 1190, { inHand: false, away: true }),
  ];
  const v = table(seats, {
    settings: cents,
    buttonSeat: 5,
    hand: hand({ street: "flop", boards: [["Qh", "7c", "3d"]], pot: 300, boardShares: [300], currentBet: 60, toAct: 2, ...turn(0.45) }),
  });
  return you(v, { labels: ["Three of a kind"] });
}

/** f) Hero in the time bank (it started 0.8 s ago). */
function timeBank(): TableView {
  const v = headsUp();
  return { ...v, hand: { ...v.hand!, decisionDeadline: DEV_NOW - 800, bankDeadline: DEV_NOW + 39_200 } };
}

/** g) Hero won uncontested on the flop: net badges, show-cards bar, rabbit hunt. */
function wonUncontested(): TableView {
  const seats = [
    seat(1, "anshi", 2060, { isOwner: true }),
    seat(2, "Richard", 1940),
  ];
  const v = table([...seats, null, null, null, null], {
    settings: { ...cents, rabbitHunt: true },
    buttonSeat: 1,
    lastHand: last({
      boards: [["Jd", "8c", "4s"]],
      pots: [{ amount: 120, slices: [{ run: null, board: null, half: null, amount: 120, winners: [{ seat: 1, amount: 120 }] }] }],
      rabbitAvailable: true,
      nets: [{ seat: 1, net: 60 }, { seat: 2, net: -60 }],
      log: log([["preflop", 1, "smallBlind", 10], ["preflop", 2, "bigBlind", 20], ["preflop", 1, "raise", 50, 60], ["preflop", 2, "call", 40], ["flop", 2, "check", 0], ["flop", 1, "bet", 40, 40], ["flop", 2, "fold", 0], ["flop", 1, "uncalled", 40]]),
    }),
  });
  return you(v, { showable: ["8s", "Ad"] });
}

/** h) Showdown on the river, both hands shown with labels. */
function showdown(): TableView {
  const seats = [
    seat(1, "anshi", 2420, { isOwner: true }),
    seat(2, "Richard", 1580),
    seat(3, "Maya", 2000),
  ];
  const v = table([...seats, null, null, null], {
    settings: cents,
    buttonSeat: 2,
    lastHand: last({
      boards: [["Kc", "Td", "7h", "7s", "2c"]],
      pots: [{ amount: 840, slices: [{ run: null, board: 0, half: null, amount: 840, winners: [{ seat: 1, amount: 840 }] }] }],
      shown: [
        { seat: 1, nickname: "anshi", cards: ["Kh", "Ks"], labels: ["Full house"], secondRunLabels: null },
        { seat: 2, nickname: "Richard", cards: ["Ad", "Td"], labels: ["Two pair"], secondRunLabels: null },
      ],
      nets: [{ seat: 1, net: 420 }, { seat: 2, net: -420 }, { seat: 3, net: 0 }],
    }),
  });
  return v;
}

/** i) Double-board bomb pot, PLO, 8 players, hero at showdown. */
function doubleBoardBomb(): TableView {
  const stacks = [1880, 2140, 960, 2600, 1700, 1320, 2050, 1415];
  const seats = stacks.map((st, i) => seat(i + 1, NAMES[i]!, st, { isOwner: i === 0 }));
  const v = table(seats, {
    settings: { ...cents, variant: "PLO", boards: 2, bombPotMode: "everyHand" },
    buttonSeat: 5,
    lastHand: last({
      bombPot: true,
      boards: [
        ["9s", "8d", "2h", "Kc", "5s"],
        ["Ah", "Jh", "6c", "6d", "Qh"],
      ],
      pots: [
        {
          amount: 640,
          slices: [
            { run: 0, board: 0, half: null, amount: 320, winners: [{ seat: 2, amount: 320 }] },
            { run: 0, board: 1, half: null, amount: 320, winners: [{ seat: 1, amount: 320 }] },
          ],
        },
      ],
      shown: [
        { seat: 1, nickname: "anshi", cards: ["Kh", "Th", "7d", "6s"], labels: ["Pair", "Flush"], secondRunLabels: null },
        { seat: 2, nickname: "Richard", cards: ["7s", "6h", "Tc", "Td"], labels: ["Straight", "Two pair"], secondRunLabels: null },
        { seat: 5, nickname: "Priya", cards: ["Ks", "Kd", "4c", "3c"], labels: ["Three of a kind", "Two pair"], secondRunLabels: null },
      ],
      nets: [
        { seat: 1, net: 240 },
        { seat: 2, net: 240 },
        ...[3, 4, 5, 6, 7, 8].map((s) => ({ seat: s, net: -80 })),
      ],
    }),
  });
  return v;
}

/** j) Paused by the owner between hands. */
function paused(): TableView {
  const seats = [seat(1, "anshi", 2060, { isOwner: true }), seat(2, "Richard", 1940), seat(3, "Maya", 2210), null, seat(5, "Theo", 1790), null];
  return table(seats, { status: "paused", settings: cents, buttonSeat: 3 });
}

/** k) Hero away: the others play on. */
function away(): TableView {
  const seats = [
    seat(1, "anshi", 2060, { isOwner: true, away: true }),
    seat(2, "Richard", 1920, { inHand: true, bet: 20, cards: [null, null], lastAction: { type: "bigBlind", amount: 20 } }),
    seat(3, "Maya", 2190, { inHand: true, bet: 60, cards: [null, null], lastAction: { type: "raise", amount: 60, to: 60 } }),
    seat(4, "Theo", 1780, { inHand: true, bet: 10, cards: [null, null], lastAction: { type: "smallBlind", amount: 10 } }),
  ];
  const v = table([...seats, null, null], {
    settings: cents,
    buttonSeat: 3,
    hand: hand({ pot: 90, currentBet: 60, toAct: 4, ...turn(0.9) }),
  });
  return v;
}

/** l) Someone watching a full 9-seat table with two empty seats: Sit circles. */
function spectator(): TableView {
  const seats: (SeatView | null)[] = NAMES.map((n, i) =>
    i === 3 || i === 7 ? null : seat(i + 1, n, 1500 + i * 110, { isOwner: i === 0, inHand: true, cards: [null, null], bet: i === 1 ? 10 : i === 2 ? 20 : 0 }),
  );
  const v = table(seats, {
    settings: cents,
    buttonSeat: 1,
    hand: hand({ pot: 30, currentBet: 20, toAct: 5, ...turn(0.6) }),
  });
  return you(v, { seat: null, isOwner: false, playerId: "pwatcher0001" });
}

export interface DevState {
  id: string;
  title: string;
  view: TableView;
  raising?: boolean;
}

export const DEV_STATES: DevState[] = [
  { id: "a", title: "New table, only the owner seated", view: newTable() },
  { id: "b", title: "Heads-up preflop, hero to act", view: headsUp() },
  { id: "c", title: "Raise panel, preflop unopened", view: headsUp(), raising: true },
  { id: "d", title: "Raise panel, PLO flop (pot-limit)", view: ploPostflop(), raising: true },
  { id: "e", title: "Opponent to act", view: opponentToAct() },
  { id: "f", title: "Hero in the time bank", view: timeBank() },
  { id: "g", title: "Hero won uncontested (show cards, rabbit hunt)", view: wonUncontested() },
  { id: "h", title: "Showdown, both hands shown", view: showdown() },
  { id: "i", title: "Double-board bomb pot, PLO, 8 players", view: doubleBoardBomb() },
  { id: "j", title: "Paused by owner", view: paused() },
  { id: "k", title: "Hero away", view: away() },
  { id: "l", title: "Spectator, 9 seats with Sit circles", view: spectator() },
];
