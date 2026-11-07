import { describe, expect, it } from "vitest";
import {
  applyAction,
  type Card,
  cardToString,
  DEFAULT_SETTINGS,
  extraRoundOfPosition,
  type HandConfig,
  type HandState,
  handConfigFor,
  isRed,
  legalActions,
  makeDeck,
  parseCard,
  parseCards,
  ROW_BOARD,
  redRiverApplies,
  streetOfPosition,
  streetWithDealt,
  VARIANTS,
  validateConfig,
} from "../src/index.js";
import { checkDown, NL, PL, play, stackDeck, start } from "./helpers.js";

const str = (cards: number[]) => cards.map(cardToString).join(" ");
const RR: HandConfig = { ...NL, redRiver: true };

/** Checks until the betting round (street, or red river round) changes or the hand ends. */
function checkStreet(state: HandState): HandState {
  let s = state;
  const { street, extraRound } = s;
  while (s.street === street && s.extraRound === extraRound && s.toAct !== null) {
    s = applyAction(s, { type: "check", seat: s.toAct });
  }
  return s;
}

/** Calls or checks every decision to the end of the hand. */
function callDown(state: HandState): HandState {
  let s = state;
  while (s.toAct !== null) {
    const seat = s.toAct;
    s = applyAction(s, legalActions(s)!.canCheck ? { type: "check", seat } : { type: "call", seat });
  }
  return s;
}

/** A full deck: `holeCards` filler cards, then `cards` in order, then the rest. */
function layDeck(holeCards: number, cards: string): Card[] {
  const top = parseCards(cards);
  const rest = makeDeck(52).filter((c) => !top.includes(c));
  return [...rest.slice(0, holeCards), ...top, ...rest.slice(holeCards)];
}

const seats = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 1000]));
const stacks = (s: HandState) => s.players.reduce((sum, p) => sum + p.stack, 0);

describe("red river settings", () => {
  it("isRed is true for hearts and diamonds only", () => {
    expect(isRed(parseCard("Ah"))).toBe(true);
    expect(isRed(parseCard("2d"))).toBe(true);
    expect(isRed(parseCard("Ks"))).toBe(false);
    expect(isRed(parseCard("3c"))).toBe(false);
  });

  it("applies to every variant except Tic-Tac-Toe", () => {
    expect(redRiverApplies("NLH")).toBe(true);
    expect(redRiverApplies("PLO")).toBe(true);
    expect(redRiverApplies("SHORT")).toBe(true);
    expect(redRiverApplies("TICTACTOE")).toBe(false);
  });

  it("flows into the hand config, off for Tic-Tac-Toe", () => {
    expect(handConfigFor({ ...DEFAULT_SETTINGS, redRiver: true }).redRiver).toBe(true);
    expect(handConfigFor({ ...DEFAULT_SETTINGS, variant: "TICTACTOE", redRiver: true }).redRiver).toBe(false);
  });

  it("accepts Tic-Tac-Toe with it on, and defaults to off", () => {
    expect(validateConfig({ ...DEFAULT_SETTINGS, variant: "TICTACTOE", redRiver: true })).toEqual([]);
    expect(DEFAULT_SETTINGS.redRiver).toBe(false);
  });
});

describe("red river live play", () => {
  // Three players, button 1: holes go to seats 2, 3, 1. Seat 2 folds preflop,
  // so the first live seat left of the button after the flop is seat 3.
  const holes = ["Ac Kc", "Qs Qd", "Jc Td"];
  const toRiverEnd = (deck: Card[], config = RR) => {
    let s = play(start({ 1: 1000, 2: 1000, 3: 1000 }, 1, config, deck), "1 call", "2 fold", "3 check");
    for (const street of ["flop", "turn", "river"]) {
      expect(s.street).toBe(street);
      s = checkStreet(s);
    }
    return s;
  };

  it("black river: hand ends after river betting", () => {
    const s = toRiverEnd(stackDeck(holes, "2c 7d 9h Js 3c"));
    expect(s.street).toBe("complete");
    expect(s.boards[0]).toHaveLength(5);
    expect(s.extraRound).toBe(0);
    expect(s.redRiverStopped).toBe(false);
  });

  it("red river deals one extra card and a betting round", () => {
    let s = toRiverEnd(stackDeck(holes, "2c 7d 9h Js 5h 8s"));
    expect(s.street).toBe("extra");
    expect(s.extraRound).toBe(1);
    expect(str(s.boards[0]!)).toBe("2c 7d 9h Js 5h 8s");
    expect(s.toAct).toBe(3);
    expect(s.currentBet).toBe(0);
    expect(s.lastRaiseSize).toBe(20);
    expect(s.players.every((p) => p.bet === 0)).toBe(true);
    s = checkStreet(s);
    expect(s.street).toBe("complete");
    expect(s.boards[0]).toHaveLength(6);
    expect(s.extraRound).toBe(1);
  });

  it("red streak: river 5h, then Kd, then 4c", () => {
    let s = toRiverEnd(stackDeck(holes, "2c 7d 9h Js 5h Kd 4c"));
    expect(s.extraRound).toBe(1);
    s = checkStreet(s);
    expect(s.street).toBe("extra");
    expect(s.extraRound).toBe(2);
    expect(s.toAct).toBe(3);
    s = checkStreet(s);
    expect(s.street).toBe("complete");
    expect(str(s.boards[0]!)).toBe("2c 7d 9h Js 5h Kd 4c");
    expect(s.extraRound).toBe(2);
    const extra = s.log.filter((e) => e.street === "extra");
    expect(extra.map((e) => e.extraRound)).toEqual([1, 1, 2, 2]);
    expect(extra.slice(2).every((e) => e.street === "extra" && e.extraRound === 2)).toBe(true);
    // Base streets carry no round number.
    expect(s.log.filter((e) => e.street !== "extra").every((e) => e.extraRound === undefined)).toBe(true);
  });

  it("bet and fold in red river 1 ends the hand", () => {
    const deck = stackDeck(holes, "2c 7d 9h Js 5h 8s");
    let s = toRiverEnd(deck);
    s = play(s, "3 raise 100", "1 fold");
    expect(s.street).toBe("complete");
    expect(s.extraRound).toBe(1);
    expect(s.log.at(-1)).toEqual({ street: "extra", extraRound: 1, seat: 3, type: "uncalled", amount: 100 });
    expect(s.result!.payouts).toEqual([{ seat: 3, amount: 50 }]);
    expect(stacks(s)).toBe(3000);
  });

  it("grid boards ignore the toggle", () => {
    // Tic-Tac-Toe's river (the last two squares) ends on 5h; no tenth card comes.
    const deck = stackDeck(["As Ad", "Ks Kc"], "2c 7d 9s 3c 8d Ts Jc Qc 5h 6s");
    const s = checkDown(play(start({ 1: 1000, 2: 1000 }, 1, { ...RR, variant: VARIANTS.TICTACTOE }, deck), "1 call"));
    expect(s.street).toBe("complete");
    expect(s.boards[0]).toHaveLength(9);
    expect(s.extraRound).toBe(0);
  });

  it("toggle off: red river ends the hand", () => {
    const s = toRiverEnd(stackDeck(holes, "2c 7d 9h Js 5h 8s"), NL);
    expect(s.street).toBe("complete");
    expect(s.boards[0]).toHaveLength(5);
    expect(s.extraRound).toBe(0);
  });

  it("double board: only the red board grows", () => {
    // Flops B1 then B2, turns, rivers (B1 5h red, B2 6s black), then B1's extra card.
    const deck = stackDeck(["As Ad", "Ks Kd"], "2c 7d 9s 3c 8d Ts Jc Qc 5h 6s 8s");
    let s = play(start({ 1: 1000, 2: 1000 }, 1, { ...RR, boards: 2 }, deck), "1 call", "2 check");
    for (let i = 0; i < 3; i++) s = checkStreet(s);
    expect(s.street).toBe("extra");
    expect(s.extraRound).toBe(1);
    expect(str(s.boards[0]!)).toBe("2c 7d 9s Jc 5h 8s");
    expect(str(s.boards[1]!)).toBe("3c 8d Ts Qc 6s");
    s = checkStreet(s);
    expect(s.street).toBe("complete");
    expect(s.boards.map((b) => b.length)).toEqual([6, 5]);
  });

  it("an all-in run-out keeps dealing while red", () => {
    const deck = stackDeck(["As Ad", "Ks Kd"], "2c 7d 9h Js 5h Qd 4c");
    const s = play(start({ 1: 1000, 2: 1000 }, 1, RR, deck), "1 raise 1000", "2 call");
    expect(s.street).toBe("complete");
    expect(s.runOutFrom).toBe("preflop");
    expect(str(s.boards[0]!)).toBe("2c 7d 9h Js 5h Qd 4c");
    expect(s.extraRound).toBe(2);
  });

  it("an all-in on the river with a red card runs out the extra cards", () => {
    const deck = stackDeck(["As Ad", "Ks Kc"], "2c 7d 9h Js 5h Qd 4c");
    let s = play(start({ 1: 1000, 2: 1000 }, 1, RR, deck), "1 call", "2 check");
    for (let i = 0; i < 2; i++) s = checkStreet(s);
    expect(s.street).toBe("river");
    s = play(s, "2 raise 980", "1 call");
    expect(s.street).toBe("complete");
    expect(s.runOutFrom).toBe("river");
    expect(s.boards[0]).toHaveLength(7);
    expect(s.extraRound).toBe(2);
  });

  it("deck short: red river stops", () => {
    // 8-seat PLO5, double board: 40 + 10 = 50, so 2 cards are left.
    const config = { ...PL, variant: VARIANTS.PLO5, boards: 2 as const, redRiver: true };
    const deck = layDeck(40, "2c 3c 4c 2s 3s 4s 5c 5s 6h 6d 7h 7d");
    const s = callDown(start(seats(8), 1, config, deck));
    expect(s.street).toBe("complete");
    expect(s.extraRound).toBe(1);
    expect(s.redRiverStopped).toBe(true);
    expect(str(s.boards[0]!)).toBe("2c 3c 4c 5c 6h 7h");
    expect(str(s.boards[1]!)).toBe("2s 3s 4s 5s 6d 7d");
    expect(s.deckIndex).toBe(52);
  });

  it("deck short: all or nothing", () => {
    // 7-seat PLO5, double board: 35 + 10 = 45, so 7 cards are left: 3 rounds of 2, then 1.
    const config = { ...PL, variant: VARIANTS.PLO5, boards: 2 as const, redRiver: true };
    const deck = layDeck(35, "2c 3c 4c 2s 3s 4s 5c 5s 6h 6d 7h 7d 8h 8d 9h 9d Th");
    const s = callDown(start(seats(7), 1, config, deck));
    expect(s.street).toBe("complete");
    expect(s.extraRound).toBe(3);
    expect(s.redRiverStopped).toBe(true);
    expect(str(s.boards[0]!)).toBe("2c 3c 4c 5c 6h 7h 8h 9h");
    expect(str(s.boards[1]!)).toBe("2s 3s 4s 5s 6d 7d 8d 9d");
    expect(s.deckIndex).toBe(51);
    expect(s.boards.flat()).not.toContain(parseCard("Th"));
  });

  it("Omaha uses 2 + 3 from the whole long board", () => {
    // Heads-up, button 1: seat 2 gets the first hole cards. On the base board
    // seat 2 has trip nines and seat 1 a pair of kings; extra cards Ad, As give
    // seat 1 aces full of kings with board cards 1, 6 and 7.
    const deck = stackDeck(["9c 9d 8c 8s", "Kc Kd Qc Js"], "Ac 2s 7d 9h 5h Ad As");
    const s = checkDown(play(start({ 1: 1000, 2: 1000 }, 1, { ...PL, redRiver: true }, deck), "1 call"));
    expect(s.boards[0]).toHaveLength(7);
    expect(s.result!.payouts).toEqual([{ seat: 1, amount: 40 }]);
    const seat1 = s.result!.showdown.find((h) => h.seat === 1)!;
    expect(seat1.boards[0]!.high.cards.slice().sort((a, b) => a - b)).toEqual(
      parseCards("Kc Kd Ac Ad As").sort((a, b) => a - b),
    );
  });
});

describe("red river board positions", () => {
  it("numbers positions past the river as extra rounds", () => {
    expect(streetOfPosition(ROW_BOARD, 4)).toBe("river");
    expect(streetOfPosition(ROW_BOARD, 5)).toBe("extra");
    expect(extraRoundOfPosition(ROW_BOARD, 4)).toBe(0);
    expect(extraRoundOfPosition(ROW_BOARD, 5)).toBe(1);
    expect(extraRoundOfPosition(ROW_BOARD, 6)).toBe(2);
    expect(streetWithDealt(ROW_BOARD, 5)).toBe("river");
    expect(streetWithDealt(ROW_BOARD, 7)).toBe("extra");
  });
});
