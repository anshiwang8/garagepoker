import { describe, expect, it } from "vitest";
import {
  EngineError,
  holeCardsOnStreet,
  isRed,
  makeDeck,
  parseCards,
  rabbitCards,
  startHand,
  VARIANTS,
} from "../src/index.js";
import { checkDown, NL, play, player, start } from "./helpers.js";

const RP = { ...NL, variant: VARIANTS.REVERSE_PINEAPPLE };
const deck = makeDeck(52);
const stacks3 = { 1: 1000, 2: 1000, 3: 1000 };
// 3 players, button seat 1: preflop 1 calls, 2 calls, 3 checks.
const callAround = (s: ReturnType<typeof start>) => play(s, "1 call", "2 call", "3 check");

describe("Reverse Pineapple", () => {
  it("deals 2 preflop and 1 per street in seat order", () => {
    let s = start(stacks3, 1, RP, deck);
    for (const seat of [1, 2, 3]) expect(player(s, seat).hole).toHaveLength(2);
    expect(player(s, 2).hole).toEqual([deck[0], deck[1]]);
    expect(player(s, 1).hole).toEqual([deck[4], deck[5]]);

    s = callAround(s);
    expect(s.street).toBe("flop");
    expect(player(s, 2).hole).toEqual([deck[0], deck[1], deck[6]]);
    expect(player(s, 3).hole).toEqual([deck[2], deck[3], deck[7]]);
    expect(player(s, 1).hole).toEqual([deck[4], deck[5], deck[8]]);
    expect(s.boards[0]).toEqual(deck.slice(9, 12));

    s = checkDown(s);
    for (const seat of [1, 2, 3]) expect(player(s, seat).hole).toHaveLength(5);
    expect(player(s, 1).hole.at(-1)).toBe(deck[18]);
    expect(s.boards[0]).toEqual([...deck.slice(9, 12), deck[15], deck[19]]);
  });

  it("folded players get no later hole cards", () => {
    let s = start(stacks3, 1, RP, deck);
    s = play(s, "1 call", "2 call", "3 fold");
    expect(s.street).toBe("flop");
    expect(player(s, 2).hole.at(-1)).toBe(deck[6]);
    expect(player(s, 1).hole.at(-1)).toBe(deck[7]);
    expect(s.boards[0]).toEqual(deck.slice(8, 11));
    expect(player(s, 3).hole).toHaveLength(2);
  });

  it("showdown uses any number of hole cards", () => {
    // Heads-up, button 1: seat 2 is dealt first. Each gets 5 cards in the end.
    // Board royal flush in spades; neither player holds a spade.
    const none = [
      ...parseCards("2c 3d"), // seat 2 preflop
      ...parseCards("2h 3h"), // seat 1 preflop
      ...parseCards("4c"), // seat 2 flop hole
      ...parseCards("4d"), // seat 1 flop hole
      ...parseCards("As Ks Qs"), // flop
      ...parseCards("5c"),
      ...parseCards("5d"),
      ...parseCards("Js"),
      ...parseCards("6c"),
      ...parseCards("6d"),
      ...parseCards("Ts"),
    ];
    const d1 = [...none, ...deck.filter((c) => !none.includes(c))];
    let s = start({ 1: 1000, 2: 1000 }, 1, RP, d1);
    s = checkDown(play(s, "1 call", "2 check"));
    expect(s.result!.pots[0]!.winners.map((w) => w.seat).sort()).toEqual([1, 2]);

    // Seat 2's five hearts beat the straight on the board that seat 1 plays.
    const five = [
      ...parseCards("2h 3h"), // seat 2
      ...parseCards("Ks Kd"), // seat 1
      ...parseCards("4h"), // seat 2 flop hole
      ...parseCards("2c"), // seat 1 flop hole
      ...parseCards("5c 6d 7s"),
      ...parseCards("Qh"), // seat 2 turn hole
      ...parseCards("Qd"), // seat 1 turn hole
      ...parseCards("8d"),
      ...parseCards("Jh"), // seat 2 river hole
      ...parseCards("As"), // seat 1 river hole
      ...parseCards("9c"),
    ];
    const d2 = [...five, ...deck.filter((c) => !five.includes(c))];
    s = start({ 1: 1000, 2: 1000 }, 1, RP, d2);
    s = checkDown(play(s, "1 call", "2 check"));
    expect(s.result!.pots[0]!.winners.map((w) => w.seat)).toEqual([2]);
  });

  it("all-in run-out deals the remaining hole cards", () => {
    let s = start({ 1: 1000, 2: 1000 }, 1, RP, deck);
    s = play(s, "1 call", "2 check");
    s = play(s, "2 raise 980", "1 call");
    expect(s.street).toBe("complete");
    for (const seat of [1, 2]) expect(player(s, seat).hole).toHaveLength(5);
    expect(s.boards[0]).toHaveLength(5);
    const all = [...player(s, 1).hole, ...player(s, 2).hole, ...s.boards[0]!];
    expect(new Set(all).size).toBe(15);
    expect(s.deckIndex).toBe(15);
  });

  describe("run it twice", () => {
    const rit = { ...RP, runItTwice: "always" as const };

    it("never splits while hole cards are still to come", () => {
      let s = start({ 1: 1000, 2: 1000 }, 1, rit, deck);
      s = play(s, "1 raise 1000", "2 call");
      expect(s.secondRun).toBeNull();
      expect(s.street).toBe("complete");
      for (const seat of [1, 2]) expect(player(s, seat).hole).toHaveLength(5);

      // All in on the turn: the river still deals a hole card.
      s = start({ 1: 1000, 2: 1000 }, 1, rit, deck);
      s = play(s, "1 call", "2 check", "2 check", "1 check", "2 raise 980", "1 call");
      expect(s.secondRun).toBeNull();
      expect(s.street).toBe("complete");
    });

    it("has nothing to run twice on the river", () => {
      // makeDeck's river card (deck[19]) is black, so nothing is left to come.
      let s = start({ 1: 1000, 2: 1000 }, 1, rit, deck);
      s = play(s, "1 call", "2 check", "2 check", "1 check", "2 check", "1 check");
      s = play(s, "2 raise 980", "1 call");
      expect(s.street).toBe("complete");
      expect(s.secondRun).toBeNull();
    });

    it("runs twice for a red river card on the river", () => {
      const cfg = { ...rit, redRiver: true };
      // 2 players, button 1. Board 9c Tc Jc Qc Kd (red river); spare black cards follow.
      const order = [
        ...parseCards("2d 3d"), // seat 2
        ...parseCards("2h 3h"), // seat 1
        ...parseCards("4d"),
        ...parseCards("4h"),
        ...parseCards("9c Tc Jc"),
        ...parseCards("5d"),
        ...parseCards("5h"),
        ...parseCards("Qc"),
        ...parseCards("6d"),
        ...parseCards("6h"),
        ...parseCards("Kd"), // red river
      ];
      const d = [...order, ...deck.filter((c) => !order.includes(c))];
      let s = start({ 1: 1000, 2: 1000 }, 1, cfg, d);
      s = play(s, "1 call", "2 check", "2 check", "1 check", "2 check", "1 check");
      expect(s.street).toBe("river");
      s = play(s, "2 raise 980", "1 call");
      expect(s.secondRun).not.toBeNull();
      expect(s.street).toBe("complete");
      expect(!isRed(s.boards[0]!.at(-1)!) || s.redRiverStopped).toBe(true);
      expect(!isRed(s.secondRun![0]!.at(-1)!) || s.redRiverStopped).toBe(true);
    });
  });

  it("bomb pot deals the flop hole card at once", () => {
    const s = start(stacks3, 1, { ...RP, bombPot: { ante: 20 } }, deck);
    for (const seat of [1, 2, 3]) expect(player(s, seat).hole).toHaveLength(3);
    expect(s.boards[0]).toHaveLength(3);
  });

  it("rabbit hunt continues in play order", () => {
    let s = start(stacks3, 1, RP, deck);
    s = callAround(s);
    s = play(s, "2 raise 60", "3 fold", "1 fold");
    expect(s.street).toBe("complete");
    const hunt = rabbitCards(s);
    expect(hunt[0]).toEqual([deck[13], deck[15]]);
    // The real state is untouched: the winner (seat 2) holds only the flop hole card.
    expect(player(s, 2).hole).toEqual([deck[0], deck[1], deck[6]]);
    expect(s.boards[0]).toHaveLength(3);
  });

  it("validation", () => {
    const bad = (variant: object) => () =>
      startHand({
        config: { ...NL, variant: { ...VARIANTS.REVERSE_PINEAPPLE, ...variant } as never },
        players: [
          { seat: 1, stack: 1000 },
          { seat: 2, stack: 1000 },
        ],
        button: 1,
        deck,
      });
    expect(bad({ laterHole: [1, 1, 3] })).toThrow(/must leave some for the preflop/);
    expect(bad({ discard: true })).toThrow(/discards aren't available with later hole cards/);
    expect(bad({ laterHole: [-1, 1, 1] })).toThrow(/must be whole numbers/);
    expect(bad({ ...VARIANTS.TICTACTOE, laterHole: [1, 0, 0] })).toThrow(/aren't available with line hands/);
    expect(bad({ laterHole: [1, 1, 3] })).toThrow(EngineError);
  });

  it("other variants deal as before", () => {
    expect(holeCardsOnStreet(VARIANTS.NLH, "preflop")).toBe(2);
    expect(holeCardsOnStreet(VARIANTS.NLH, "flop")).toBe(0);
    const s = checkDown(play(start(stacks3, 1, NL, deck), "1 call", "2 call", "3 check"));
    expect(player(s, 2).hole).toEqual([deck[0], deck[1]]);
    expect(s.boards[0]).toEqual(deck.slice(6, 11));
  });
});
