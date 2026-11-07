/**
 * Table rules on top of the engine: seats, requests, owner actions, the
 * ledger, timers and the hand lifecycle. Operates in place on plain JSON
 * `TableData`; time, randomness and who's connected are passed in, so this
 * file does no I/O. TableRoom (index.ts) persists and broadcasts.
 */
import {
  applyAction,
  assertLedgerBalanced,
  rankOf,
  suitOf,
  type BoardGrid,
  boardSize,
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
import { type ClientMessage, STALE_ACTION, type TableStatus } from "@garagepoker/protocol";
import { type FairnessSecret, newSalts } from "./fairness.js";
import { adjustNet, noteShownCards, recordHand, type SessionData } from "./session.js";

export const AUTO_START_DELAY_MS = 3_000;
/** The gap between hands while someone may still show their cards (SPEC §7). */
export const SHOW_WINDOW_MS = 5_000;
export const OWNER_OFFLINE_MS = 5 * 60_000;
export const IDLE_DELETE_MS = 12 * 60 * 60_000;
export const TIME_BANK_REFILL_EVERY_HANDS = 10;
export const TIME_BANK_REFILL_MS = 10_000;
export const MAX_SEATS = 9;
/** SPEC §2.7: players have 5 s to accept running it twice. */
export const RIT_DECISION_MS = 5_000;
/** A player who drops out while using their time bank gets this long to come back. */
export const DISCONNECT_GRACE_MS = 15_000;
/** Visitors who never sat are forgotten once a table has this many players on record... */
export const PRUNE_PLAYERS_AT = 200;
/** ...and a table refuses new browsers beyond this. */
export const MAX_PLAYERS = 500;
/** Chat: messages kept, and at most one message a second per player. */
export const CHAT_KEEP = 100;
export const CHAT_MIN_GAP_MS = 1_000;
/** Wrong join codes allowed per player before they're locked out. */
export const MAX_CODE_ATTEMPTS = 10;

/** An error the player caused; its message is shown to them. */
export class TableError extends Error {
  override name = "TableError";
}

export interface PlayerRecord {
  playerId: string;
  /** Secret. Never leaves the server. */
  token: string;
  notice: string | null;
  /** Entered the table's join code. */
  admitted?: boolean;
  /** Wrong join codes so far. */
  codeAttempts?: number;
}

export interface ChatEntry {
  id: number;
  at: number;
  playerId: string;
  name: string;
  seat: number | null;
  text: string;
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

/**
 * "waitingForPlayers": fewer than 2 active players between hands (SPEC §4).
 * "error": a hand was cancelled after an unexpected server error.
 */
export type PausedReason = "waitingForPlayers" | "error" | null;

/** The timers that can wake a TableRoom. */
export type AlarmTimer = "turn" | "nextHand" | "runItTwice" | "discard" | "idleDelete";

export interface TurnTimer {
  seat: number;
  decisionDeadline: number;
  bankDeadline: number;
  /** The player was connected at the decision deadline and is using their time bank. */
  inBank?: boolean;
  /** They dropped out while in the bank: auto-act at this time unless they're back. */
  graceDeadline?: number | null;
}

export interface LastHand {
  number: number;
  bombPot: boolean;
  hiLo: boolean;
  /** The hand's grid board, if any. (Absent on hands saved before Tic-Tac-Toe.) */
  grid?: BoardGrid | null;
  boards: Card[][];
  /** Each pot split into slices (board × high/low); see the engine's PotSlice. */
  pots: { amount: number; slices: PotSlice[] }[];
  /** One label per board. */
  shown: {
    seat: number;
    nickname: string;
    cards: Card[];
    labels: string[];
    secondRunLabels: string[] | null;
    /** The high hand's 5 cards per board. (Absent on hands saved before this existed.) */
    best?: Card[][];
    secondRunBest?: Card[][] | null;
  }[];
  /** The second run's boards, when run twice. */
  secondRun: Card[][] | null;
  /** Rabbit-hunted cards per board, once a seated player asked (SPEC §2.8). */
  rabbit: { boards: Card[][]; by: string } | null;
  /** Cards players chose to show after the hand, in order. (Absent on hands saved before this existed.) */
  showed?: { seat: number; nickname: string; cards: Card[] }[];
  /** When the hand ended. */
  endedAt?: number;
  /** House rule: the 7-2 bounty paid for this hand, if any. */
  bounty?: { seat: number; nickname: string; amount: number } | null;
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
  /** Why the table is paused, when it wasn't the owner's choice. */
  pausedReason: PausedReason;
  endRequested: boolean;
  handNumber: number;
  button: number | null;
  hand: HandState | null;
  turn: TurnTimer | null;
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
  /** Who was connected at the last syncPresence(), to spot presence changes. */
  presence: string[];
  /** Table chat, oldest first, at most CHAT_KEEP. (Absent on tables from before chat.) */
  chat?: ChatEntry[];
  chatSeq?: number;
  /** Kicked and blocked: can't ask for a seat, chat or watch until unblocked. */
  blocked?: { playerId: string; nickname: string }[];
  /** Needed to watch or ask for a seat, when set. Owner only in views. */
  joinCode?: string | null;
  /** History index, statistics and highlights for the session (see session.ts). */
  session?: SessionData;
  /** Mixed games: which game in the rotation, and hands left in its orbit. */
  mix?: { index: number; handsLeft: number };
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
    pausedReason: null,
    endRequested: false,
    handNumber: 0,
    button: null,
    hand: null,
    turn: null,
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
    presence: [],
    chat: [],
    chatSeq: 0,
    blocked: [],
    joinCode: null,
  };
}

/** Kicked and blocked by the owner. */
export function isBlocked(d: TableData, playerId: string): boolean {
  return (d.blocked ?? []).some((b) => b.playerId === playerId);
}

/** The table has a join code this player hasn't entered (the owner and seated players never need it). */
export function needsCode(d: TableData, playerId: string): boolean {
  if (!d.joinCode || playerId === d.ownerId || d.seats.some((s) => s?.playerId === playerId)) return false;
  return !d.players.find((p) => p.playerId === playerId)?.admitted;
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
      if (this.data.players.length >= PRUNE_PLAYERS_AT) this.prunePlayers();
      if (this.data.players.length >= MAX_PLAYERS) throw new TableError("This table has too many visitors");
      p = { playerId: randomId(12, this.deps.random), token, notice: null };
      this.data.players.push(p);
    }
    return p.playerId;
  }

  /**
   * Forgets browsers that only ever looked: not connected, never seated or in
   * the ledger, not the owner, no request pending. Keeps the stored table small
   * however many people open the link.
   */
  private prunePlayers() {
    const d = this.data;
    const keep = new Set<string>([
      d.ownerId,
      ...d.requests.map((r) => r.playerId),
      ...this.deps.connected,
      // Forgetting a blocked player would quietly unblock them.
      ...(d.blocked ?? []).map((b) => b.playerId),
    ]);
    for (const s of d.seats) if (s) keep.add(s.playerId);
    for (const e of d.ledger) keep.add(e.playerId);
    d.players = d.players.filter((p) => keep.has(p.playerId));
  }

  /**
   * Recovers from an unexpected error (a bug, not a player's mistake): cancels
   * the hand in progress, puts every stack back to where it was when the hand
   * started, and pauses the table so it can't fail the same way on the next
   * timer. The owner presses Start to carry on.
   */
  recover(): void {
    const d = this.data;
    const started = d.handRecord?.record.input.players ?? [];
    if (d.hand) {
      for (const p of started) {
        const seat = this.seat(p.seat);
        if (seat) seat.stack = p.stack;
      }
    }
    d.hand = null;
    d.handRecord = null;
    d.turn = null;
    d.ritDeadline = null;
    d.discardDeadline = null;
    d.fairness = null;
    this.pause("error");
  }

  handle(playerId: string, m: Exclude<ClientMessage, { type: "hello" | "getReplay" }>): void {
    const player = this.player(playerId);
    player.notice = null;
    // Chat and the join code still work once a game has ended.
    if (m.type === "chat") return this.chat(playerId, m.text);
    if (m.type === "enterJoinCode") return this.enterJoinCode(player, m.code);
    if (this.data.status === "ended") throw new TableError("This game has ended");
    if (m.type === "requestSeat" || m.type === "requestRebuy") this.requireWelcome(playerId);

    switch (m.type) {
      case "requestSeat":
        return this.requestSeat(playerId, m.seat, m.nickname, m.buyIn, m.postBlind);
      case "cancelRequest":
        this.data.requests = this.data.requests.filter((r) => r.playerId !== playerId);
        return;
      case "requestRebuy":
        return this.requestRebuy(playerId, m.amount);
      case "act":
        return this.act(playerId, m.hand, m.action, m.seq);
      case "setAway": {
        const seat = this.requireSeated(playerId);
        seat.away = m.away;
        if (!m.away) this.maybeHandOffOwnership();
        this.afterChange();
        return;
      }
      case "leaveSeat":
        return this.leave(this.requireSeatNumber(playerId), "leave");
      case "runItTwice":
        return this.answerRunItTwice(playerId, m.hand, m.accept);
      case "rabbitHunt":
        return this.rabbitHunt(playerId, m.hand);
      case "showCards":
        return this.showCards(playerId, m.hand, m.cards);
      case "discard":
        return this.discard(playerId, m.hand, m.card, m.seq);
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
        const n = this.requireSeatNumber(m.playerId);
        if (m.block) {
          const blocked = (this.data.blocked ??= []);
          if (!blocked.some((b) => b.playerId === m.playerId)) {
            blocked.push({ playerId: m.playerId, nickname: this.seat(n)!.nickname });
          }
        }
        return this.leave(n, "kick");
      }
      case "unblock":
        this.data.blocked = (this.data.blocked ?? []).filter((b) => b.playerId !== m.playerId);
        return;
      case "setJoinCode":
        this.data.joinCode = m.code;
        return;
      case "transferOwnership":
        this.requireSeated(m.playerId);
        this.data.ownerId = m.playerId;
        this.data.ownerOfflineSince = null;
        return;
      case "startGame":
        if (this.activeCount() < 2) {
          throw new TableError("Waiting for players: 2 seated players who aren't away are needed to start");
        }
        this.data.status = "running";
        this.data.pausedReason = null;
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

  // -------------------------------------------------------------------------
  // Chat, blocking and the join code
  // -------------------------------------------------------------------------

  private requireWelcome(playerId: string) {
    if (isBlocked(this.data, playerId)) throw new TableError("The owner has removed you from this table");
    if (needsCode(this.data, playerId)) throw new TableError("Enter the table's join code first");
  }

  private enterJoinCode(player: PlayerRecord, code: string) {
    if (!needsCode(this.data, player.playerId)) return;
    if ((player.codeAttempts ?? 0) >= MAX_CODE_ATTEMPTS) throw new TableError("Too many wrong codes. Ask the owner for the link again.");
    if (code.trim().toLowerCase() !== this.data.joinCode!.toLowerCase()) {
      player.codeAttempts = (player.codeAttempts ?? 0) + 1;
      throw new TableError("That code isn't right");
    }
    player.admitted = true;
  }

  private chat(playerId: string, text: string) {
    const d = this.data;
    if (!d.settings.chat) throw new TableError("Chat is turned off");
    this.requireWelcome(playerId);
    const n = this.seatNumberOf(playerId);
    if (n === null && !d.settings.spectators && playerId !== d.ownerId) throw new TableError("Take a seat to chat");
    const chat = (d.chat ??= []);
    const mineLast = chat.findLast((c) => c.playerId === playerId);
    if (mineLast && this.now - mineLast.at < CHAT_MIN_GAP_MS) throw new TableError("Slow down: one message a second");
    d.chatSeq = (d.chatSeq ?? 0) + 1;
    chat.push({
      id: d.chatSeq,
      at: this.now,
      playerId,
      name: n !== null ? this.seat(n)!.nickname : playerId === d.ownerId ? "Owner" : "Watcher",
      seat: n,
      text: text.trim(),
    });
    if (chat.length > CHAT_KEEP) chat.splice(0, chat.length - CHAT_KEEP);
  }

  /** Runs whatever is due: turn timeouts, the next hand, owner hand-off. */
  tick(): void {
    const d = this.data;
    // Someone leaving or kicked mid-hand doesn't hold the hand up: they check or fold at once.
    for (let guard = 0; d.hand && d.turn && this.seat(d.turn.seat)?.leaving && guard < MAX_SEATS; guard++) {
      this.timeout(d.turn, false);
    }
    const turn = d.turn;
    if (d.hand && turn && this.now >= turn.decisionDeadline) {
      const seat = this.seat(turn.seat)!;
      const connected = this.deps.connected.has(seat.playerId);
      if (connected) {
        // Connected players dip into their time bank.
        turn.inBank = true;
        turn.graceDeadline = null;
        if (this.now >= turn.bankDeadline) this.timeout(turn, true);
      } else if (!turn.inBank) {
        // Disconnected at the deadline: no time bank (SPEC §4).
        this.timeout(turn, false);
      } else if (turn.graceDeadline == null) {
        // Dropped out while in the bank: a short grace to reconnect, not an instant fold.
        turn.graceDeadline = Math.min(turn.bankDeadline, this.now + DISCONNECT_GRACE_MS);
      } else if (this.now >= turn.graceDeadline) {
        this.timeout(turn, true);
      }
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
        const hole = d.hand.players.find((p) => p.seat === seat)!.hole;
        this.applyEngine({ type: "discard", seat, card: lowestCard(hole) });
      }
      this.afterAction();
    }
    if (!d.hand && d.nextHandAt !== null && this.now >= d.nextHandAt) this.startNextHand();
  }

  /** Call after connections change. */
  syncPresence(): void {
    const d = this.data;
    const { connected } = this.deps;
    if (connected.has(d.ownerId)) d.ownerOfflineSince = null;
    else d.ownerOfflineSince ??= this.now;
    if (connected.size > 0) d.emptySince = null;
    else d.emptySince ??= this.now;
    // SPEC §4: re-check the owner hand-off when someone connects or disconnects
    // (TableRoom calls this on every change, so compare with the last snapshot).
    const now = [...connected].sort();
    const changed = now.join(",") !== (d.presence ?? []).join(",");
    d.presence = now;
    if (changed) this.maybeHandOffOwnership();
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
      let at = this.now < d.turn.decisionDeadline ? d.turn.decisionDeadline : d.turn.bankDeadline;
      if (d.turn.graceDeadline != null) at = Math.min(at, d.turn.graceDeadline);
      due.push({ at, timer: "turn" });
    }
    // tick() only starts a hand between hands.
    if (!d.hand && d.nextHandAt !== null) due.push({ at: d.nextHandAt, timer: "nextHand" });
    if (d.hand?.ritOffer && d.ritDeadline !== null) due.push({ at: d.ritDeadline, timer: "runItTwice" });
    if (d.hand?.discard && d.discardDeadline !== null) due.push({ at: d.discardDeadline, timer: "discard" });
    // (Owner hand-off has no timer: it's checked on presence changes, "I'm
    // back" and hand end. SPEC §4.)
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
    // A new rotation starts from its first game.
    if ((settings.mixedGames ?? []).join() !== (d.settings.mixedGames ?? []).join()) d.mix = undefined;
    d.settings = settings;
    d.pendingSettings = null;
    d.requests = d.requests.filter((r) => r.seat === null || r.seat <= settings.seats);
    for (const s of d.seats) if (s) s.timeBankMs = Math.min(s.timeBankMs, settings.timeBankSec * 1000);
  }

  private pause(reason: PausedReason = null) {
    this.data.status = "paused";
    this.data.pausedReason = reason;
    this.data.pauseRequested = false;
    this.data.nextHandAt = null;
  }

  /** Seated players who could be dealt in: not away, with chips (SPEC §4). */
  private activeCount(): number {
    return this.data.seats.filter((s) => s && !s.away && s.stack > 0).length;
  }

  private end() {
    const d = this.data;
    d.status = "ended";
    d.endRequested = false;
    d.pauseRequested = false;
    d.nextHandAt = null;
    d.requests = [];
  }

  /**
   * Between hands: with fewer than 2 active players, pause until the owner
   * presses Start again (SPEC §4); otherwise deal when ready.
   */
  private afterChange() {
    const d = this.data;
    if (d.status !== "running" || d.hand) return;
    if (this.activeCount() < 2) {
      this.pause("waitingForPlayers");
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

  /**
   * Hands ownership over once the owner has been offline 5 minutes and an
   * eligible player is here. Event-driven only: called on presence changes,
   * "I'm back" and at hand end, never from a timer.
   */
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
    if (active.length < 2) {
      this.pause("waitingForPlayers");
      return;
    }

    const button = nextButton(d.button, active.map((x) => x.seat));
    const bombPot = isBombPotHand(d.settings, d.handNumber + 1);
    // Deal in the first waiting player who would be the big blind this hand.
    const waiting = eligible.filter((x) => x.s.waitingForBB);
    const admitted = waiting.find((w) => bigBlindSeat([...active, w].map((x) => x.seat), button) === w.seat);
    // SPEC §1: in a bomb pot every player who isn't away antes, so nobody
    // waits for the big blind (there isn't one).
    const dealt = bombPot ? eligible : admitted ? [...active, admitted] : active;

    this.rotateMixedGame(dealt.length);
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

  /**
   * After a hand, until the next deal: a player who was dealt in and wasn't
   * shown down reveals some or all of the cards they held (SPEC §7). Only
   * cards they actually held at the end (so never a Pineapple discard).
   */
  private showCards(playerId: string, hand: number, cardTexts: string[]) {
    const d = this.data;
    if (d.hand || !d.lastHand || d.lastHand.number !== hand || d.handNumber !== hand) throw new TableError("That hand is over");
    const allowed = showableCards(d, playerId);
    if (allowed.length === 0) throw new TableError("You have no cards to show");
    const chosen = cardTexts.map(parseCard);
    if (chosen.some((c) => !allowed.includes(c))) throw new TableError("You can only show cards you held and haven't shown");
    const who = d.prevRecord!.players.find((p) => p.playerId === playerId)!;
    d.lastHand.showed = [...(d.lastHand.showed ?? []), { seat: who.seat, nickname: who.nickname, cards: chosen }];
    const held = d.prevHand?.players.find((p) => p.seat === who.seat)?.hole ?? [];
    const won = (d.prevHand?.result?.payouts ?? []).some((p) => p.seat === who.seat && p.amount > 0);
    const shownByThem = d.lastHand.showed.filter((x) => x.seat === who.seat).flatMap((x) => x.cards);
    noteShownCards(d, who.nickname, held, shownByThem, won);
    // The 7-2 game: a winner without a showdown collects once they've shown both cards.
    if (held.every((c) => shownByThem.includes(c))) this.paySevenDeuce(who.seat);
    // Nobody left who could show: back to the normal gap between hands.
    if (d.nextHandAt !== null && !anyoneCanShow(d) && d.lastHand.endedAt !== undefined) {
      d.nextHandAt = Math.min(d.nextHandAt, Math.max(this.now, d.lastHand.endedAt + AUTO_START_DELAY_MS));
    }
  }

  private discard(playerId: string, hand: number, cardText: string, seq?: number) {
    const d = this.data;
    if (!d.hand || hand !== d.handNumber) throw new TableError("That hand is over");
    this.checkSeq(seq);
    if (!d.hand.discard) throw new TableError("Nobody is discarding now");
    const n = this.seatNumberOf(playerId);
    if (n === null || !d.hand.discard.pending.includes(n)) throw new TableError("You have nothing to discard");
    const card = parseCard(cardText);
    if (!d.hand.players.find((p) => p.seat === n)!.hole.includes(card)) throw new TableError("You don't hold that card");
    this.applyEngine({ type: "discard", seat: n, card });
    this.afterAction();
  }

  /** Applies an engine action to the current hand and records it for the replay. */
  private applyEngine(action: PlayerAction) {
    const d = this.data;
    d.hand = applyAction(d.hand!, action);
    d.handRecord?.record.actions.push(action);
  }

  private act(playerId: string, hand: number, action: Extract<ClientMessage, { type: "act" }>["action"], seq?: number) {
    const d = this.data;
    if (!d.hand || hand !== d.handNumber) throw new TableError("That hand is over");
    this.checkSeq(seq);
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
    this.afterAction();
  }

  /**
   * The client sends the log length it saw; anything older was sent before
   * the hand moved on (a double tap, a slow network) and is dropped, so it
   * can't land on the next player's turn or the next street.
   */
  private checkSeq(seq: number | undefined) {
    if (seq !== undefined && seq !== this.data.hand!.log.length) throw new TableError(STALE_ACTION);
  }

  /**
   * House rule, mixed games: each game in the rotation lasts one orbit (as
   * many hands as players dealt in when it began), then the next one starts.
   * The current game shows as the table's game.
   */
  private rotateMixedGame(players: number) {
    const d = this.data;
    const list = d.settings.mixedGames ?? [];
    if (list.length < 2) {
      d.mix = undefined;
      return;
    }
    if (!d.mix) {
      d.mix = { index: Math.max(0, list.indexOf(d.settings.variant)), handsLeft: players };
    } else if (d.mix.handsLeft <= 0) {
      d.mix = { index: (d.mix.index + 1) % list.length, handsLeft: players };
    }
    d.settings = { ...d.settings, variant: list[d.mix.index % list.length]! };
    d.mix.handsLeft--;
  }

  /**
   * House rule, the 7-2 game: if this seat won a pot holding 7-2 offsuit
   * (shown at showdown, or shown afterwards), every other player dealt in
   * pays them the bounty, as far as their stack goes. At most once a hand.
   */
  private paySevenDeuce(seat: number) {
    const d = this.data;
    const last = d.lastHand;
    const hand = d.prevHand;
    const rec = d.prevRecord;
    const bbs = d.settings.sevenDeuceBB ?? 0;
    if (!last || !hand?.result || !rec || last.bounty || bbs <= 0 || last.number !== rec.hand) return;
    const v = hand.config.variant;
    if (v.holeCards !== 2 || v.deckSize !== 52) return;
    const hole = hand.players.find((p) => p.seat === seat)?.hole ?? [];
    const ranks = hole.map(rankOf).sort((a, b) => a - b);
    if (hole.length !== 2 || ranks[0] !== 2 || ranks[1] !== 7 || suitOf(hole[0]!) === suitOf(hole[1]!)) return;
    if (!hand.result.payouts.some((p) => p.seat === seat && p.amount > 0)) return;
    const winnerId = rec.players.find((p) => p.seat === seat)?.playerId;
    const winner = this.seat(seat);
    if (!winner || winner.playerId !== winnerId) return;
    const each = bbs * hand.config.bigBlind;
    let total = 0;
    for (const other of rec.players) {
      if (other.seat === seat) continue;
      const s = this.seat(other.seat);
      if (!s || s.playerId !== other.playerId) continue;
      const amount = Math.min(each, s.stack);
      s.stack -= amount;
      winner.stack += amount;
      total += amount;
      adjustNet(d, s.playerId, -amount);
    }
    adjustNet(d, winner.playerId, total);
    last.bounty = { seat, nickname: winner.nickname, amount: total };
  }

  /** Time's up: check if free, otherwise fold. */
  private timeout(turn: TurnTimer, connected: boolean) {
    const d = this.data;
    const seat = this.seat(turn.seat)!;
    if (connected) seat.timeBankMs = 0;
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
    // Before the last hand moves on: history, statistics, and the outgoing hand's record for storage.
    recordHand(d, hand, d.handRecord, this.now);
    for (const p of hand.players) this.seat(p.seat)!.stack = p.stack;
    d.lastHand = {
      number: d.handNumber,
      bombPot: hand.bombPot,
      hiLo: hand.config.variant.split === "hilo",
      grid: hand.config.variant.board.grid ?? null,
      boards: hand.boards,
      pots: result.pots.map(({ amount, slices }) => ({ amount, slices })),
      shown: result.showdown.map(({ seat, hole, boards, secondRun }) => ({
        seat,
        nickname: this.seat(seat)!.nickname,
        cards: hole,
        labels: hand.boards.map((board) => handLabel(hand.config.variant, hole, board).text),
        secondRunLabels: hand.secondRun?.map((board) => handLabel(hand.config.variant, hole, board).text) ?? null,
        best: boards.map((b) => b.high.cards),
        secondRunBest: secondRun?.map((b) => b.high.cards) ?? null,
      })),
      secondRun: hand.secondRun,
      rabbit: null,
      showed: [],
      endedAt: this.now,
    };
    d.prevHand = hand;
    d.prevRecord = d.handRecord ?? null;
    d.handRecord = null;
    // The 7-2 game: a winner holding 7-2 offsuit at showdown collects now.
    for (const h of result.showdown) this.paySevenDeuce(h.seat);
    d.hand = null;
    d.turn = null;
    d.ritDeadline = null;
    d.discardDeadline = null;

    // SPEC §4: anyone seated who is disconnected as the hand ends sits out
    // from the next one. (Mid-hand they just time out.) Reconnecting doesn't
    // clear this; they tap "I'm back".
    for (const s of d.seats) if (s && !this.deps.connected.has(s.playerId)) s.away = true;
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

    // SPEC §4: an offline owner hands over to someone still here.
    this.maybeHandOffOwnership();

    if (d.endRequested) this.end();
    else if (this.activeCount() < 2) this.pause("waitingForPlayers");
    else if (d.pauseRequested || !d.settings.autoStart) this.pause();
    else {
      // A little longer while someone can still show their cards.
      d.nextHandAt = this.now + (anyoneCanShow(d) ? SHOW_WINDOW_MS : AUTO_START_DELAY_MS);
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
    // The hand that was played: the settings may have changed since.
    last.boards[0]!.length < boardSize(d.prevHand.config.variant.board)
  );
}

/**
 * The cards `playerId` may still show from the last hand: we're between hands,
 * they were dealt in, their hand wasn't shown down, and they haven't shown
 * these yet. Their cards as held at the end, so Pineapple discards never count.
 */
export function showableCards(d: TableData, playerId: string): Card[] {
  const { lastHand: last, prevHand: prev, prevRecord: rec } = d;
  if (d.hand || !last || !prev || !rec || rec.hand !== last.number || last.number !== d.handNumber) return [];
  const seat = rec.players.find((p) => p.playerId === playerId)?.seat;
  if (seat === undefined || last.shown.some((s) => s.seat === seat)) return [];
  const held = prev.players.find((p) => p.seat === seat)?.hole ?? [];
  const already = new Set((last.showed ?? []).filter((s) => s.seat === seat).flatMap((s) => s.cards));
  return held.filter((c) => !already.has(c));
}

/** Whether anyone dealt into the last hand may still show cards. */
export function anyoneCanShow(d: TableData): boolean {
  return !!d.prevRecord && d.prevRecord.players.some((p) => showableCards(d, p.playerId).length > 0);
}

/** The big blind seat for a hand dealt to `seats` (sorted or not) with this button. */
export function bigBlindSeat(seats: number[], button: number): number {
  const sorted = seats.slice().sort((a, b) => a - b);
  const b = sorted.indexOf(button);
  return sorted.length === 2 ? sorted[(b + 1) % 2]! : sorted[(b + 2) % sorted.length]!;
}
