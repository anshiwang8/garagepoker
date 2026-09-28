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
  })
  .strict() satisfies z.ZodType<TableSettings>;

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
  msg("act", { hand: z.number().int().min(1), action: playerActionSchema }),
  msg("setAway", { away: z.boolean() }),
  msg("leaveSeat", {}),
  /** Answer the run-it-twice prompt (anyone in the pot, within 5 s). */
  msg("runItTwice", { hand: z.number().int().min(1), accept: z.boolean() }),
  /** After a hand that ended before the river: show what would have come. */
  msg("rabbitHunt", { hand: z.number().int().min(1) }),
  /** Pineapple: discard one of your cards (face down, everyone at once). */
  msg("discard", { hand: z.number().int().min(1), card: z.string().regex(/^[2-9TJQKA][cdhs]$/) }),

  // Owner only
  msg("approveRequest", { requestId, stack: positiveCents }),
  msg("declineRequest", { requestId }),
  msg("updateSettings", { settings: settingsSchema }),
  msg("adjustStack", { playerId, op: z.enum(["add", "remove", "set"]), amount: cents }),
  msg("kick", { playerId }),
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
}

export interface YouView {
  playerId: string;
  isOwner: boolean;
  seat: number | null;
  /** Your pending request, if any. */
  request: RequestView | null;
  /** One-off message, e.g. "Your seat request was declined." */
  notice: string | null;
  /** What you may do; set only when it's your turn. */
  legal: LegalActions | null;
  /**
   * Your current hand label, one per board: "Top pair", or in Hi/Lo both
   * halves: "Flush / 8-6 low". Null if you're not in the hand.
   */
  labels: string[] | null;
  /**
   * The owner turned spectators off and you have no seat: game details are
   * hidden until you sit down.
   */
  watchBlocked: boolean;
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

export interface HandView {
  number: number;
  street: Street;
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
  /** The hand was Hi/Lo (so a board with only a high slice had no qualifying low). */
  hiLo: boolean;
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
  }[];
  /** The second run's boards, when run twice. */
  secondRun: string[][] | null;
  /** A seated player can ask to see the rest of the board (rabbit hunt is on and the hand ended early). */
  rabbitAvailable: boolean;
  /** The rabbit-hunted cards per board, once someone asked. Display only. */
  rabbit: { boards: string[][]; by: string } | null;
  /** Everything needed to check this hand's cards against its commitment. */
  fairness: FairnessProof | null;
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
