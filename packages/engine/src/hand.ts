import { type Card, isCard } from "./cards";
import { type DeckSize, makeDeck } from "./deck";
import { bestHand, bestOmahaHand, type HandValue, type Ranking } from "./evaluator";
import { computePots, type Pot, splitPot } from "./pots";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type Betting = "NL" | "PL";
/** "any": best 5 of hole + board. "omaha": exactly 2 hole + 3 board. */
export type HandRule = "any" | "omaha";

export interface Variant {
  holeCards: 2 | 4 | 5;
  deckSize: DeckSize;
  betting: Betting;
  handRule: HandRule;
}

export const VARIANTS = {
  NLH: { holeCards: 2, deckSize: 52, betting: "NL", handRule: "any" },
  PLO: { holeCards: 4, deckSize: 52, betting: "PL", handRule: "omaha" },
  PLO5: { holeCards: 5, deckSize: 52, betting: "PL", handRule: "omaha" },
} as const satisfies Record<string, Variant>;

export interface HandConfig {
  variant: Variant;
  /** All chip amounts are integer cents. */
  smallBlind: number;
  bigBlind: number;
  /** Per-player ante, dead money. 0 for none. */
  ante: number;
  /** UTG posts a 2 BB straddle (never heads-up). */
  straddle: boolean;
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

export interface PotResult extends Pot {
  winners: { seat: number; amount: number }[];
}

export interface HandResult {
  pots: PotResult[];
  /** Total won per seat (only seats that won something). */
  payouts: { seat: number; amount: number }[];
  /** Live hands at showdown; empty when everyone else folded. */
  showdown: { seat: number; hole: Card[]; value: HandValue }[];
}

export interface HandState {
  config: HandConfig;
  button: number;
  /** Players in the hand, sorted by seat. */
  players: PlayerState[];
  /** Server-only. Never send this to a client. */
  deck: Card[];
  deckIndex: number;
  board: Card[];
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
  validateDeck(input.deck, config.variant.deckSize, n * holeCards + 5);

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
    board: [],
    street: "preflop",
    currentBet: config.bigBlind,
    lastRaiseSize: config.bigBlind,
    toAct: null,
    log: [],
    result: null,
  };

  if (config.ante > 0) {
    for (let k = 1; k <= n; k++) {
      const p = players[at(k)]!;
      const amount = Math.min(config.ante, p.stack);
      p.stack -= amount;
      p.committed += amount;
      s.log.push({ street: "preflop", seat: p.seat, type: "ante", amount, allIn: p.stack === 0 });
    }
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
    board: s.board.slice(),
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
  s.board.push(...s.deck.slice(s.deckIndex, s.deckIndex + count));
  s.deckIndex += count;
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

  const live = s.players.filter((p) => !p.folded);
  const values = new Map<number, HandValue>();
  if (live.length > 1) {
    for (const p of live) values.set(p.seat, handValue(s.config.variant, p.hole, s.board));
  }

  const pots: PotResult[] = computePots(s.players).map((pot) => {
    let contenders = pot.eligible;
    if (contenders.length > 1) {
      const best = Math.max(...contenders.map((seat) => values.get(seat)!.score));
      contenders = contenders.filter((seat) => values.get(seat)!.score === best);
    }
    const ordered = contenders.slice().sort((a, b) => order(a) - order(b));
    return { ...pot, winners: splitPot(pot.amount, ordered) };
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
    showdown: live.length > 1
      ? live.map((p) => ({ seat: p.seat, hole: p.hole, value: values.get(p.seat)! }))
      : [],
  };
}
