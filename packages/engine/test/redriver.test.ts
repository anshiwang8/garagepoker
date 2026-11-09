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
  handValue,
  huntable,
  isRed,
  legalActions,
  makeDeck,
  parseCard,
  parseCards,
  type PlayerAction,
  ROW_BOARD,
  rabbitBacks,
  rabbitCards,
  redRiverApplies,
  redRiverAvailable,
  replayHand,
  type RunItTwiceMode,
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

  it("is available in a mixed rotation that has a row-board game, even on a Tic-Tac-Toe orbit", () => {
    const s = { ...DEFAULT_SETTINGS };
    expect(redRiverAvailable({ ...s, variant: "TICTACTOE" })).toBe(false);
    expect(redRiverAvailable({ ...s, variant: "NLH" })).toBe(true);
    expect(redRiverAvailable({ ...s, variant: "TICTACTOE", mixedGames: ["NLH", "TICTACTOE"] })).toBe(true);
    expect(redRiverAvailable({ ...s, variant: "TICTACTOE", mixedGames: ["TICTACTOE", "TICTACTOE"] })).toBe(false);
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

  it("Omaha uses exactly 2 + 3 from the whole long board", () => {
    // Heads-up, button 1: seat 2 gets the first hole cards. The 7-card board
    // (river 5h and extra Qh red, then 4c) holds four hearts: 2h Jh 5h Qh.
    // Best 5 of any, seat 1's Ah would make an ace-high flush with 4 board
    // cards, one of them an extra card. Omaha needs 2 hearts in the hand, so
    // seat 1 has only a pair of kings. Seat 2's pair of queens loses to that on
    // the first 5 cards, but the extra Qh (board card 6) makes trips, so seat 2
    // wins only if the evaluator sees the whole board.
    const holes = { 2: "Qs Qd Ts 3s", 1: "Ah Kc Kd 8s" };
    const deck = stackDeck([holes[2], holes[1]], "2h 7c Jh 9s 5h Qh 4c");
    const s = checkDown(play(start({ 1: 1000, 2: 1000 }, 1, { ...PL, redRiver: true }, deck), "1 call"));
    const board = s.boards[0]!;
    expect(str(board)).toBe("2h 7c Jh 9s 5h Qh 4c");
    // Under best 5 of any, seat 1 would win, and only thanks to the extra card.
    const any = (seat: 1 | 2, cards: Card[]) => handValue(VARIANTS.NLH, parseCards(holes[seat]), cards).score;
    expect(any(1, board)).toBeGreaterThan(any(2, board));
    // Under Omaha, seat 1 wins on the first 5 cards, but seat 2 wins on all 7.
    const omaha = (seat: 1 | 2, cards: Card[]) => handValue(VARIANTS.PLO, parseCards(holes[seat]), cards).score;
    expect(omaha(1, board.slice(0, 5))).toBeGreaterThan(omaha(2, board.slice(0, 5)));
    expect(omaha(2, board)).toBeGreaterThan(omaha(1, board));
    expect(s.result!.payouts).toEqual([{ seat: 2, amount: 40 }]);
    for (const h of s.result!.showdown) {
      const best = h.boards[0]!.high.cards;
      expect(best.filter((c) => h.hole.includes(c))).toHaveLength(2);
      expect(best.filter((c) => board.includes(c))).toHaveLength(3);
    }
    // Seat 2's winning five uses an extra-round card.
    const winner = s.result!.showdown.find((h) => h.seat === 2)!;
    expect(winner.boards[0]!.high.cards).toContain(board[5]);
  });
});

describe("red river run-outs", () => {
  // Heads-up, button 1: seat 2 gets As Ad, seat 1 Ks Kc. Seat 2 acts first after the flop.
  const holes = ["As Ad", "Ks Kc"];
  const RIT_ASK: HandConfig = { ...RR, runItTwice: "ask" };
  const rit = (s: HandState, seat: number, accept: boolean) => applyAction(s, { type: "runItTwice", seat, accept });
  /** Checks to the river (preflop call, then flop and turn checked through). */
  const toRiver = (deck: Card[], config: HandConfig = RR) => {
    let s = play(start({ 1: 1000, 2: 1000 }, 1, config, deck), "1 call", "2 check");
    for (let i = 0; i < 2; i++) s = checkStreet(s);
    expect(s.street).toBe("river");
    return s;
  };

  it("all-in on the flop runs once through red rivers", () => {
    // Turn Jh, river 5d, then Kh red, then 4s black.
    const deck = stackDeck(holes, "2c 7d 9s Jh 5d Kh 4s");
    for (const config of [RR, RIT_ASK]) {
      let s = play(start({ 1: 1000, 2: 1000 }, 1, config, deck), "1 call", "2 check", "2 raise 980", "1 call");
      if (config.runItTwice === "ask") {
        expect(s.ritOffer).toEqual({ seats: [1, 2], accepted: [] });
        s = rit(rit(s, 1, true), 2, false); // any decline runs it once
      }
      expect(s.street).toBe("complete");
      expect(s.runOutFrom).toBe("flop");
      expect(s.secondRun).toBeNull();
      expect(str(s.boards[0]!)).toBe("2c 7d 9s Jh 5d Kh 4s");
      expect(s.extraRound).toBe(2);
      expect(s.deckIndex).toBe(4 + 7);
      // Settled: seat 1's trip kings (with the extra Kh) win the 2000 pot.
      expect(s.result!.payouts).toEqual([{ seat: 1, amount: 2000 }]);
      expect(stacks(s)).toBe(2000);
    }
  });

  it("run it twice: each run extends on its own", () => {
    // Run 1 ends on 4s (black); run 2's river 5h is red, so it gets 6c.
    const deck = stackDeck(holes, "2c 7h 9s Jd 4s 3c 8h Tc Qh 5h 6c");
    const s = play(start({ 1: 1000, 2: 1000 }, 1, { ...RR, runItTwice: "always" }, deck), "1 raise 1000", "2 call");
    expect(s.street).toBe("complete");
    expect(s.boards.map(str)).toEqual(["2c 7h 9s Jd 4s"]);
    expect(s.secondRun!.map(str)).toEqual(["3c 8h Tc Qh 5h 6c"]);
    expect(s.deckIndex).toBe(4 + 11);
    expect(s.extraRound).toBe(1);
    expect(s.result!.pots[0]!.slices.map((sl) => [sl.run, sl.amount])).toEqual([
      [0, 1000],
      [1, 1000],
    ]);
    expect(stacks(s)).toBe(2000);
  });

  it("run it twice extra order: r1b1, r1b2, r2b1, r2b2", () => {
    // Preflop all-in, double board, always run it twice. Run 1: flops, turns, rivers
    // (5h, 6d: both red). Run 2 the same (Jd, Qd: both red). Then one extra round,
    // dealt run 1 board 1, run 1 board 2, run 2 board 1, run 2 board 2 (all black).
    const deck = stackDeck(
      ["As Ad", "Ks Kd"],
      "2c 7d 9s 3c 8d Ts Jc Qc 5h 6d  2d 3h 4c 5c 6c 7c 8c 9c Jd Qd  2s 3s 4s 5s",
    );
    const config: HandConfig = { ...RR, boards: 2, runItTwice: "always" };
    const s = play(start({ 1: 1000, 2: 1000 }, 1, config, deck), "1 raise 1000", "2 call");
    expect(s.street).toBe("complete");
    expect(s.boards.map(str)).toEqual(["2c 7d 9s Jc 5h 2s", "3c 8d Ts Qc 6d 3s"]);
    expect(s.secondRun!.map(str)).toEqual(["2d 3h 4c 8c Jd 4s", "5c 6c 7c 9c Qd 5s"]);
    expect(s.extraRound).toBe(1);
    expect(s.deckIndex).toBe(4 + 24);
    expect(stacks(s)).toBe(2000);
  });

  it("run it twice offered on a red river", () => {
    // Shared river 5h. Round 1: run 1 gets Kd (red), run 2 gets 4c (black).
    // Round 2: only run 1 still ends red, and gets 3c.
    const deck = stackDeck(holes, "2c 7d 9h Js 5h Kd 4c 3c");
    let s = play(toRiver(deck, RIT_ASK), "2 raise 980", "1 call");
    expect(s.ritOffer).toEqual({ seats: [1, 2], accepted: [] });
    expect(s.runOutFrom).toBe("river");
    const once = rit(s, 2, false);
    expect(once.street).toBe("complete");
    expect(once.secondRun).toBeNull();
    expect(str(once.boards[0]!)).toBe("2c 7d 9h Js 5h Kd 4c");
    s = rit(rit(s, 2, true), 1, true);
    expect(s.street).toBe("complete");
    expect(str(s.boards[0]!)).toBe("2c 7d 9h Js 5h Kd 3c");
    expect(str(s.secondRun![0]!)).toBe("2c 7d 9h Js 5h 4c");
    expect(s.extraRound).toBe(2);
    expect(stacks(s)).toBe(2000);
  });

  it("run it twice not offered on a black river", () => {
    const deck = stackDeck(holes, "2c 7d 9h Js 5s");
    const s = play(toRiver(deck, RIT_ASK), "2 raise 980", "1 call");
    expect(s.street).toBe("complete");
    expect(s.ritOffer).toBeNull();
    expect(s.secondRun).toBeNull();
    expect(s.boards[0]).toHaveLength(5);
  });

  it("run it twice not offered when the deck can't spare a card per board for each run", () => {
    // 8-seat PLO5, double board: 40 + 10 = 50, so 2 cards are left. Seats 4-8
    // and 1 fold; seat 3 (big blind) has 60. Both rivers are red.
    const config = (runItTwice: RunItTwiceMode): HandConfig =>
      ({ ...PL, variant: VARIANTS.PLO5, boards: 2, redRiver: true, runItTwice });
    const deck = layDeck(40, "2c 3c 4c 2s 3s 4s 5c 5s 6h 6d 7h 7d");
    const table = { ...seats(8), 3: 60 };
    const preflop = ["4 fold", "5 fold", "6 fold", "7 fold", "8 fold", "1 fold", "2 call", "3 check"];
    const toRiverEnd = (runItTwice: RunItTwiceMode) => {
      let s = play(start(table, 1, config(runItTwice), deck), ...preflop);
      for (let i = 0; i < 2; i++) s = checkStreet(s);
      expect(s.street).toBe("river");
      return s;
    };

    // All-in on the river: 2 cards cover one run (both boards) but not two.
    let s = play(toRiverEnd("always"), "2 raise 40", "3 call");
    expect(s.street).toBe("complete");
    expect(s.secondRun).toBeNull();
    expect(str(s.boards[0]!)).toBe("2c 3c 4c 5c 6h 7h");
    expect(str(s.boards[1]!)).toBe("2s 3s 4s 5s 6d 7d");
    expect(s.redRiverStopped).toBe(true);

    // All-in in red river 1 with the deck empty: no card can come, so no offer.
    s = checkStreet(toRiverEnd("ask"));
    expect(s.street).toBe("extra");
    expect(s.deckIndex).toBe(52);
    s = play(s, "2 raise 40", "3 call");
    expect(s.street).toBe("complete");
    expect(s.ritOffer).toBeNull();
    expect(s.secondRun).toBeNull();
    expect(s.runOutFrom).toBe("extra");
    expect(s.redRiverStopped).toBe(true);
    expect(s.boards.map((b) => b.length)).toEqual([6, 6]);
  });

  it("Pineapple can run it twice on a red river", () => {
    // Heads-up, button 1: seat 2 is dealt 5 cards first. River 5h is red:
    // run 1 gets 2c and run 2 gets 3c, both black.
    const deck = stackDeck(["As Ad Kc 7h 2d", "Ks Kd Qc 8h 3d"], "Ah Kh 9c 4s 5h 2c 3c");
    const discard = (s: HandState, seat: number, card: string) =>
      applyAction(s, { type: "discard", seat, card: parseCard(card) });
    let s = start({ 1: 500, 2: 500 }, 1, { ...NL, variant: VARIANTS.PINEAPPLE, redRiver: true, runItTwice: "always" }, deck);
    s = discard(discard(s, 1, "3d"), 2, "2d");
    s = play(s, "1 call", "2 check");
    s = discard(discard(s, 2, "7h"), 1, "8h");
    s = play(s, "2 check", "1 check");
    s = discard(discard(s, 2, "Kc"), 1, "Qc");
    s = play(s, "2 check", "1 check");
    expect(s.street).toBe("river");
    s = play(s, "2 raise 480", "1 call");
    expect(s.street).toBe("complete");
    expect(str(s.boards[0]!)).toBe("Ah Kh 9c 4s 5h 2c");
    expect(str(s.secondRun![0]!)).toBe("Ah Kh 9c 4s 5h 3c");
  });

  it("toggle off: run it twice deals run 1, then run 2, base cards only", () => {
    const deck = stackDeck(holes, "2c 7h 9s Jd 4h 3c 8h Tc Qh 5h 6c");
    const s = play(start({ 1: 1000, 2: 1000 }, 1, { ...NL, runItTwice: "always" }, deck), "1 raise 1000", "2 call");
    expect(s.boards.map(str)).toEqual(["2c 7h 9s Jd 4h"]);
    expect(s.secondRun!.map(str)).toEqual(["3c 8h Tc Qh 5h"]);
    expect(s.deckIndex).toBe(4 + 10);
    expect(s.extraRound).toBe(0);
  });

  it("rabbit after a fold on a red river", () => {
    const deck = stackDeck(holes, "2c 7d 9h Js 5h Kd Qh 4c 3c");
    const s = play(toRiver(deck), "2 raise 100", "1 fold");
    expect(s.street).toBe("complete");
    const before = structuredClone(s);
    expect(huntable(s)).toBe(true);
    expect(rabbitCards(s).map(str)).toEqual(["Kd Qh 4c"]);
    expect(rabbitBacks(s)).toEqual([1]);
    // Display only: the hand is untouched.
    expect(s).toEqual(before);
  });

  it("rabbitBacks: missing base cards, plus 1 when a red card is showing", () => {
    const foldOnFlop = (board: string, config = RR) => {
      const s = play(start({ 1: 1000, 2: 1000 }, 1, config, stackDeck(holes, board)), "1 call", "2 check");
      return play(s, "2 raise 20", "1 fold");
    };
    // A fold on the flop: 2 backs whatever the deck holds.
    for (const [board, rabbit, config] of [
      ["2c 7d 9h Jd 5h Kd 4c", "Jd 5h Kd 4c", RR],
      ["2c 7d 9h Js 5s", "Js 5s", RR],
      ["2c 7d 9h Jd 5h Kd 4c", "Jd 5h", NL],
    ] as const) {
      const s = foldOnFlop(board, config);
      expect(huntable(s)).toBe(true);
      expect(rabbitCards(s).map(str)).toEqual([rabbit]);
      expect(rabbitBacks(s)).toEqual([2]);
    }

    // A fold during red river 1 (Kd showing): 1 back, though the hunt shows 3.
    let s = checkStreet(toRiver(stackDeck(holes, "2c 7d 9h Js 5h Kd Qh Td 4c")));
    expect(s.street).toBe("extra");
    s = play(s, "2 raise 100", "1 fold");
    expect(huntable(s)).toBe(true);
    expect(rabbitCards(s).map(str)).toEqual(["Qh Td 4c"]);
    expect(rabbitBacks(s)).toEqual([1]);

    // A fold in red river 1 after a black extra card: nothing to hunt.
    s = play(checkStreet(toRiver(stackDeck(holes, "2c 7d 9h Js 5h 4c Qh"))), "2 raise 100", "1 fold");
    expect(huntable(s)).toBe(false);
    expect(rabbitBacks(s)).toEqual([0]);

    // A fold on a black river: nothing to hunt.
    s = play(toRiver(stackDeck(holes, "2c 7d 9h Js 5s Kd")), "2 raise 100", "1 fold");
    expect(huntable(s)).toBe(false);
    expect(rabbitCards(s)).toEqual([[]]);
    expect(rabbitBacks(s)).toEqual([0]);
  });

  it("rabbit on a double board hunts only the board that ends red", () => {
    // B1 river 5h, extra 8h (red); B2 river 6s (black). Fold in red river 1.
    const deck = stackDeck(holes, "2c 7d 9s 3c 8d Ts Jc Qc 5h 6s 8h 4c");
    let s = play(start({ 1: 1000, 2: 1000 }, 1, { ...RR, boards: 2 }, deck), "1 call", "2 check");
    for (let i = 0; i < 3; i++) s = checkStreet(s);
    expect(s.street).toBe("extra");
    s = play(s, "2 raise 100", "1 fold");
    expect(rabbitCards(s).map(str)).toEqual(["4c", ""]);
    expect(rabbitBacks(s)).toEqual([1, 0]);
    expect(huntable(s)).toBe(true);
  });

  it("no rabbit when the deck can't spare a card for every red board", () => {
    // 8-seat PLO5, double board: both rivers red and only 2 cards left; red
    // river 1 takes them, so a fold there leaves nothing to hunt.
    const config: HandConfig = { ...PL, variant: VARIANTS.PLO5, boards: 2, redRiver: true };
    const deck = layDeck(40, "2c 3c 4c 2s 3s 4s 5c 5s 6h 6d 7h 7d");
    let s = play(start(seats(8), 1, config, deck), "4 fold", "5 fold", "6 fold", "7 fold", "8 fold", "1 fold", "2 call", "3 check");
    for (let i = 0; i < 3; i++) s = checkStreet(s);
    expect(s.street).toBe("extra");
    s = play(s, "2 raise 40", "3 fold");
    expect(huntable(s)).toBe(false);
    expect(rabbitCards(s)).toEqual([[], []]);
    expect(rabbitBacks(s)).toEqual([0, 0]);
  });

  it("no rabbit after run it twice", () => {
    const deck = stackDeck(holes, "2c 7h 9s Jd 4s 3c 8h Tc Qh 5h 6c");
    const s = play(start({ 1: 1000, 2: 1000 }, 1, { ...RR, runItTwice: "always" }, deck), "1 raise 1000", "2 call");
    expect(huntable(s)).toBe(false);
    expect(rabbitCards(s)).toEqual([[]]);
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

describe("red river replay", () => {
  const players = [
    { seat: 1, stack: 1000, postBlind: false },
    { seat: 2, stack: 1000, postBlind: false },
  ];
  // Heads-up, button 1: seat 2 (As Ad) acts first after the flop. River 5h is red.
  const deck = stackDeck(["As Ad", "Ks Kc"], "2c 7d 9s Jh 5h 4s");
  const checks = (seats: number[]): PlayerAction[] => seats.map((seat) => ({ type: "check", seat }));
  const actions: PlayerAction[] = [
    { type: "call", seat: 1 },
    ...checks([2]),
    ...checks([2, 1, 2, 1, 2, 1]), // flop, turn, river
  ];

  it("replays an old record identically", () => {
    // A record saved before red river existed: no redRiver key in its config.
    const record = { input: { config: NL, players, button: 1, deck }, actions };
    expect("redRiver" in record.input.config).toBe(false);
    const s = replayHand(record).at(-1)!;
    expect(s.street).toBe("complete");
    expect(s.boards[0]!).toHaveLength(5);
    expect(str(s.boards[0]!)).toBe("2c 7d 9s Jh 5h");
    expect(s.result!.payouts).toEqual([{ seat: 2, amount: 40 }]);
    expect(s.players.map((p) => [p.seat, p.stack])).toEqual([
      [1, 980],
      [2, 1020],
    ]);
  });

  it("replayHand reproduces a red river hand", () => {
    const config = { ...NL, redRiver: true };
    let live = start({ 1: 1000, 2: 1000 }, 1, config, deck);
    const record = { input: { config, players, button: 1, deck }, actions: [] as PlayerAction[] };
    for (const a of [...actions, ...checks([2, 1])]) {
      record.actions.push(a);
      live = applyAction(live, a);
    }
    expect(live.street).toBe("complete");
    expect(str(live.boards[0]!)).toBe("2c 7d 9s Jh 5h 4s");
    expect(live.extraRound).toBe(1);
    const states = replayHand(record);
    expect(states).toHaveLength(record.actions.length + 1);
    expect(states.at(-1)).toEqual(live);
  });
});
