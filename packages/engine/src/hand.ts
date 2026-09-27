import { type Card, isCard } from "./cards";
import { type DeckSize, makeDeck } from "./deck";
import {
  bestHand,
  bestLow,
  bestOmahaHand,
  bestOmahaLow,
  type HandValue,
  type LowValue,
  type Ranking,
} from "./evaluator";
import { computePots, type Pot, splitPot } from "./pots";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type Betting = "NL" | "PL";
/** "any": best 5 of hole + board. "omaha": exactly 2 hole + 3 board. */
export type HandRule = "any" | "omaha";
/** "high": best high hand wins. "hilo": high and 8-or-better low split each board. */
export type Split = "high" | "hilo";

export interface Variant {
  holeCards: 2 | 4 | 5;
  deckSize: DeckSize;
  betting: Betting;
  handRule: HandRule;
  split: Split;
}

/** SPEC §1 presets. A new variant is a new row, not new code. */
export const VARIANTS = {
  NLH: { holeCards: 2, deckSize: 52, betting: "NL", handRule: "any", split: "high" },
  PLO: { holeCards: 4, deckSize: 52, betting: "PL", handRule: "omaha", split: "high" },
  PLO5: { holeCards: 5, deckSize: 52, betting: "PL", handRule: "omaha", split: "high" },
  PLOHL: { holeCards: 4, deckSize: 52, betting: "PL", handRule: "omaha", split: "hilo" },
  PLO5HL: { holeCards: 5, deckSize: 52, betting: "PL", handRule: "omaha", split: "hilo" },
} as const satisfies Record<string, Variant>;

export interface HandConfig {
  variant: Variant;
  /** All chip amounts are integer cents. */
  smallBlind: number;
  bigBlind: number;
  /** Per-player ante, dead money. 0 for none. */
  ante: number;
  /** UTG posts a 2 BB straddle (never heads-up, never in a bomb pot). */
  straddle: boolean;
  /** 1 (default) or 2 boards. Each board takes half of each pot. */
  boards?: 1 | 2;
  /**
   * Set when this hand is a bomb pot: every player dealt in antes this much,
   * there are no blinds and no preflop betting, and action starts on the flop.
   * The table decides which hands are bomb pots and who is dealt in.
   */
  bombPot?: { ante: number } | null;
}

export interface SeatedPlayer {
  seat: number;
  stack: number;
  /** New player posting a live big blind to sit in immediately. */
  postBlind?: boolean;
}

export interface StartHandInput {
  config: HandConfig;
  /** Players dealt in this hand. Away / waiting players are left out. */
  players: SeatedPlayer[];
  /** Seat of the dealer button; must be one of the players. */
  button: number;
  /** The shuffled deck. The engine never shuffles; the caller passes it in. */
  deck: Card[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Street = "preflop" | "flop" | "turn" | "river" | "complete";

export interface PlayerState {
  seat: number;
  /** Chips behind (not yet put in). */
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in over the whole hand, antes included. */
  committed: number;
  hole: Card[];
  folded: boolean;
  /** Has had a turn on this street. Blinds and straddles haven't. */
  acted: boolean;
  /** The bet to match when this player last acted (for the reopen rule). */
  facedBet: number;
}

export type LogType =
  | "ante"
  | "smallBlind"
  | "bigBlind"
  | "straddle"
  | "post"
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "uncalled";

export interface LogEntry {
  street: Street;
  seat: number;
  type: LogType;
  /** Chips moved: out of the stack, or back into it for "uncalled". */
  amount: number;
  /** For bet / raise: the player's total bet on the street. */
  to?: number;
  allIn?: boolean;
}

/**
 * One share of a pot: a board and a half. `board` and `half` are null when
 * the pot had a single eligible player and wasn't split at all.
 */
export interface PotSlice {
  /** 0-based board index. */
  board: number | null;
  half: "high" | "low" | null;
  amount: number;
  winners: { seat: number; amount: number }[];
}

export interface PotResult extends Pot {
  /** Total won from this pot per seat, across all its slices. */
  winners: { seat: number; amount: number }[];
  slices: PotSlice[];
}

export interface ShowdownHand {
  seat: number;
  hole: Card[];
  /** Per board: the best high hand, and the qualifying low (hi/lo only). */
  boards: { high: HandValue; low: LowValue | null }[];
}

export interface HandResult {
  pots: PotResult[];
  /** Total won per seat (only seats that won something). */
  payouts: { seat: number; amount: number }[];
  /** Live hands at showdown; empty when everyone else folded. */
  showdown: ShowdownHand[];
}

export interface HandState {
  config: HandConfig;
  button: number;
  /** Players in the hand, sorted by seat. */
  players: PlayerState[];
  /** Server-only. Never send this to a client. */
  deck: Card[];
  deckIndex: number;
  /** One board, or two with double board. */
  boards: Card[][];
  /** This hand is a bomb pot. */
  bombPot: boolean;
  street: Street;
  /** The bet to match on this street. */
  currentBet: number;
  /** Size of the last full raise; the minimum raise increment. */
  lastRaiseSize: number;
  /** Seat whose turn it is, or null when the hand is complete. */
  toAct: number | null;
  log: LogEntry[];
  result: HandResult | null;
}

export type PlayerAction =
  | { type: "fold"; seat: number }
  | { type: "check"; seat: number }
  | { type: "call"; seat: number }
  /** Bet or raise to a total street bet of `to`. All-in is `to` = bet + stack. */
  | { type: "raise"; seat: number; to: number };

export interface LegalActions {
  seat: number;
  canCheck: boolean;
  /** Chips needed to call, capped at the stack. 0 when checking is possible. */
  callAmount: number;
  canRaise: boolean;
  /** Smallest legal raise-to (or the all-in amount if that's smaller). */
  minRaiseTo: number;
  maxRaiseTo: number;
}

export class EngineError extends Error {
  override name = "EngineError";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The next dealer button: the next dealt-in seat after the previous one. */
export function nextButton(previous: number | null, seats: readonly number[]): number {
  if (seats.length === 0) throw new EngineError("no seats");
  const sorted = seats.slice().sort((a, b) => a - b);
  if (previous === null) return sorted[0]!;
  return sorted.find((s) => s > previous) ?? sorted[0]!;
}

/** Posts antes, blinds and straddle, deals hole cards, and sets the first player to act. */
export function startHand(input: StartHandInput): HandState {
  const { config, button } = input;
  validateHandConfig(config);

  const seated = input.players.slice().sort((a, b) => a.seat - b.seat);
  const n = seated.length;
  if (n < 2) throw new EngineError("a hand needs at least 2 players");
  seated.forEach((p, k) => {
    if (!Number.isInteger(p.seat)) throw new EngineError(`invalid seat ${p.seat}`);
    if (k > 0 && seated[k - 1]!.seat === p.seat) throw new EngineError(`duplicate seat ${p.seat}`);
    if (!isChips(p.stack) || p.stack === 0) {
      throw new EngineError(`seat ${p.seat} needs a positive integer stack`);
    }
  });
  const btn = seated.findIndex((p) => p.seat === button);
  if (btn < 0) throw new EngineError(`button seat ${button} is not in the hand`);

  const holeCards = config.variant.holeCards;
  const boardCount = config.boards ?? 1;
  // SPEC §3 deck math for one run: seats × hole cards + boards × 5, no burns.
  validateDeck(input.deck, config.variant.deckSize, n * holeCards + boardCount * 5);

  /** Index k seats to the left of the button. */
  const at = (k: number) => (btn + k) % n;

  const players: PlayerState[] = seated.map((p) => ({
    seat: p.seat,
    stack: p.stack,
    bet: 0,
    committed: 0,
    hole: [],
    folded: false,
    acted: false,
    facedBet: 0,
  }));
  let deckIndex = 0;
  for (let k = 1; k <= n; k++) {
    players[at(k)]!.hole = input.deck.slice(deckIndex, deckIndex + holeCards);
    deckIndex += holeCards;
  }

  const s: HandState = {
    config,
    button,
    players,
    deck: input.deck.slice(),
    deckIndex,
    boards: Array.from({ length: boardCount }, () => []),
    bombPot: !!config.bombPot,
    street: "preflop",
    currentBet: config.bombPot ? 0 : config.bigBlind,
    lastRaiseSize: config.bigBlind,
    toAct: null,
    log: [],
    result: null,
  };

  if (config.bombPot) {
    // SPEC §1: everyone antes; no blinds, straddle or preflop betting.
    for (let k = 1; k <= n; k++) postAnte(s, at(k), config.bombPot.ante);
    dealNextStreet(s);
    return advance(s, btn);
  }

  if (config.ante > 0) {
    for (let k = 1; k <= n; k++) postAnte(s, at(k), config.ante);
  }

  // Heads-up, the button posts the small blind.
  const sb = n === 2 ? btn : at(1);
  const bb = n === 2 ? at(1) : at(2);
  post(s, sb, config.smallBlind, "smallBlind");
  post(s, bb, config.bigBlind, "bigBlind");
  let lastForced = bb;

  let straddler = -1;
  const straddle = 2 * config.bigBlind;
  if (config.straddle && n >= 3 && players[at(3)]!.stack > straddle) {
    straddler = at(3);
    post(s, straddler, straddle, "straddle");
    s.currentBet = straddle;
    s.lastRaiseSize = straddle;
    lastForced = straddler;
  }

  seated.forEach((p, i) => {
    if (p.postBlind && i !== sb && i !== bb && i !== straddler) {
      post(s, i, config.bigBlind, "post");
    }
  });

  return advance(s, lastForced);
}

/** What the player to act may do, or null when the hand is complete. */
export function legalActions(state: HandState): LegalActions | null {
  if (state.toAct === null) return null;
  return legalFor(state, indexOfSeat(state, state.toAct));
}

/** The reducer: returns a new state and leaves the input untouched. Throws EngineError on illegal actions. */
export function applyAction(state: HandState, action: PlayerAction): HandState {
  if (state.toAct === null) throw new EngineError("the hand is complete");
  if (action.seat !== state.toAct) {
    throw new EngineError(`it is seat ${state.toAct}'s turn, not seat ${action.seat}'s`);
  }
  const s = cloneState(state);
  const i = indexOfSeat(s, action.seat);
  const p = s.players[i]!;
  const legal = legalFor(s, i);
  const base = { street: s.street, seat: p.seat };

  switch (action.type) {
    case "fold":
      p.folded = true;
      s.log.push({ ...base, type: "fold", amount: 0 });
      break;
    case "check":
      if (!legal.canCheck) throw new EngineError("cannot check facing a bet");
      s.log.push({ ...base, type: "check", amount: 0 });
      break;
    case "call": {
      if (legal.callAmount === 0) throw new EngineError("nothing to call");
      putIn(p, legal.callAmount);
      s.log.push({ ...base, type: "call", amount: legal.callAmount, allIn: p.stack === 0 });
      break;
    }
    case "raise": {
      const to = action.to;
      if (!legal.canRaise) throw new EngineError("raising is not allowed");
      if (!isChips(to)) throw new EngineError(`invalid amount ${to}`);
      const allInTo = p.bet + p.stack;
      if (to > legal.maxRaiseTo) throw new EngineError(`maximum raise is to ${legal.maxRaiseTo}`);
      if (to < legal.minRaiseTo && to !== allInTo) {
        throw new EngineError(`minimum raise is to ${legal.minRaiseTo}`);
      }
      const amount = to - p.bet;
      const type = s.currentBet === 0 ? "bet" : "raise";
      putIn(p, amount);
      // Only a full raise changes the minimum raise; a short all-in doesn't.
      const increment = to - s.currentBet;
      if (increment >= s.lastRaiseSize) s.lastRaiseSize = increment;
      s.currentBet = to;
      s.log.push({ ...base, type, amount, to, allIn: p.stack === 0 });
      break;
    }
    default:
      throw new EngineError(`unknown action ${(action as { type: unknown }).type}`);
  }

  p.acted = true;
  p.facedBet = s.currentBet;
  return advance(s, i);
}

/** Total chips in the middle, including bets on the current street. */
export function potTotal(state: HandState): number {
  return state.players.reduce((sum, p) => sum + p.committed, 0);
}

export function rankingFor(variant: Variant): Ranking {
  return variant.deckSize === 36 ? "shortdeck" : "standard";
}

/** A player's best high hand under the variant's hand rule. */
export function handValue(variant: Variant, hole: readonly Card[], board: readonly Card[]): HandValue {
  const ranking = rankingFor(variant);
  return variant.handRule === "omaha"
    ? bestOmahaHand(hole, board, ranking)
    : bestHand([...hole, ...board], ranking);
}

/**
 * A player's best 8-or-better low on one board under the variant's hand rule
 * (exactly 2 hole + 3 board in Omaha), or null if they have none.
 */
export function lowValue(variant: Variant, hole: readonly Card[], board: readonly Card[]): LowValue | null {
  return variant.handRule === "omaha" ? bestOmahaLow(hole, board) : bestLow([...hole, ...board]);
}

/** Splits `amount` into `parts` near-equal shares; odd chips go to the first shares. */
export function splitEven(amount: number, parts: number): number[] {
  const base = Math.floor(amount / parts);
  return Array.from({ length: parts }, (_, i) => base + (i < amount - base * parts ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isChips(x: unknown): x is number {
  return Number.isSafeInteger(x) && (x as number) >= 0;
}

function validateHandConfig(c: HandConfig): void {
  const v = c.variant;
  if (![2, 4, 5].includes(v.holeCards)) throw new EngineError(`invalid hole cards ${v.holeCards}`);
  if (v.deckSize !== 52 && v.deckSize !== 36) throw new EngineError(`invalid deck ${v.deckSize}`);
  if (v.betting !== "NL" && v.betting !== "PL") throw new EngineError(`invalid betting ${v.betting}`);
  if (v.handRule !== "any" && v.handRule !== "omaha") {
    throw new EngineError(`invalid hand rule ${v.handRule}`);
  }
  if (v.split !== "high" && v.split !== "hilo") throw new EngineError(`invalid split ${v.split}`);
  if (c.boards !== undefined && c.boards !== 1 && c.boards !== 2) {
    throw new EngineError(`boards must be 1 or 2, got ${c.boards}`);
  }
  if (c.bombPot && (!isChips(c.bombPot.ante) || c.bombPot.ante === 0)) {
    throw new EngineError("bomb pot ante must be more than 0");
  }
  if (!isChips(c.bigBlind) || c.bigBlind === 0) throw new EngineError("big blind must be > 0");
  if (!isChips(c.smallBlind) || c.smallBlind > c.bigBlind) {
    throw new EngineError("small blind must be between 0 and the big blind");
  }
  if (!isChips(c.ante)) throw new EngineError("ante must be a non-negative integer");
}

function validateDeck(deck: readonly Card[], deckSize: DeckSize, needed: number): void {
  if (deck.length !== deckSize) throw new EngineError(`deck must have ${deckSize} cards`);
  if (needed > deckSize) throw new EngineError(`not enough cards: need ${needed}, have ${deckSize}`);
  const valid = new Set(makeDeck(deckSize));
  const seen = new Set<Card>();
  for (const c of deck) {
    if (!isCard(c) || !valid.has(c) || seen.has(c)) throw new EngineError(`bad card in deck: ${c}`);
    seen.add(c);
  }
}

function cloneState(s: HandState): HandState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p })),
    boards: s.boards.map((b) => b.slice()),
    log: s.log.slice(),
  };
}

function indexOfSeat(s: HandState, seat: number): number {
  const i = s.players.findIndex((p) => p.seat === seat);
  if (i < 0) throw new EngineError(`seat ${seat} is not in the hand`);
  return i;
}

function putIn(p: PlayerState, amount: number): void {
  p.stack -= amount;
  p.bet += amount;
  p.committed += amount;
}

/** Posts an ante (dead money, not a bet), all-in for less if the stack is short. */
function postAnte(s: HandState, i: number, ante: number): void {
  const p = s.players[i]!;
  const amount = Math.min(ante, p.stack);
  p.stack -= amount;
  p.committed += amount;
  s.log.push({ street: "preflop", seat: p.seat, type: "ante", amount, allIn: p.stack === 0 });
}

/** Posts a forced bet, all-in for less if the stack is short. */
function post(s: HandState, i: number, amount: number, type: LogType): void {
  const p = s.players[i]!;
  const posted = Math.min(amount, p.stack);
  if (posted === 0) return;
  putIn(p, posted);
  s.log.push({ street: s.street, seat: p.seat, type, amount: posted, allIn: p.stack === 0 });
}

function othersWithChips(s: HandState, i: number): boolean {
  return s.players.some((q, j) => j !== i && !q.folded && q.stack > 0);
}

function legalFor(s: HandState, i: number): LegalActions {
  const p = s.players[i]!;
  const toCall = Math.max(0, s.currentBet - p.bet);
  const allInTo = p.bet + p.stack;
  // A player who already acted may re-raise only if the bet has grown by at
  // least a full raise since then; short all-ins alone don't reopen action.
  const reopened = !p.acted || s.currentBet - p.facedBet >= s.lastRaiseSize;
  const canRaise = reopened && allInTo > s.currentBet && othersWithChips(s, i);
  const minRaiseTo = Math.min(s.currentBet + s.lastRaiseSize, allInTo);
  let maxRaiseTo = allInTo;
  if (s.config.variant.betting === "PL") {
    // Call first, then raise by the size of the pot after the call.
    const potLimit = s.currentBet + potTotal(s) + toCall;
    maxRaiseTo = Math.max(minRaiseTo, Math.min(allInTo, potLimit));
  }
  return {
    seat: p.seat,
    canCheck: toCall === 0,
    callAmount: Math.min(toCall, p.stack),
    canRaise,
    minRaiseTo,
    maxRaiseTo,
  };
}

function needsAction(s: HandState, i: number): boolean {
  const p = s.players[i]!;
  if (p.folded || p.stack === 0) return false;
  if (!othersWithChips(s, i)) {
    // Nobody left to bet against: act only to call a bigger all-in.
    return s.players.some((q, j) => j !== i && !q.folded && q.bet > p.bet);
  }
  return !p.acted || p.bet < s.currentBet;
}

/** Moves to the next player to act, dealing streets and finishing the hand as needed. */
function advance(s: HandState, from: number): HandState {
  const n = s.players.length;
  const btn = indexOfSeat(s, s.button);
  for (;;) {
    if (s.players.filter((p) => !p.folded).length === 1) {
      returnUncalled(s);
      finish(s);
      return s;
    }
    for (let k = 1; k <= n; k++) {
      const j = (from + k) % n;
      if (needsAction(s, j)) {
        s.toAct = s.players[j]!.seat;
        return s;
      }
    }
    // Betting round over.
    returnUncalled(s);
    if (s.street === "river") {
      finish(s);
      return s;
    }
    dealNextStreet(s);
    from = btn;
  }
}

/** Returns the part of the biggest bet on this street that nobody matched. */
function returnUncalled(s: HandState): void {
  let top = 0;
  s.players.forEach((p, i) => {
    if (p.bet > s.players[top]!.bet) top = i;
  });
  const second = Math.max(0, ...s.players.filter((_, i) => i !== top).map((p) => p.bet));
  const p = s.players[top]!;
  const excess = p.bet - second;
  if (excess > 0) {
    p.bet -= excess;
    p.committed -= excess;
    p.stack += excess;
    s.log.push({ street: s.street, seat: p.seat, type: "uncalled", amount: excess });
  }
}

function dealNextStreet(s: HandState): void {
  const next: Record<string, Street> = { preflop: "flop", flop: "turn", turn: "river" };
  s.street = next[s.street]!;
  const count = s.street === "flop" ? 3 : 1;
  // Board 1 then board 2 on each street; no burn cards.
  for (const board of s.boards) {
    board.push(...s.deck.slice(s.deckIndex, s.deckIndex + count));
    s.deckIndex += count;
  }
  for (const p of s.players) {
    p.bet = 0;
    p.acted = false;
    p.facedBet = 0;
  }
  s.currentBet = 0;
  s.lastRaiseSize = s.config.bigBlind;
}

function finish(s: HandState): void {
  const n = s.players.length;
  const btn = indexOfSeat(s, s.button);
  /** 0 = first seat left of the button. */
  const order = (seat: number) => (indexOfSeat(s, seat) - btn - 1 + n) % n;

  const variant = s.config.variant;
  const hilo = variant.split === "hilo";
  const live = s.players.filter((p) => !p.folded);
  const showdown: ShowdownHand[] =
    live.length > 1
      ? live.map((p) => ({
          seat: p.seat,
          hole: p.hole,
          boards: s.boards.map((board) => ({
            high: handValue(variant, p.hole, board),
            low: hilo ? lowValue(variant, p.hole, board) : null,
          })),
        }))
      : [];
  const hands = new Map(showdown.map((h) => [h.seat, h.boards]));
  const inOrder = (seats: number[]) => seats.slice().sort((a, b) => order(a) - order(b));

  // SPEC §2.5: each board takes half of each pot; within a board the high and
  // the qualifying low each take half; ties split; odd chips go to board 1,
  // then to the high half, then to the first winner left of the button.
  const pots: PotResult[] = computePots(s.players).map((pot) => {
    const slices: PotSlice[] = [];
    if (pot.eligible.length === 1) {
      const seat = pot.eligible[0]!;
      slices.push({ board: null, half: null, amount: pot.amount, winners: [{ seat, amount: pot.amount }] });
    } else {
      splitEven(pot.amount, s.boards.length).forEach((share, b) => {
        if (share === 0) return;
        const at = (seat: number) => hands.get(seat)![b]!;
        const lowSeats = hilo ? pot.eligible.filter((seat) => at(seat).low) : [];
        const lowAmount = lowSeats.length > 0 ? Math.floor(share / 2) : 0;
        const highAmount = share - lowAmount;

        const bestHigh = Math.max(...pot.eligible.map((seat) => at(seat).high.score));
        const highWinners = pot.eligible.filter((seat) => at(seat).high.score === bestHigh);
        slices.push({ board: b, half: "high", amount: highAmount, winners: splitPot(highAmount, inOrder(highWinners)) });

        if (lowAmount > 0) {
          // Lower low score is the better low.
          const bestLowScore = Math.min(...lowSeats.map((seat) => at(seat).low!.score));
          const lowWinners = lowSeats.filter((seat) => at(seat).low!.score === bestLowScore);
          slices.push({ board: b, half: "low", amount: lowAmount, winners: splitPot(lowAmount, inOrder(lowWinners)) });
        }
      });
    }
    const perSeat = new Map<number, number>();
    for (const slice of slices) {
      for (const w of slice.winners) perSeat.set(w.seat, (perSeat.get(w.seat) ?? 0) + w.amount);
    }
    const winners = [...perSeat].map(([seat, amount]) => ({ seat, amount })).sort((a, b) => a.seat - b.seat);
    return { ...pot, winners, slices };
  });

  const won = new Map<number, number>();
  for (const pot of pots) {
    for (const w of pot.winners) won.set(w.seat, (won.get(w.seat) ?? 0) + w.amount);
  }
  for (const p of s.players) {
    p.stack += won.get(p.seat) ?? 0;
    p.bet = 0;
  }

  s.street = "complete";
  s.toAct = null;
  s.result = {
    pots,
    payouts: [...won].map(([seat, amount]) => ({ seat, amount })).sort((a, b) => a.seat - b.seat),
    showdown,
  };
}
