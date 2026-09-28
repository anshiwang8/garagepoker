/**
 * Table rules on top of the engine: seats, requests, owner actions, the
 * ledger, timers and the hand lifecycle. Operates in place on plain JSON
 * `TableData`; time, randomness and who's connected are passed in, so this
 * file does no I/O. TableRoom (index.ts) persists and broadcasts.
 */
import {
  applyAction,
  assertLedgerBalanced,
  type Card,
  EngineError,
  type HandState,
  handConfigFor,
  handLabel,
  type HandRecord,
  type PlayerAction,
  type StartHandInput,
  lowestCard,
  parseCard,
  rabbitCards,
  isBombPotHand,
  LedgerError,
  type LedgerEvent,
  ledgerEvent,
  type LedgerKind,
  ledgerRows,
  legalActions,
  makeDeck,
  nextButton,
  type PotSlice,
  randomInt,
  type RandomSource,
  shuffle,
  startHand,
  type TableSettings,
  validateConfig,
  VARIANTS,
} from "@garagepoker/engine";
import type { ClientMessage, TableStatus } from "@garagepoker/protocol";
import { type FairnessSecret, newSalts } from "./fairness.js";

export const AUTO_START_DELAY_MS = 3_000;
export const OWNER_OFFLINE_MS = 5 * 60_000;
export const IDLE_DELETE_MS = 12 * 60 * 60_000;
export const MISSED_HANDS_BEFORE_AWAY = 2;
export const TIME_BANK_REFILL_EVERY_HANDS = 10;
export const TIME_BANK_REFILL_MS = 10_000;
export const MAX_SEATS = 9;
/** SPEC §2.7: players have 5 s to accept running it twice. */
export const RIT_DECISION_MS = 5_000;

/** An error the player caused; its message is shown to them. */
export class TableError extends Error {
  override name = "TableError";
}

export interface PlayerRecord {
  playerId: string;
  /** Secret. Never leaves the server. */
  token: string;
  notice: string | null;
}

type StackOpKind = "rebuy" | "add" | "remove" | "set";

export interface SeatData {
  playerId: string;
  nickname: string;
  /** Chips between hands. During a hand the engine state is authoritative. */
  stack: number;
  seatedAt: number;
  away: boolean;
  waitingForBB: boolean;
  postBlind: boolean;
  missedHands: number;
  timeBankMs: number;
  /** Set when leaving or kicked mid-hand; applied when the hand ends. */
  leaving: "leave" | "kick" | null;
  /** Stack changes made mid-hand; applied when the hand ends. */
  pendingOps: { kind: StackOpKind; amount: number }[];
}

export interface SeatRequest {
  id: string;
  playerId: string;
  kind: "seat" | "rebuy";
  nickname: string;
  seat: number | null;
  amount: number;
  postBlind: boolean;
}

/** A hand as the engine saw it, plus who sat where (seats can change later). */
export interface TableHandRecord {
  hand: number;
  record: HandRecord;
  players: { seat: number; playerId: string; nickname: string }[];
}

/** The timers that can wake a TableRoom. */
export type AlarmTimer = "turn" | "nextHand" | "runItTwice" | "discard" | "ownerHandOff" | "idleDelete";

export interface TurnTimer {
  seat: number;
  decisionDeadline: number;
  bankDeadline: number;
}

export interface LastHand {
  number: number;
  bombPot: boolean;
  hiLo: boolean;
  boards: Card[][];
  /** Each pot split into slices (board × high/low); see the engine's PotSlice. */
  pots: { amount: number; slices: PotSlice[] }[];
  /** One label per board. */
  shown: { seat: number; nickname: string; cards: Card[]; labels: string[]; secondRunLabels: string[] | null }[];
  /** The second run's boards, when run twice. */
  secondRun: Card[][] | null;
  /** Rabbit-hunted cards per board, once a seated player asked (SPEC §2.8). */
  rabbit: { boards: Card[][]; by: string } | null;
}

export interface TableData {
  version: 1;
  /** Incremented by TableRoom on every committed change. */
  rev: number;
  id: string;
  createdAt: number;
  ownerId: string;
  players: PlayerRecord[];
  settings: TableSettings;
  pendingSettings: TableSettings | null;
  /** Index = seat - 1. Always MAX_SEATS long; seats past settings.seats stay empty. */
  seats: (SeatData | null)[];
  requests: SeatRequest[];
  status: TableStatus;
  pauseRequested: boolean;
  endRequested: boolean;
  handNumber: number;
  button: number | null;
  hand: HandState | null;
  turn: TurnTimer | null;
  /** Seats that timed out while disconnected in the current hand. */
  handTimeouts: number[];
  nextHandAt: number | null;
  /** While run it twice is offered: when an unanswered offer runs once. */
  ritDeadline: number | null;
  /** While Pineapple players discard: when anyone still pending discards their lowest card. */
  discardDeadline: number | null;
  lastHand: LastHand | null;
  /**
   * The last finished hand's full engine state, deck included, for the
   * rabbit hunt. Server-only: never put in a view. Overwritten each hand.
   */
  prevHand: HandState | null;
  /** The current hand's start and every action, for the replay. Server-only (holds the deck). */
  handRecord: TableHandRecord | null;
  /** The last finished hand's record, overwritten each hand. Server-only. */
  prevRecord: TableHandRecord | null;
  /** Salts and hashes for the current (or last) hand's fairness proof. Server-only. */
  fairness: FairnessSecret | null;
  ledger: LedgerEvent[];
  ownerOfflineSince: number | null;
  emptySince: number | null;
}

export interface TableDeps {
  now: number;
  random: RandomSource;
  /** Player ids with at least one open socket. */
  connected: ReadonlySet<string>;
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(length: number, random: RandomSource): string {
  let id = "";
  for (let i = 0; i < length; i++) id += ID_CHARS[randomInt(ID_CHARS.length, random)];
  return id;
}

/** A new, paused table owned by `ownerToken`. */
export function newTableData(
  id: string,
  ownerToken: string,
  settings: TableSettings,
  deps: Pick<TableDeps, "now" | "random">,
): TableData {
  const issues = validateConfig(settings);
  if (issues.length) throw new TableError(issues.map((i) => i.message).join("; "));
  const ownerId = randomId(12, deps.random);
  return {
    version: 1,
    rev: 0,
    id,
    createdAt: deps.now,
    ownerId,
    players: [{ playerId: ownerId, token: ownerToken, notice: null }],
    settings,
    pendingSettings: null,
    seats: new Array<SeatData | null>(MAX_SEATS).fill(null),
    requests: [],
    status: "paused",
    pauseRequested: false,
    endRequested: false,
    handNumber: 0,
    button: null,
    hand: null,
    turn: null,
    handTimeouts: [],
    nextHandAt: null,
    ritDeadline: null,
    discardDeadline: null,
    lastHand: null,
    prevHand: null,
    handRecord: null,
    prevRecord: null,
    fairness: null,
    ledger: [],
    ownerOfflineSince: null,
    emptySince: deps.now,
  };
}

export class Table {
  constructor(
    readonly data: TableData,
    private readonly deps: TableDeps,
  ) {}

  private get now() {
    return this.deps.now;
  }

  // -------------------------------------------------------------------------
  // Entry points
  // -------------------------------------------------------------------------

  /** Returns the player id for a token, registering new browsers. */
  hello(token: string): string {
    let p = this.data.players.find((x) => x.token === token);
    if (!p) {
      p = { playerId: randomId(12, this.deps.random), token, notice: null };
      this.data.players.push(p);
    }
    return p.playerId;
  }

  handle(playerId: string, m: Exclude<ClientMessage, { type: "hello" | "getReplay" }>): void {
    const player = this.player(playerId);
    player.notice = null;
    if (this.data.status === "ended") throw new TableError("This game has ended");

    switch (m.type) {
      case "requestSeat":
        return this.requestSeat(playerId, m.seat, m.nickname, m.buyIn, m.postBlind);
      case "cancelRequest":
        this.data.requests = this.data.requests.filter((r) => r.playerId !== playerId);
        return;
      case "requestRebuy":
        return this.requestRebuy(playerId, m.amount);
      case "act":
        return this.act(playerId, m.hand, m.action);
      case "setAway": {
        const seat = this.requireSeated(playerId);
        seat.away = m.away;
        if (!m.away) seat.missedHands = 0;
        this.afterChange();
        return;
      }
      case "leaveSeat":
        return this.leave(this.requireSeatNumber(playerId), "leave");
      case "runItTwice":
        return this.answerRunItTwice(playerId, m.hand, m.accept);
      case "rabbitHunt":
        return this.rabbitHunt(playerId, m.hand);
      case "discard":
        return this.discard(playerId, m.hand, m.card);
    }

    // Owner only from here.
    if (playerId !== this.data.ownerId) throw new TableError("Only the table owner can do that");
    switch (m.type) {
      case "approveRequest":
        return this.approve(this.request(m.requestId), m.stack);
      case "declineRequest": {
        const r = this.request(m.requestId);
        this.data.requests = this.data.requests.filter((x) => x !== r);
        this.player(r.playerId).notice =
          r.kind === "seat" ? "Your seat request was declined" : "Your rebuy request was declined";
        return;
      }
      case "updateSettings":
        return this.updateSettings(m.settings);
      case "adjustStack":
        return this.adjustStack(m.playerId, m.op, m.amount);
      case "kick": {
        if (m.playerId === playerId) throw new TableError("Use Leave seat to stand up");
        return this.leave(this.requireSeatNumber(m.playerId), "kick");
      }
      case "transferOwnership":
        this.requireSeated(m.playerId);
        this.data.ownerId = m.playerId;
        this.data.ownerOfflineSince = null;
        return;
      case "startGame":
        this.data.status = "running";
        this.data.pauseRequested = false;
        this.afterChange();
        return;
      case "pauseGame":
        if (this.data.hand) this.data.pauseRequested = true;
        else this.pause();
        return;
      case "endGame":
        if (this.data.hand) this.data.endRequested = true;
        else this.end();
        return;
    }
  }

  /** Runs whatever is due: turn timeouts, the next hand, owner hand-off. */
  tick(): void {
    const d = this.data;
    const turn = d.turn;
    if (d.hand && turn && this.now >= turn.decisionDeadline) {
      const seat = this.seat(turn.seat)!;
      const connected = this.deps.connected.has(seat.playerId);
      // Connected players dip into their time bank; disconnected ones don't.
      if (!connected || this.now >= turn.bankDeadline) this.timeout(turn, connected);
    }
    if (d.hand?.ritOffer && d.ritDeadline !== null && this.now >= d.ritDeadline) {
      // No answer in time: it runs once (SPEC §2.7).
      const offer = d.hand.ritOffer;
      const seat = offer.seats.find((s) => !offer.accepted.includes(s))!;
      this.applyEngine({ type: "runItTwice", seat, accept: false });
      this.afterAction();
    }
    if (d.hand?.discard && d.discardDeadline !== null && this.now >= d.discardDeadline) {
      // SPEC §1: on timeout, discard the lowest card.
      for (const seat of d.hand.discard.pending) {
        const s = this.seat(seat)!;
        if (!this.deps.connected.has(s.playerId) && !d.handTimeouts.includes(seat)) d.handTimeouts.push(seat);
        const hole = d.hand.players.find((p) => p.seat === seat)!.hole;
        this.applyEngine({ type: "discard", seat, card: lowestCard(hole) });
      }
      this.afterAction();
    }
    if (!d.hand && d.nextHandAt !== null && this.now >= d.nextHandAt) this.startNextHand();
    this.maybeHandOffOwnership();
  }

  /** Call after connections change. */
  syncPresence(): void {
    const d = this.data;
    const { connected } = this.deps;
    if (connected.has(d.ownerId)) d.ownerOfflineSince = null;
    else d.ownerOfflineSince ??= this.now;
    if (connected.size > 0) d.emptySince = null;
    else d.emptySince ??= this.now;
    // Someone who can take over may have just connected to an ownerless table.
    this.maybeHandOffOwnership();
  }

  /**
   * When tick() next has something to do, and which timer that is.
   *
   * Invariant: every timer listed here is one tick() will act on once it's
   * due. A due timer that tick() can't act on would make the alarm re-fire
   * immediately, forever (TableRoom.persist() clamps that as a backstop).
   */
  nextAlarm(): { at: number; timer: AlarmTimer } | null {
    const d = this.data;
    const due: { at: number; timer: AlarmTimer }[] = [];
    if (d.hand && d.turn) {
      // At the decision deadline a disconnected player times out; a connected
      // one moves on to the time bank, which is still in the future.
      const at = this.now < d.turn.decisionDeadline ? d.turn.decisionDeadline : d.turn.bankDeadline;
      due.push({ at, timer: "turn" });
    }
    // tick() only starts a hand between hands.
    if (!d.hand && d.nextHandAt !== null) due.push({ at: d.nextHandAt, timer: "nextHand" });
    if (d.hand?.ritOffer && d.ritDeadline !== null) due.push({ at: d.ritDeadline, timer: "runItTwice" });
    if (d.hand?.discard && d.discardDeadline !== null) due.push({ at: d.discardDeadline, timer: "discard" });
    if (d.ownerOfflineSince !== null) {
      const at = d.ownerOfflineSince + OWNER_OFFLINE_MS;
      // Once it's due, only wake if someone can take over. Otherwise the
      // hand-off happens when a candidate connects or comes back from away.
      if (at > this.now || this.handOffCandidate()) due.push({ at, timer: "ownerHandOff" });
    }
    if (d.emptySince !== null) due.push({ at: d.emptySince + IDLE_DELETE_MS, timer: "idleDelete" });
    return due.reduce<{ at: number; timer: AlarmTimer } | null>((min, x) => (!min || x.at < min.at ? x : min), null);
  }

  /** SPEC §4: delete a table with no connected players for 12 hours. */
  shouldDelete(): boolean {
    const d = this.data;
    return d.emptySince !== null && this.now - d.emptySince >= IDLE_DELETE_MS;
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  player(playerId: string): PlayerRecord {
    const p = this.data.players.find((x) => x.playerId === playerId);
    if (!p) throw new TableError("Unknown player");
    return p;
  }

  seat(n: number): SeatData | null {
    return this.data.seats[n - 1] ?? null;
  }

  seatNumberOf(playerId: string): number | null {
    const i = this.data.seats.findIndex((s) => s?.playerId === playerId);
    return i < 0 ? null : i + 1;
  }

  private requireSeatNumber(playerId: string): number {
    const n = this.seatNumberOf(playerId);
    if (n === null) throw new TableError("That player isn't seated");
    return n;
  }

  private requireSeated(playerId: string): SeatData {
    return this.seat(this.requireSeatNumber(playerId))!;
  }

  private request(id: string): SeatRequest {
    const r = this.data.requests.find((x) => x.id === id);
    if (!r) throw new TableError("That request is no longer pending");
    return r;
  }

  private inHand(seat: number): boolean {
    return !!this.data.hand?.players.some((p) => p.seat === seat);
  }

  /** Current stacks by player id, for the ledger. Uses between-hand stacks. */
  stacksByPlayer(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.data.seats) if (s) out[s.playerId] = s.stack;
    return out;
  }

  // -------------------------------------------------------------------------
  // Seats, requests and stacks
  // -------------------------------------------------------------------------

  private requestSeat(playerId: string, seat: number, nickname: string, buyIn: number, postBlind: boolean) {
    const d = this.data;
    if (this.seatNumberOf(playerId) !== null) throw new TableError("You already have a seat");
    if (seat > d.settings.seats) throw new TableError("No such seat");
    if (this.seat(seat)) throw new TableError("That seat is taken");
    if (d.requests.some((r) => r.kind === "seat" && r.seat === seat && r.playerId !== playerId)) {
      throw new TableError("Someone has already asked for that seat");
    }
    const lower = nickname.toLowerCase();
    const taken =
      d.seats.some((s) => s && s.playerId !== playerId && s.nickname.toLowerCase() === lower) ||
      d.requests.some((r) => r.playerId !== playerId && r.nickname.toLowerCase() === lower);
    if (taken) throw new TableError("That name is taken");

    d.requests = d.requests.filter((r) => r.playerId !== playerId);
    const req: SeatRequest = {
      id: randomId(12, this.deps.random),
      playerId,
      kind: "seat",
      nickname,
      seat,
      amount: buyIn,
      postBlind,
    };
    if (playerId === d.ownerId) this.approve(req, buyIn);
    else d.requests.push(req);
  }

  private requestRebuy(playerId: string, amount: number) {
    const d = this.data;
    if (!d.settings.rebuys) throw new TableError("Rebuys are turned off");
    const seat = this.requireSeated(playerId);
    d.requests = d.requests.filter((r) => !(r.playerId === playerId && r.kind === "rebuy"));
    const req: SeatRequest = {
      id: randomId(12, this.deps.random),
      playerId,
      kind: "rebuy",
      nickname: seat.nickname,
      seat: null,
      amount,
      postBlind: false,
    };
    if (playerId === d.ownerId) this.approve(req, amount);
    else d.requests.push(req);
  }

  /** Approves a request with the owner's (possibly edited) amount. */
  private approve(req: SeatRequest, amount: number) {
    const d = this.data;
    d.requests = d.requests.filter((r) => r.id !== req.id);
    if (req.kind === "rebuy") {
      this.stackOp(this.requireSeatNumber(req.playerId), "rebuy", amount);
      this.afterChange();
      return;
    }
    const seat = req.seat!;
    if (this.seatNumberOf(req.playerId) !== null) throw new TableError("They already have a seat");
    if (seat > d.settings.seats || this.seat(seat)) throw new TableError("That seat is no longer free");
    const started = d.handNumber > 0;
    d.seats[seat - 1] = {
      playerId: req.playerId,
      nickname: req.nickname,
      stack: 0,
      seatedAt: this.now,
      away: false,
      waitingForBB: started && !req.postBlind,
      postBlind: started && req.postBlind,
      missedHands: 0,
      timeBankMs: d.settings.timeBankSec * 1000,
      leaving: null,
      pendingOps: [],
    };
    this.log("sitIn", seat, amount);
    this.afterChange();
  }

  private adjustStack(playerId: string, op: "add" | "remove" | "set", amount: number) {
    const n = this.requireSeatNumber(playerId);
    if (op !== "set" && amount === 0) throw new TableError("Amount must be more than 0");
    if (op === "remove" && !this.inHand(n) && amount > this.seat(n)!.stack) {
      throw new TableError("Can't remove more than their stack");
    }
    this.stackOp(n, op, amount);
    this.afterChange();
  }

  /** Applies a ledgered stack change now, or after the hand if the seat is in it. */
  private stackOp(n: number, kind: StackOpKind, amount: number) {
    const seat = this.seat(n)!;
    if (this.inHand(n)) seat.pendingOps.push({ kind, amount });
    else this.applyStackOp(n, kind, amount);
  }

  private applyStackOp(n: number, kind: StackOpKind, amount: number) {
    const seat = this.seat(n)!;
    // A removal queued mid-hand may exceed what's left after the hand.
    const amt = kind === "remove" ? Math.min(amount, seat.stack) : amount;
    if (kind === "remove" && amt === 0) return;
    if (kind === "set" && amt === seat.stack) return;
    this.log(kind, n, amt);
  }

  private leave(n: number, kind: "leave" | "kick") {
    const seat = this.seat(n)!;
    this.data.requests = this.data.requests.filter((r) => r.playerId !== seat.playerId);
    if (this.inHand(n)) {
      seat.leaving = kind;
      return;
    }
    this.removeFromSeat(n, kind);
    this.afterChange();
  }

  private removeFromSeat(n: number, kind: "leave" | "kick") {
    const seat = this.seat(n)!;
    this.log(kind, n);
    this.data.seats[n - 1] = null;
    if (kind === "kick") this.player(seat.playerId).notice = "You were removed from the table";
  }

  /** Appends a ledger event for seat n and applies it to the seat's stack. */
  private log(kind: LedgerKind, n: number, amount?: number) {
    const seat = this.seat(n)!;
    let e: LedgerEvent;
    try {
      e = ledgerEvent(kind, {
        at: this.now,
        hand: this.data.handNumber,
        playerId: seat.playerId,
        nickname: seat.nickname,
        stackBefore: seat.stack,
        amount,
      });
    } catch (err) {
      if (err instanceof LedgerError) throw new TableError(err.message);
      throw err;
    }
    this.data.ledger.push(e);
    seat.stack = e.stackAfter;
  }

  // -------------------------------------------------------------------------
  // Settings and game state
  // -------------------------------------------------------------------------

  private updateSettings(settings: TableSettings) {
    const d = this.data;
    const issues = validateConfig(settings);
    if (issues.length) throw new TableError(issues.map((i) => i.message).join("; "));
    const occupied = d.seats.findIndex((s, i) => s && i + 1 > settings.seats);
    if (occupied >= 0) throw new TableError(`Seat ${occupied + 1} is occupied`);
    if (d.hand) d.pendingSettings = settings;
    else this.applySettings(settings);
  }

  private applySettings(settings: TableSettings) {
    const d = this.data;
    d.settings = settings;
    d.pendingSettings = null;
    d.requests = d.requests.filter((r) => r.seat === null || r.seat <= settings.seats);
    for (const s of d.seats) if (s) s.timeBankMs = Math.min(s.timeBankMs, settings.timeBankSec * 1000);
  }

  private pause() {
    this.data.status = "paused";
    this.data.pauseRequested = false;
    this.data.nextHandAt = null;
  }

  private end() {
    const d = this.data;
    d.status = "ended";
    d.endRequested = false;
    d.pauseRequested = false;
    d.nextHandAt = null;
    d.requests = [];
  }

  /** Between hands: auto-pause if everyone is away, else deal when ready. */
  private afterChange() {
    const d = this.data;
    if (d.status !== "running" || d.hand) return;
    const seated = d.seats.filter((s): s is SeatData => s !== null);
    if (seated.length > 0 && seated.every((s) => s.away)) {
      this.pause();
      return;
    }
    d.nextHandAt ??= this.now;
  }

  /** SPEC §4: who takes over from an offline owner: the longest-seated connected, active player. */
  private handOffCandidate(): SeatData | undefined {
    const d = this.data;
    return d.seats
      .filter((s): s is SeatData => !!s && !s.away && s.playerId !== d.ownerId)
      .filter((s) => this.deps.connected.has(s.playerId))
      .sort((a, b) => a.seatedAt - b.seatedAt)[0];
  }

  /** Hands ownership over once the owner has been offline 5 minutes and someone can take it. */
  private maybeHandOffOwnership() {
    const d = this.data;
    if (d.ownerOfflineSince === null || this.now - d.ownerOfflineSince < OWNER_OFFLINE_MS) return;
    const next = this.handOffCandidate();
    if (next) {
      d.ownerId = next.playerId;
      d.ownerOfflineSince = null;
    }
  }

  // -------------------------------------------------------------------------
  // Hand lifecycle
  // -------------------------------------------------------------------------

  private startNextHand() {
    const d = this.data;
    d.nextHandAt = null;
    if (d.status !== "running") return;
    if (d.pendingSettings) this.applySettings(d.pendingSettings);

    const eligible = d.seats
      .map((s, i) => ({ s, seat: i + 1 }))
      .filter((x): x is { s: SeatData; seat: number } => !!x.s && x.s.stack > 0 && !x.s.away);
    let active = eligible.filter((x) => !x.s.waitingForBB);
    // Waiting for the big blind only makes sense once a game is going.
    if (active.length < 2) {
      for (const x of eligible) x.s.waitingForBB = false;
      active = eligible;
    }
    if (active.length < 2) return;

    const button = nextButton(d.button, active.map((x) => x.seat));
    const bombPot = isBombPotHand(d.settings, d.handNumber + 1);
    // Deal in the first waiting player who would be the big blind this hand.
    const waiting = eligible.filter((x) => x.s.waitingForBB);
    const admitted = waiting.find((w) => bigBlindSeat([...active, w].map((x) => x.seat), button) === w.seat);
    // SPEC §1: in a bomb pot every player who isn't away antes, so nobody
    // waits for the big blind (there isn't one).
    const dealt = bombPot ? eligible : admitted ? [...active, admitted] : active;

    const variant = VARIANTS[d.settings.variant];
    const deck = shuffle(makeDeck(variant.deckSize), this.deps.random);
    const input: StartHandInput = {
      config: handConfigFor(d.settings, bombPot),
      players: dealt.map((x) => ({ seat: x.seat, stack: x.s.stack, postBlind: x.s.postBlind })),
      button,
      deck,
    };
    d.hand = startHand(input);
    d.handRecord = {
      hand: d.handNumber + 1,
      record: { input, actions: [] },
      players: dealt.map((x) => ({ seat: x.seat, playerId: x.s.playerId, nickname: x.s.nickname })),
    };
    // Committed (hashed by TableRoom) before any view of this hand goes out.
    d.fairness = {
      hand: d.handNumber + 1,
      deck,
      salts: newSalts(deck.length, this.deps.random),
      leaves: null,
      commitment: null,
    };
    for (const x of dealt) {
      x.s.postBlind = false;
      x.s.waitingForBB = false;
    }
    d.handNumber++;
    d.button = button;
    d.handTimeouts = [];
    this.afterAction();
  }

  private answerRunItTwice(playerId: string, hand: number, accept: boolean) {
    const d = this.data;
    if (!d.hand || hand !== d.handNumber) throw new TableError("That hand is over");
    if (!d.hand.ritOffer) throw new TableError("Run it twice isn't being offered");
    const n = this.seatNumberOf(playerId);
    if (n === null || !d.hand.ritOffer.seats.includes(n)) throw new TableError("You're not in this pot");
    if (d.hand.ritOffer.accepted.includes(n)) throw new TableError("You already accepted");
    this.applyEngine({ type: "runItTwice", seat: n, accept });
    this.afterAction();
  }

  private rabbitHunt(playerId: string, hand: number) {
    const d = this.data;
    const seat = this.requireSeated(playerId);
    if (!d.settings.rabbitHunt) throw new TableError("Rabbit hunt is turned off");
    if (!rabbitAvailable(d) || d.lastHand!.number !== hand) throw new TableError("There's nothing to rabbit hunt");
    // Same deck, dealing order continued: display only, pots are settled.
    d.lastHand!.rabbit = { boards: rabbitCards(d.prevHand!), by: seat.nickname };
  }

  private discard(playerId: string, hand: number, cardText: string) {
    const d = this.data;
    if (!d.hand || hand !== d.handNumber) throw new TableError("That hand is over");
    if (!d.hand.discard) throw new TableError("Nobody is discarding now");
    const n = this.seatNumberOf(playerId);
    if (n === null || !d.hand.discard.pending.includes(n)) throw new TableError("You have nothing to discard");
    const card = parseCard(cardText);
    if (!d.hand.players.find((p) => p.seat === n)!.hole.includes(card)) throw new TableError("You don't hold that card");
    this.applyEngine({ type: "discard", seat: n, card });
    this.seat(n)!.missedHands = 0;
    this.afterAction();
  }

  /** Applies an engine action to the current hand and records it for the replay. */
  private applyEngine(action: PlayerAction) {
    const d = this.data;
    d.hand = applyAction(d.hand!, action);
    d.handRecord?.record.actions.push(action);
  }

  private act(playerId: string, hand: number, action: Extract<ClientMessage, { type: "act" }>["action"]) {
    const d = this.data;
    if (!d.hand || hand !== d.handNumber) throw new TableError("That hand is over");
    const n = this.seatNumberOf(playerId);
    if (n === null || d.hand.toAct !== n) throw new TableError("It's not your turn");
    const engineAction =
      action.type === "raise" ? { type: "raise" as const, seat: n, to: action.to } : { type: action.type, seat: n };
    try {
      this.applyEngine(engineAction);
    } catch (err) {
      if (err instanceof EngineError) throw new TableError(err.message);
      throw err;
    }
    const seat = this.seat(n)!;
    if (d.turn) {
      const used = Math.max(0, this.now - d.turn.decisionDeadline);
      seat.timeBankMs = Math.max(0, seat.timeBankMs - used);
    }
    seat.missedHands = 0;
    this.afterAction();
  }

  /** Time's up: check if free, otherwise fold. */
  private timeout(turn: TurnTimer, connected: boolean) {
    const d = this.data;
    const seat = this.seat(turn.seat)!;
    if (connected) seat.timeBankMs = 0;
    else if (!d.handTimeouts.includes(turn.seat)) d.handTimeouts.push(turn.seat);
    const legal = legalActions(d.hand!)!;
    this.applyEngine({ type: legal.canCheck ? "check" : "fold", seat: turn.seat });
    this.afterAction();
  }

  private afterAction() {
    const d = this.data;
    const hand = d.hand!;
    if (hand.street === "complete") {
      this.finishHand(hand);
      return;
    }
    if (hand.ritOffer) {
      // Waiting on run-it-twice answers, not on a player's turn.
      d.turn = null;
      d.ritDeadline ??= this.now + RIT_DECISION_MS;
      return;
    }
    d.ritDeadline = null;
    if (hand.discard) {
      // Pineapple: everyone discards at once; one clock for the street.
      d.turn = null;
      d.discardDeadline ??= this.now + d.settings.decisionTimeSec * 1000;
      return;
    }
    d.discardDeadline = null;
    if (hand.toAct === null) throw new Error("hand stalled with nobody to act");
    const seat = this.seat(hand.toAct)!;
    const decisionDeadline = this.now + d.settings.decisionTimeSec * 1000;
    d.turn = { seat: hand.toAct, decisionDeadline, bankDeadline: decisionDeadline + seat.timeBankMs };
  }

  private finishHand(hand: HandState) {
    const d = this.data;
    const result = hand.result!;
    for (const p of hand.players) this.seat(p.seat)!.stack = p.stack;
    d.lastHand = {
      number: d.handNumber,
      bombPot: hand.bombPot,
      hiLo: hand.config.variant.split === "hilo",
      boards: hand.boards,
      pots: result.pots.map(({ amount, slices }) => ({ amount, slices })),
      shown: result.showdown.map(({ seat, hole }) => ({
        seat,
        nickname: this.seat(seat)!.nickname,
        cards: hole,
        labels: hand.boards.map((board) => handLabel(hand.config.variant, hole, board).text),
        secondRunLabels: hand.secondRun?.map((board) => handLabel(hand.config.variant, hole, board).text) ?? null,
      })),
      secondRun: hand.secondRun,
      rabbit: null,
    };
    d.prevHand = hand;
    d.prevRecord = d.handRecord ?? null;
    d.handRecord = null;
    d.hand = null;
    d.turn = null;
    d.ritDeadline = null;
    d.discardDeadline = null;

    for (const n of d.handTimeouts) {
      const s = this.seat(n)!;
      if (++s.missedHands >= MISSED_HANDS_BEFORE_AWAY) s.away = true;
    }
    if (d.handNumber % TIME_BANK_REFILL_EVERY_HANDS === 0) {
      const max = d.settings.timeBankSec * 1000;
      for (const s of d.seats) if (s) s.timeBankMs = Math.min(max, s.timeBankMs + TIME_BANK_REFILL_MS);
    }
    // Changes made during the hand take effect now.
    d.seats.forEach((s, i) => {
      if (!s) return;
      for (const op of s.pendingOps) this.applyStackOp(i + 1, op.kind, op.amount);
      s.pendingOps = [];
      if (s.leaving) this.removeFromSeat(i + 1, s.leaving);
    });
    if (d.pendingSettings) this.applySettings(d.pendingSettings);

    // SPEC §6: between hands the nets must sum to 0.
    assertLedgerBalanced(ledgerRows(d.ledger, this.stacksByPlayer()));

    if (d.endRequested) this.end();
    else if (d.pauseRequested || !d.settings.autoStart) this.pause();
    else {
      d.nextHandAt = this.now + AUTO_START_DELAY_MS;
      this.afterChange();
    }
  }
}

/**
 * Whether a seated player may rabbit hunt the last hand right now: it's on,
 * we're between hands, and that hand ended before the river (SPEC §2.8).
 */
export function rabbitAvailable(d: TableData): boolean {
  const last = d.lastHand;
  return (
    d.settings.rabbitHunt &&
    !d.hand &&
    !!last &&
    !!d.prevHand &&
    last.number === d.handNumber &&
    !last.rabbit &&
    !last.secondRun &&
    last.boards[0]!.length < 5
  );
}

/** The big blind seat for a hand dealt to `seats` (sorted or not) with this button. */
export function bigBlindSeat(seats: number[], button: number): number {
  const sorted = seats.slice().sort((a, b) => a - b);
  const b = sorted.indexOf(button);
  return sorted.length === 2 ? sorted[(b + 1) % 2]! : sorted[(b + 2) % sorted.length]!;
}
