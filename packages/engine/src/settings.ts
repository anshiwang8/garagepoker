import { boardSize } from "./board";
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
  /** SPEC §4: anyone with the link can watch without a seat. */
  spectators: boolean;
  straddle: boolean;
  decisionTimeSec: number;
  timeBankSec: number;
  autoStart: boolean;
  rebuys: boolean;
  displayCents: boolean;
  /** SPEC §5: table chat, on by default; the owner can turn it off. */
  chat: boolean;
  /** SPEC §2.9: show every live hand once no more betting is possible (all in), before the run-out. */
  revealAllIn: boolean;
  /**
   * House rule, the 7-2 game: win a pot holding 7-2 offsuit and show it, and
   * every other player dealt in pays you this many big blinds. 0 is off.
   * Only in 2-card games with a full deck.
   */
  sevenDeuceBB: number;
  /** House rule, mixed games: rotate through these games, one orbit each. Fewer than 2 is off. */
  mixedGames: VariantName[];
  /** Table toggle: a red river (hearts or diamonds) deals another card, with betting, until a black one. Row boards only, not Tic-Tac-Toe. */
  redRiver: boolean;
}

/** SPEC §5 defaults: NLH, 10/20, cent mode off, 8 seats, 1 board, no bomb pots, 20 s + 60 s bank. */
export const DEFAULT_SETTINGS: TableSettings = {
  variant: "NLH",
  smallBlind: 10,
  bigBlind: 20,
  ante: 0,
  seats: 8,
  boards: 1,
  bombPotMode: "off",
  bombPotEvery: 5,
  bombPotAnteBB: 2,
  runItTwice: "no",
  rabbitHunt: false,
  spectators: true,
  straddle: false,
  decisionTimeSec: 20,
  timeBankSec: 60,
  autoStart: true,
  rebuys: true,
  displayCents: false,
  chat: true,
  revealAllIn: true,
  sevenDeuceBB: 0,
  mixedGames: [],
  redRiver: false,
};

/** Whether red river can apply to this game: not for grid boards (Tic-Tac-Toe). */
export function redRiverApplies(variant: VariantName): boolean {
  return (VARIANTS[variant].board as { grid?: unknown }).grid === undefined;
}

/**
 * Whether the red river toggle is meaningful for these settings: the current game
 * takes it, or a mixed rotation (2+ games) includes a row-board game. The server
 * overwrites `variant` with the current game during a rotation, so a Tic-Tac-Toe
 * orbit must not grey the toggle out (spec 4.7).
 */
export function redRiverAvailable(s: TableSettings): boolean {
  return redRiverApplies(s.variant) || (s.mixedGames.length >= 2 && s.mixedGames.some(redRiverApplies));
}

export const MAX_SEVEN_DEUCE_BB = 20;

/** Whether the 7-2 bounty can apply to this game: 2 hole cards from a full deck (short deck has no deuces). */
export function sevenDeuceApplies(variant: VariantName): boolean {
  const v = VARIANTS[variant];
  return v.holeCards === 2 && v.deckSize === 52;
}

export const MIN_SEATS = 2;
export const MAX_SEATS = 9;
export const MAX_BOMB_POT_ANTE_BB = 10;

/**
 * SPEC §3: seats × hole cards + boards × board cards × runs. No burn cards.
 * A board is 5 cards, or 9 for the Tic-Tac-Toe grid.
 */
export function cardsNeeded(seats: number, holeCards: number, boards = 1, runs = 1, boardCards = 5): number {
  return seats * holeCards + boards * boardCards * runs;
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
    const needed = cardsNeeded(s.seats, variant.holeCards, s.boards, runs, boardSize(variant.board));
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
  if (typeof s.spectators !== "boolean") add("spectators", "Spectators must be on or off");
  if (typeof s.chat !== "boolean") add("chat", "Chat must be on or off");
  if (typeof s.redRiver !== "boolean") add("redRiver", "Red river must be on or off");
  if (typeof s.revealAllIn !== "boolean") add("revealAllIn", "Reveal hands must be on or off");
  if (!Number.isInteger(s.sevenDeuceBB) || s.sevenDeuceBB < 0 || s.sevenDeuceBB > MAX_SEVEN_DEUCE_BB) {
    add("sevenDeuceBB", `The 7-2 bounty must be 0-${MAX_SEVEN_DEUCE_BB} big blinds`);
  }
  if (!Array.isArray(s.mixedGames) || s.mixedGames.length > 8 || s.mixedGames.some((v) => !VARIANTS[v])) {
    add("mixedGames", "Mixed games must be up to 8 known games");
  } else if (s.mixedGames.length >= 2 && seatsOk) {
    // Every game in the rotation has to fit the table, like the main game.
    const runs = s.runItTwice === "no" ? 1 : 2;
    for (const name of s.mixedGames) {
      const v = VARIANTS[name];
      if (cardsNeeded(s.seats, v.holeCards, s.boards, runs, boardSize(v.board)) > v.deckSize) {
        add("mixedGames", `${name} doesn't fit ${s.seats} seats with these boards`, ["mixedGames", "seats", "boards", "runItTwice"]);
        break;
      }
    }
  }
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
    redRiver: s.redRiver && redRiverApplies(s.variant),
  };
}
