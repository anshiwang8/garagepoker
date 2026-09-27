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
  type LedgerRow,
  type LegalActions,
  type LogType,
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
  /** Your current hand label, e.g. "Top pair". */
  label: string | null;
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
  board: string[];
  /** All chips in the middle, including bets on this street. */
  pot: number;
  currentBet: number;
  toAct: number | null;
  /** When the decision time runs out, then when the time bank does. */
  decisionDeadline: number | null;
  bankDeadline: number | null;
}

export interface LastHandView {
  number: number;
  board: string[];
  pots: { amount: number; winners: { seat: number; amount: number }[] }[];
  /** Hands shown at showdown. Empty if everyone else folded. */
  shown: { seat: number; nickname: string; cards: string[]; label: string }[];
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
