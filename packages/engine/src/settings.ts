import { type HandConfig, VARIANTS } from "./hand";

export type VariantName = keyof typeof VARIANTS;
export const VARIANT_NAMES = Object.keys(VARIANTS) as VariantName[];

/** Owner-editable table settings (SPEC §5). Chip amounts are integer cents. */
export interface TableSettings {
  variant: VariantName;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  /** 2-9, capped by deck math. */
  seats: number;
  straddle: boolean;
  decisionTimeSec: number;
  timeBankSec: number;
  autoStart: boolean;
  rebuys: boolean;
  displayCents: boolean;
}

/** SPEC §5 defaults: NLH, 10/20 (stored as cents), 8 seats, 20 s + 60 s bank. */
export const DEFAULT_SETTINGS: TableSettings = {
  variant: "NLH",
  smallBlind: 1000,
  bigBlind: 2000,
  ante: 0,
  seats: 8,
  straddle: false,
  decisionTimeSec: 20,
  timeBankSec: 60,
  autoStart: true,
  rebuys: true,
  displayCents: false,
};

export const MIN_SEATS = 2;
export const MAX_SEATS = 9;

/**
 * SPEC §3: seats × hole cards + boards × 5 × runs. No burn cards.
 * Boards and runs are 1 until double board (phase 3) and run it twice (phase 4).
 */
export function cardsNeeded(seats: number, holeCards: number, boards = 1, runs = 1): number {
  return seats * holeCards + boards * 5 * runs;
}

export interface ConfigIssue {
  field: keyof TableSettings;
  message: string;
}

const isCents = (x: number) => Number.isSafeInteger(x) && x >= 0;

/** Every reason the settings can't be saved; empty when they're valid. */
export function validateConfig(s: TableSettings): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (field: keyof TableSettings, message: string) => issues.push({ field, message });

  const variant = VARIANTS[s.variant];
  if (!variant) add("variant", `Unknown variant ${s.variant}`);
  if (!isCents(s.bigBlind) || s.bigBlind === 0) add("bigBlind", "Big blind must be more than 0");
  if (!isCents(s.smallBlind) || s.smallBlind > s.bigBlind) {
    add("smallBlind", "Small blind must be between 0 and the big blind");
  }
  if (!isCents(s.ante)) add("ante", "Ante can't be negative");
  if (!Number.isInteger(s.seats) || s.seats < MIN_SEATS || s.seats > MAX_SEATS) {
    add("seats", `Seats must be ${MIN_SEATS}-${MAX_SEATS}`);
  } else if (variant) {
    const needed = cardsNeeded(s.seats, variant.holeCards);
    if (needed > variant.deckSize) {
      add("seats", `${s.seats} seats need ${needed} cards; the deck has ${variant.deckSize}`);
    }
  }
  if (!Number.isInteger(s.decisionTimeSec) || s.decisionTimeSec < 5 || s.decisionTimeSec > 300) {
    add("decisionTimeSec", "Decision time must be 5-300 seconds");
  }
  if (!Number.isInteger(s.timeBankSec) || s.timeBankSec < 0 || s.timeBankSec > 600) {
    add("timeBankSec", "Time bank must be 0-600 seconds");
  }
  return issues;
}

/** The engine's per-hand config for these settings. */
export function handConfigFor(s: TableSettings): HandConfig {
  return {
    variant: VARIANTS[s.variant],
    smallBlind: s.smallBlind,
    bigBlind: s.bigBlind,
    ante: s.ante,
    straddle: s.straddle,
  };
}
