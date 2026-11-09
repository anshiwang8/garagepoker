/**
 * The client <-> server WebSocket protocol, shared by apps/server and apps/web.
 *
 * Every client message is validated with `clientMessageSchema` on the server
 * before it reaches any game logic. Server messages are plain types: the
 * server builds them, so they need no runtime validation.
 *
 * All chip amounts are integer cents. Cards are strings like "As", "Td".
 */
import {
  BOMB_POT_MODES,
  type BoardGrid,
  type BombPotMode,
  RUN_IT_TWICE_MODES,
  type RunItTwiceMode,
  type LedgerRow,
  type LegalActions,
  type LogType,
  type Payment,
  type Street,
  type TableSettings,
  VARIANT_NAMES,
  type VariantName,
} from "@garagepoker/engine";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** The error for an action sent before the hand moved on (a double tap). Clients don't show it. */
export const STALE_ACTION = "That action was already handled";

/** Chips in integer cents. Capped well below 2^53 so sums stay exact. */
export const cents = z.number().int().min(0).max(1e13);
export const positiveCents = cents.min(1);
/** Random per-browser secret. Owns the seat; never shown to other players. */
export const playerToken = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
/** Public, server-generated player id. Safe to show to everyone. */
export const playerId = z.string().regex(/^[A-Za-z0-9]{12}$/);
export const requestId = z.string().regex(/^[A-Za-z0-9]{12}$/);
export const tableId = z.string().regex(/^[A-Za-z0-9]{10}$/);
export const seatNumber = z.number().int().min(1).max(9);
export const nickname = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[^<>]*$/, "Nickname can't contain < or >");

export const settingsSchema = z
  .object({
    variant: z.enum(VARIANT_NAMES as [VariantName, ...VariantName[]]),
    smallBlind: cents,
    bigBlind: positiveCents,
    ante: cents,
    seats: z.number().int(),
    boards: z.union([z.literal(1), z.literal(2)]),
    bombPotMode: z.enum(BOMB_POT_MODES as [BombPotMode, ...BombPotMode[]]),
    bombPotEvery: z.number().int(),
    bombPotAnteBB: z.number().int(),
    runItTwice: z.enum(RUN_IT_TWICE_MODES as [RunItTwiceMode, ...RunItTwiceMode[]]),
    rabbitHunt: z.boolean(),
    spectators: z.boolean(),
    straddle: z.boolean(),
    decisionTimeSec: z.number().int(),
    timeBankSec: z.number().int(),
    autoStart: z.boolean(),
    rebuys: z.boolean(),
    displayCents: z.boolean(),
    // Newer settings default on, so clients from before they existed keep working.
    chat: z.boolean().default(true),
    revealAllIn: z.boolean().default(true),
    sevenDeuceBB: z.number().int().default(0),
    mixedGames: z.array(z.enum(VARIANT_NAMES as [VariantName, ...VariantName[]])).max(8).default([]),
    redRiver: z.boolean().default(false),
  })
  .strict() satisfies z.ZodType<TableSettings, unknown>;

/** A table join code: 4–12 letters or digits. */
export const joinCode = z.string().regex(/^[A-Za-z0-9]{4,12}$/, "4 to 12 letters or digits");

// ---------------------------------------------------------------------------
// HTTP: create a table
// ---------------------------------------------------------------------------

/** POST /api/tables. Missing settings fall back to the defaults. */
export const createTableSchema = z
  .object({
    token: playerToken,
    settings: settingsSchema.partial().optional(),
  })
  .strict();
export type CreateTableRequest = z.infer<typeof createTableSchema>;
export interface CreateTableResponse {
  tableId: string;
}

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

const msg = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), ...shape }).strict();

export const playerActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fold") }).strict(),
  z.object({ type: z.literal("check") }).strict(),
  z.object({ type: z.literal("call") }).strict(),
  /** Bet or raise to a total street bet of `to`. */
  z.object({ type: z.literal("raise"), to: positiveCents }).strict(),
]);

export const clientMessageSchema = z.discriminatedUnion("type", [
  /** Must be the first message on a connection. */
  msg("hello", { token: playerToken }),

  // Players
  msg("requestSeat", {
    seat: seatNumber,
    nickname,
    buyIn: positiveCents,
    /** Post a big blind to play the next hand instead of waiting for the BB. */
    postBlind: z.boolean(),
  }),
  msg("cancelRequest", {}),
  msg("requestRebuy", { amount: positiveCents }),
  /** `hand` guards against acting on a hand that already ended. */
  /**
   * `seq` is the hand's log length the client saw (`hand.log.length`). The
   * server ignores the action if the hand has moved on, so a double tap can't
   * act twice. Optional so older clients keep working.
   */
  msg("act", { hand: z.number().int().min(1), seq: z.number().int().min(0).optional(), action: playerActionSchema }),
  msg("setAway", { away: z.boolean() }),
  msg("leaveSeat", {}),
  /** Answer the run-it-twice prompt (anyone in the pot, within 5 s). */
  msg("runItTwice", { hand: z.number().int().min(1), accept: z.boolean() }),
  /** After a hand that ended before its board was finished: show what would have come. */
  msg("rabbitHunt", { hand: z.number().int().min(1) }),
  /**
   * After a hand, until the next deal: show some or all of the cards you held
   * (if they weren't already shown at showdown). Final once sent.
   */
  msg("showCards", {
    hand: z.number().int().min(1),
    cards: z
      .array(z.string().regex(/^[2-9TJQKA][cdhs]$/))
      .min(1)
      .max(5)
      .refine((cs) => new Set(cs).size === cs.length, "Each card once"),
  }),
  /** Pineapple: discard one of your cards (face down, everyone at once). */
  msg("discard", { hand: z.number().int().min(1), seq: z.number().int().min(0).optional(), card: z.string().regex(/^[2-9TJQKA][cdhs]$/) }),
  /** Ask for a finished hand's replay (the last one if `hand` is left out); answered to you only. */
  msg("getReplay", { hand: z.number().int().min(1).optional() }),
  /** The session's hands, newest first; answered to you only. */
  msg("getHistory", {}),
  /** Your permitted history of the session as text (your cards, and cards that were shown); answered to you only. */
  msg("exportHistory", {}),
  /** Table chat (SPEC §5): seated players, and spectators where they can watch. */
  msg("chat", { text: z.string().trim().min(1).max(200) }),
  /** Unlock a table that has a join code. */
  msg("enterJoinCode", { code: z.string().max(12) }),

  // Owner only
  msg("approveRequest", { requestId, stack: positiveCents }),
  msg("declineRequest", { requestId }),
  msg("updateSettings", { settings: settingsSchema }),
  msg("adjustStack", { playerId, op: z.enum(["add", "remove", "set"]), amount: cents }),
  /** `block`: they can't ask for a seat, chat or watch again until unblocked. */
  msg("kick", { playerId, block: z.boolean().optional() }),
  msg("unblock", { playerId }),
  /** Require a code to watch or ask for a seat (null removes it). Seated players aren't affected. */
  msg("setJoinCode", { code: joinCode.nullable() }),
  msg("transferOwnership", { playerId }),
  msg("startGame", {}),
  msg("pauseGame", {}),
  msg("endGame", {}),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage["type"];

/** Largest client message the server will parse, in bytes. */
export const MAX_CLIENT_MESSAGE_BYTES = 4096;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: "view"; view: TableView }
  /** Answer to getReplay; null when there's no finished hand to replay. */
  | { type: "replay"; replay: ReplayView | null }
  | { type: "history"; entries: HistoryEntryView[] }
  | { type: "historyExport"; text: string }
  | { type: "error"; message: string; for?: ClientMessageType };

export type TableStatus = "paused" | "running" | "ended";

export interface TableView {
  tableId: string;
  /** Increments on every committed change. Ignore a view with a lower rev than one you have. */
  rev: number;
  /** Server clock when the view was built; use it to show countdowns. */
  serverNow: number;
  status: TableStatus;
  /** Owner pressed Pause / End; takes effect after this hand. */
  pauseRequested: boolean;
  /**
   * "waitingForPlayers": paused automatically because fewer than 2 seated
   * players are active between hands. Only the owner can press Start.
   */
  /** "error": a hand was cancelled after a server error, stacks restored. */
  pausedReason: "waitingForPlayers" | "error" | null;
  endRequested: boolean;
  settings: TableSettings;
  /** Settings saved during a hand, applied from the next one. */
  pendingSettings: TableSettings | null;
  handNumber: number;
  buttonSeat: number | null;
  you: YouView;
  /** Index 0 is seat 1. Length = settings.seats. */
  seats: (SeatView | null)[];
  hand: HandView | null;
  lastHand: LastHandView | null;
  /** Pending seat and rebuy requests. Owner only; null for everyone else. */
  requests: RequestView[] | null;
  ledger: LedgerRow[];
  /** Once the game has ended: the fewest payments that settle the ledger (SPEC §6). */
  settlement: Payment[] | null;
  /** How many connected people are watching without a seat. */
  spectators: number;
  /** The latest chat messages, oldest first; null when chat is off or you can't watch. */
  chat: ChatView[] | null;
  /** Owner only: players blocked after a kick (null for everyone else). */
  blocked: { playerId: string; nickname: string }[] | null;
  /** Owner only: the table's join code, if it has one. */
  joinCode: string | null;
  /** Session statistics and highlights (null if you can't watch). */
  session: SessionView | null;
}

export interface SessionView {
  /** Hands finished this session (up to the last 200). */
  hands: number;
  /** One row per player who's been dealt in, best net first. */
  stats: StatsRowView[];
  highlights: HighlightView[];
}

export interface StatsRowView {
  nickname: string;
  hands: number;
  /** Voluntarily put chips in preflop, % of hands with preflop betting (not bomb pots). Null before any. */
  vpip: number | null;
  /** Raised preflop, % of the same hands. */
  pfr: number | null;
  showdowns: number;
  showdownWins: number;
  potsWon: number;
  biggestPot: number;
  net: number;
}

export interface HighlightView {
  kind: "biggestPot" | "bestHand" | "comeback" | "rareHand" | "shownBluff";
  hand: number;
  title: string;
  detail: string;
  amount: number | null;
}

/** One finished hand in the history list. */
export interface HistoryEntryView {
  hand: number;
  endedAt: number;
  variant: VariantName;
  pot: number;
  winners: string[];
  /** The best hand shown at showdown, if any. */
  best: string | null;
  /** Your result, if you were dealt in. */
  yourNet: number | null;
}

export interface ChatView {
  id: number;
  at: number;
  /** The sender's nickname, or "Watcher" for someone without a seat. */
  name: string;
  seat: number | null;
  text: string;
  mine: boolean;
}

export interface YouView {
  playerId: string;
  isOwner: boolean;
  /** The owner removed you: you can't ask for a seat, chat or watch. */
  blocked: boolean;
  /** The table has a join code you haven't entered yet. */
  codeRequired: boolean;
  seat: number | null;
  /** Your pending request, if any. */
  request: RequestView | null;
  /** One-off message, e.g. "Your seat request was declined." */
  notice: string | null;
  /** What you may do; set only when it's your turn. */
  legal: LegalActions | null;
  /**
   * Your current hand label, one per board: "Pair", or in Hi/Lo both
   * halves: "Flush / 8-6 low". Null if you're not in the hand.
   */
  labels: string[] | null;
  /**
   * The owner turned spectators off and you have no seat: game details are
   * hidden until you sit down.
   */
  watchBlocked: boolean;
  /**
   * Between hands: your cards from the last hand that you may still show
   * (you were dealt in, they weren't shown at showdown). Null otherwise.
   */
  showable: string[] | null;
}

export interface SeatView {
  seat: number;
  playerId: string;
  nickname: string;
  stack: number;
  isOwner: boolean;
  connected: boolean;
  away: boolean;
  waitingForBB: boolean;
  /** Leaving or kicked after this hand. */
  leaving: boolean;
  timeBankMs: number;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  bet: number;
  /** Hole cards: strings you may see, null for face-down cards. Null if not in the hand. */
  cards: (string | null)[] | null;
  lastAction: { type: LogType; amount: number; to?: number } | null;
}

/** One line of a hand's action log. Public: a discard never says which card. */
export interface LogEntryView {
  street: Street;
  seat: number;
  type: LogType;
  /** Chips moved: out of the stack, or back into it for "uncalled". */
  amount: number;
  /** For bet / raise: the player's total bet on the street. */
  to?: number;
  allIn?: boolean;
  /** Set when `street` is "extra": the red river round (1, 2, …). */
  extraRound?: number;
}

/** The log/replay note when the deck can't spare another red river card (spec 4.4). */
export const RED_RIVER_STOPS = "No cards left: red river stops.";

/** "Flop", or "Red river 2" for a red river extra round; "" once the hand is complete. */
export function streetTitle(street: Street, extraRound?: number): string {
  switch (street) {
    case "preflop":
      return "Preflop";
    case "flop":
      return "Flop";
    case "turn":
      return "Turn";
    case "river":
      return "River";
    case "extra":
      return extraRound ? `Red river ${extraRound}` : "Red river";
    case "complete":
      return "";
  }
}

export interface HandView {
  number: number;
  street: Street;
  /** The red river round being played (1, 2, …) while `street` is "extra"; 0 before any. */
  extraRound: number;
  /** Red river is on for this hand (settings changed mid-hand apply from the next one). */
  redRiver: boolean;
  /** The deck ran out of cards to spare, so red river stopped (log note: "No cards left: red river stops."). */
  redRiverStopped: boolean;
  /** One board, or two with double board. */
  boards: string[][];
  bombPot: boolean;
  /** All chips in the middle, including bets on this street. */
  pot: number;
  /** Each board's share of the pot (board 1 gets any odd chip). */
  boardShares: number[];
  currentBet: number;
  toAct: number | null;
  /** When the decision time runs out, then when the time bank does. */
  decisionDeadline: number | null;
  bankDeadline: number | null;
  /**
   * Run it twice is being offered: every seat in `seats` must accept before
   * `deadline`; any decline, or the deadline passing, means it runs once.
   */
  ritOffer: { seats: number[]; accepted: number[]; deadline: number } | null;
  /**
   * Pineapple: seats that still owe a discard on this street. Anyone still
   * pending at `deadline` discards their lowest card.
   */
  discard: { seats: number[]; deadline: number } | null;
  /**
   * Provable fairness: committed before any card was dealt (see
   * FairnessProof). Null for a moment while the server computes it.
   */
  commitment: string | null;
  /** Every action so far this hand, in order. */
  log: LogEntryView[];
}

/** One share of a pot: a board (0-based) and a half; both null for an uncontested pot. */
export interface SliceView {
  /** 0-based run (1 = the second run), null for an uncontested pot. */
  run: number | null;
  board: number | null;
  half: "high" | "low" | null;
  amount: number;
  winners: { seat: number; amount: number }[];
}

export interface LastHandView {
  number: number;
  bombPot: boolean;
  /** Red river was on for this hand. */
  redRiver: boolean;
  /** The deck ran out of cards to spare, so red river stopped (log note: "No cards left: red river stops."). */
  redRiverStopped: boolean;
  /** The hand was Hi/Lo (so a board with only a high slice had no qualifying low). */
  hiLo: boolean;
  /** House rule: a 7-2 bounty paid for this hand. */
  bounty: { seat: number; nickname: string; amount: number } | null;
  /** The hand's boards were grids (Tic-Tac-Toe): where each card goes. Null for rows of 5. */
  grid: BoardGrid | null;
  boards: string[][];
  /** Main pot first, then side pots. */
  pots: { amount: number; slices: SliceView[] }[];
  /** Hands shown at showdown, with one label per board. Empty if everyone else folded. */
  shown: {
    seat: number;
    nickname: string;
    cards: string[];
    labels: string[];
    /** Labels on the second run's boards, when run twice. */
    secondRunLabels: string[] | null;
    /** The 5 cards of the high hand played on each board (and on the second run's). */
    best: string[][];
    secondRunBest: string[][] | null;
  }[];
  /** Cards players chose to show after the hand (folded or uncontested hands), in the order shown. */
  showed: { seat: number; nickname: string; cards: string[] }[];
  /** The second run's boards, when run twice. */
  secondRun: string[][] | null;
  /** A seated player can ask to see the rest of the board (rabbit hunt is on and the hand ended early). */
  rabbitAvailable: boolean;
  /**
   * Face-down backs per board to show before a rabbit hunt: the base cards
   * still to come, plus 1 if the board ends red with red river on. Never the
   * exact count of red river cards. Empty when there's nothing to hunt.
   */
  rabbitBacks: number[];
  /** The rabbit-hunted cards per board, once someone asked. Display only. */
  rabbit: { boards: string[][]; by: string } | null;
  /** Everything needed to check this hand's cards against its commitment. */
  fairness: FairnessProof | null;
  /** Each dealt-in seat's result for the hand: chips won minus chips put in (negative for a loss). */
  nets: { seat: number; net: number }[];
  /** Every action in the hand, in order. */
  log: LogEntryView[];
}

export interface RequestView {
  id: string;
  playerId: string;
  kind: "seat" | "rebuy";
  nickname: string;
  seat: number | null;
  amount: number;
  postBlind: boolean;
}

/** Formats a message for sending. */
export function encode(message: ServerMessage | ClientMessage): string {
  return JSON.stringify(message);
}

// ---------------------------------------------------------------------------
// Provable fairness (SPEC §7, per-card commitments)
// ---------------------------------------------------------------------------

/**
 * Before dealing, every deck position i gets its own random salt and a hash
 * SHA-256(salt + ":" + i + ":" + card). The commitment, sent to everyone at
 * hand start, is SHA-256 of all those hashes joined by ",".
 *
 * After the hand every position hash is published, but the salt and card
 * only for cards that became public (boards, both runs, showdown hands, and
 * rabbit cards once hunted). A salted hash says nothing about its card, so
 * folded hands, Pineapple discards and unhunted rabbit cards stay secret,
 * while anyone can check that no visible card changed after the deal.
 */
export interface FairnessProof {
  commitment: string;
  /** One hash per deck position, in deck order. */
  leaves: string[];
  /** Salt and card for each position whose card became public. */
  revealed: { index: number; card: string; salt: string }[];
}

export const fairnessLeafInput = (salt: string, index: number, card: string): string => `${salt}:${index}:${card}`;
export const fairnessRootInput = (leaves: readonly string[]): string => leaves.join(",");
/** The short form shown during a hand. */
export const shortHash = (hash: string): string => hash.slice(0, 8);

/** The cards shown on the table for a finished hand: boards, both runs, shown hands, rabbit cards. */
export function lastHandPublicCards(last: LastHandView): string[] {
  return [
    ...last.boards.flat(),
    ...(last.secondRun?.flat() ?? []),
    ...last.shown.flatMap((s) => s.cards),
    ...last.showed.flatMap((s) => s.cards),
    ...(last.rabbit?.boards.flat() ?? []),
  ];
}

export interface FairnessCheck {
  label: string;
  ok: boolean;
}

/**
 * Checks a hand's proof. `sha256Hex` is Web Crypto in the browser; the server
 * tests pass the same. `publicCards` are the cards shown on the table (board,
 * shown hands, rabbit cards); `commitmentAtStart` is the commitment this
 * client saw when the hand began, if it saw one.
 */
export async function verifyFairness(
  proof: FairnessProof,
  publicCards: readonly string[],
  sha256Hex: (text: string) => Promise<string>,
  commitmentAtStart?: string | null,
): Promise<{ ok: boolean; checks: FairnessCheck[] }> {
  const checks: FairnessCheck[] = [];
  checks.push({
    label: `One committed hash for each of the ${proof.leaves.length} cards in the deck`,
    ok: proof.leaves.length === 52 || proof.leaves.length === 36,
  });
  const root = await sha256Hex(fairnessRootInput(proof.leaves));
  checks.push({ label: "The card hashes combine into the commitment", ok: root === proof.commitment });
  if (commitmentAtStart) {
    checks.push({
      label: `It matches the commitment shown when the hand started (${shortHash(commitmentAtStart)})`,
      ok: commitmentAtStart === proof.commitment,
    });
  }
  let leavesOk = true;
  for (const r of proof.revealed) {
    const leaf = await sha256Hex(fairnessLeafInput(r.salt, r.index, r.card));
    if (leaf !== proof.leaves[r.index]) leavesOk = false;
  }
  checks.push({ label: `Each of the ${proof.revealed.length} revealed cards matches its hash`, ok: leavesOk });
  const indexes = new Set(proof.revealed.map((r) => r.index));
  const cards = new Set(proof.revealed.map((r) => r.card));
  checks.push({
    label: "No card or deck position is revealed twice",
    ok: indexes.size === proof.revealed.length && cards.size === proof.revealed.length,
  });
  const missing = publicCards.filter((c) => !cards.has(c));
  checks.push({
    label: missing.length ? `Cards on the table not in the proof: ${missing.join(" ")}` : "Every card shown on the table was committed before the deal",
    ok: missing.length === 0,
  });
  return { ok: checks.every((c) => c.ok), checks };
}

// ---------------------------------------------------------------------------
// Last-hand replay
// ---------------------------------------------------------------------------

/** What happened between two replay frames. Amounts are integer cents. */
export type ReplayEvent =
  | { kind: "action"; seat: number; type: LogType; amount: number; to?: number; allIn?: boolean }
  /** `extraRound` is set when `street` is "extra": the red river round. */
  | { kind: "deal"; street: Street; extraRound?: number; run: number; board: number; cards: string[] }
  | { kind: "showdown"; seat: number; cards: string[]; labels: string[] }
  /** A player chose to show cards after the hand. */
  | { kind: "show"; seat: number; cards: string[] }
  | { kind: "win"; seat: number; amount: number };

/** The table after one step. Only your own cards, and cards shown at showdown or after the hand, are visible. */
export interface ReplayFrame {
  events: ReplayEvent[];
  street: Street;
  /** Set when `street` is "extra": the red river round. */
  extraRound?: number;
  boards: string[][];
  secondRun: string[][] | null;
  pot: number;
  seats: {
    seat: number;
    nickname: string;
    stack: number;
    bet: number;
    folded: boolean;
    cards: (string | null)[];
  }[];
}

export interface ReplayView {
  hand: number;
  /** The hand's boards were grids (Tic-Tac-Toe). Null for rows of 5. */
  grid: BoardGrid | null;
  /** The deal first, then one frame per action. */
  frames: ReplayFrame[];
  pots: { amount: number; slices: SliceView[] }[];
  /** The deck ran out of cards to spare, so red river stopped. */
  redRiverStopped: boolean;
}
