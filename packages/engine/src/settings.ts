import { type HandConfig, type RunItTwiceMode, VARIANTS } from "./hand";

export const RUN_IT_TWICE_MODES: RunItTwiceMode[] = ["no", "ask", "always"];

export type VariantName = keyof typeof VARIANTS;
export const VARIANT_NAMES = Object.keys(VARIANTS) as VariantName[];

export type BombPotMode = "off" | "everyHand" | "everyN";
export const BOMB_POT_MODES: BombPotMode[] = ["off", "everyHand", "everyN"];

/** Owner-editable table settings (SPEC §5). Chip amounts are integer cents. */
export interface TableSettings {
  variant: VariantName;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  /** 2-9, capped by deck math. */
  seats: number;
  /** 1 or 2 boards (SPEC §1 table modifier), capped by deck math. */
  boards: 1 | 2;
  bombPotMode: BombPotMode;
  /** With "everyN": every Nth hand is a bomb pot. */
  bombPotEvery: number;
  /** Bomb-pot ante, in big blinds (SPEC default 2). */
  bombPotAnteBB: number;
  /** SPEC §2.7: "no", "ask" every player in the pot, or "always". Needs deck math with 2 runs. */
  runItTwice: RunItTwiceMode;
  /** SPEC §2.8: after a hand ends before the river, anyone seated can see what would have come. */
  rabbitHunt: boolean;
  straddle: boolean;
  decisionTimeSec: number;
  timeBankSec: number;
  autoStart: boolean;
  rebuys: boolean;
  displayCents: boolean;
}

/** SPEC §5 defaults: NLH, 10/20 (stored as cents), 8 seats, 1 board, no bomb pots, 20 s + 60 s bank. */
export const DEFAULT_SETTINGS: TableSettings = {
  variant: "NLH",
  smallBlind: 1000,
  bigBlind: 2000,
  ante: 0,
  seats: 8,
  boards: 1,
  bombPotMode: "off",
  bombPotEvery: 5,
  bombPotAnteBB: 2,
  runItTwice: "no",
  rabbitHunt: false,
  straddle: false,
  decisionTimeSec: 20,
  timeBankSec: 60,
  autoStart: true,
  rebuys: true,
  displayCents: false,
};

export const MIN_SEATS = 2;
export const MAX_SEATS = 9;
export const MAX_BOMB_POT_ANTE_BB = 10;

/**
 * SPEC §3: seats × hole cards + boards × 5 × runs. No burn cards.
 * Runs is 1 until run it twice (phase 4).
 */
export function cardsNeeded(seats: number, holeCards: number, boards = 1, runs = 1): number {
  return seats * holeCards + boards * 5 * runs;
}

export interface ConfigIssue {
  field: keyof TableSettings;
  message: string;
  /** Every setting that contributes to the problem, e.g. seats, variant and boards for deck math. */
  related: (keyof TableSettings)[];
}

const isCents = (x: number) => Number.isSafeInteger(x) && x >= 0;

/** Every reason the settings can't be saved; empty when they're valid. */
export function validateConfig(s: TableSettings): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (field: keyof TableSettings, message: string, related: (keyof TableSettings)[] = [field]) =>
    issues.push({ field, message, related });

  const variant = VARIANTS[s.variant];
  if (!variant) add("variant", `Unknown variant ${s.variant}`);
  if (!isCents(s.bigBlind) || s.bigBlind === 0) add("bigBlind", "Big blind must be more than 0");
  if (!isCents(s.smallBlind) || s.smallBlind > s.bigBlind) {
    add("smallBlind", "Small blind must be between 0 and the big blind", ["smallBlind", "bigBlind"]);
  }
  if (!isCents(s.ante)) add("ante", "Ante can't be negative");
  const seatsOk = Number.isInteger(s.seats) && s.seats >= MIN_SEATS && s.seats <= MAX_SEATS;
  if (!seatsOk) add("seats", `Seats must be ${MIN_SEATS}-${MAX_SEATS}`);
  if (s.boards !== 1 && s.boards !== 2) add("boards", "Boards must be 1 or 2");
  else if (seatsOk && variant) {
    const runs = s.runItTwice === "no" ? 1 : 2;
    const needed = cardsNeeded(s.seats, variant.holeCards, s.boards, runs);
    if (needed > variant.deckSize) {
      const extras = [s.boards === 2 && "2 boards", runs === 2 && "run it twice"].filter(Boolean).join(" and ");
      add(
        "seats",
        `${s.seats} seats${extras ? ` with ${extras}` : ""} need ${needed} cards; the deck has ${variant.deckSize}`,
        runs === 2 ? ["seats", "variant", "boards", "runItTwice"] : ["seats", "variant", "boards"],
      );
    }
  }
  if (!RUN_IT_TWICE_MODES.includes(s.runItTwice)) add("runItTwice", "Unknown run it twice setting");
  if (typeof s.rabbitHunt !== "boolean") add("rabbitHunt", "Rabbit hunt must be on or off");
  if (!BOMB_POT_MODES.includes(s.bombPotMode)) add("bombPotMode", "Unknown bomb pot mode");
  if (!Number.isInteger(s.bombPotEvery) || s.bombPotEvery < 2 || s.bombPotEvery > 100) {
    add("bombPotEvery", "Bomb pot frequency must be every 2-100 hands");
  }
  if (!Number.isInteger(s.bombPotAnteBB) || s.bombPotAnteBB < 1 || s.bombPotAnteBB > MAX_BOMB_POT_ANTE_BB) {
    add("bombPotAnteBB", `Bomb pot ante must be 1-${MAX_BOMB_POT_ANTE_BB} big blinds`);
  }
  if (!Number.isInteger(s.decisionTimeSec) || s.decisionTimeSec < 5 || s.decisionTimeSec > 300) {
    add("decisionTimeSec", "Decision time must be 5-300 seconds");
  }
  if (!Number.isInteger(s.timeBankSec) || s.timeBankSec < 0 || s.timeBankSec > 600) {
    add("timeBankSec", "Time bank must be 0-600 seconds");
  }
  return issues;
}

/** Whether hand number `hand` (1-based) is a bomb pot under these settings. */
export function isBombPotHand(s: TableSettings, hand: number): boolean {
  if (s.bombPotMode === "everyHand") return true;
  if (s.bombPotMode === "everyN") return hand % s.bombPotEvery === 0;
  return false;
}

/** The engine's config for one hand under these settings. */
export function handConfigFor(s: TableSettings, bombPot = false): HandConfig {
  return {
    variant: VARIANTS[s.variant],
    smallBlind: s.smallBlind,
    bigBlind: s.bigBlind,
    ante: s.ante,
    straddle: s.straddle,
    boards: s.boards,
    bombPot: bombPot ? { ante: s.bombPotAnteBB * s.bigBlind } : null,
    runItTwice: s.runItTwice,
  };
}
