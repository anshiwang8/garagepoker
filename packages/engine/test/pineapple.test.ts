import { describe, expect, it } from "vitest";
import {
  applyAction,
  Category,
  cardToString,
  handLabel,
  type HandState,
  legalActions,
  lowestCard,
  parseCard,
  parseCards,
  startHand,
  VARIANTS,
} from "../src/index.js";
import { NL, play, player, stackDeck, start } from "./helpers.js";

const PINE = { ...NL, variant: VARIANTS.PINEAPPLE };
const SHORT = { ...NL, variant: VARIANTS.SHORT };
const str = (cards: number[]) => cards.map(cardToString).join(" ");
const discard = (s: HandState, seat: number, card: string) =>
  applyAction(s, { type: "discard", seat, card: parseCard(card) });

describe("Pineapple (5-card)", () => {
  // Heads-up, button 1: seat 2 is dealt 5 cards first, then seat 1, then the board.
  const deck = () => stackDeck(["As Ad Kc 7h 2d", "Ks Kd Qc 8h 3d"], "Ah Kh 9c 4s 5s");

  it("everyone discards face down at the same time before each betting street, holding 2 on the river", () => {
    let s = start({ 1: 1000, 2: 1000 }, 1, PINE, deck());
    // Preflop: blinds are in, then both discard before any betting.
    expect(s.discard).toEqual({ pending: [1, 2], then: expect.anything() });
    expect(s.toAct).toBeNull();
    expect(legalActions(s)).toBeNull();
    expect(() => play(s, "1 call")).toThrow(/waiting for everyone to discard/);

    s = discard(s, 1, "3d"); // seat 1 can go first: not turn-based
    expect(s.discard!.pending).toEqual([2]);
    expect(() => discard(s, 1, "Qc")).toThrow(/nothing to discard/);
    expect(() => discard(s, 2, "3d")).toThrow(/don't hold/);
    s = discard(s, 2, "2d");
    expect(s.discard).toBeNull();
    expect(player(s, 1).hole).toHaveLength(4);
    expect(s.toAct).toBe(1); // heads-up: the button acts first preflop

    s = play(s, "1 call", "2 check");
    expect(s.street).toBe("flop");
    expect(s.discard!.pending).toEqual([1, 2]); // flop discard before flop betting
    s = discard(discard(s, 2, "7h"), 1, "8h");
    expect(s.toAct).toBe(2);
    s = play(s, "2 check", "1 check");
    expect(s.street).toBe("turn");
    s = discard(discard(s, 1, "Qc"), 2, "Kc");
    expect(player(s, 1).hole.map(cardToString)).toEqual(["Ks", "Kd"]);
    expect(player(s, 2).hole.map(cardToString)).toEqual(["As", "Ad"]);
    s = play(s, "2 check", "1 check");
    // River: no discard; straight to betting.
    expect(s.street).toBe("river");
    expect(s.discard).toBeNull();
    s = play(s, "2 check", "1 check");

    // Best 5 of 7: seat 2's aces make trips (As Ad + Ah); seat 1's kings make trips too (Ks Kd + Kh).
    const shown = s.result!.showdown;
    expect(shown.every((h) => h.hole.length === 2)).toBe(true);
    expect(shown.find((h) => h.seat === 2)!.boards[0]!.high.category).toBe(Category.Trips);
    expect(s.result!.payouts).toEqual([{ seat: 2, amount: 40 }]);
    // Discards are recorded server-side only, never in the log.
    expect(str(player(s, 1).discards)).toBe("3d 8h Qc");
    expect(s.log.filter((e) => e.type === "discard")).toHaveLength(6);
    for (const e of s.log.filter((x) => x.type === "discard")) {
      expect(Object.keys(e).sort()).toEqual(["amount", "seat", "street", "type"]);
    }
  });

  it("bomb pots discard preflop, then flop, before the first betting round", () => {
    let s = start({ 1: 1000, 2: 1000 }, 1, { ...PINE, bombPot: { ante: 40 } }, deck());
    expect(s.street).toBe("preflop");
    expect(s.discard!.pending).toEqual([1, 2]);
    s = discard(discard(s, 1, "3d"), 2, "2d");
    // No preflop betting: the flop comes, then its discard.
    expect(s.street).toBe("flop");
    expect(s.boards[0]).toHaveLength(3);
    expect(s.discard!.pending).toEqual([1, 2]);
    s = discard(discard(s, 1, "8h"), 2, "7h");
    expect(s.toAct).toBe(2);
    expect(legalActions(s)).toMatchObject({ canCheck: true });
  });

  it("all-in players still discard on each street as the board runs out", () => {
    let s = start({ 1: 500, 2: 500 }, 1, { ...PINE, runItTwice: "always" }, deck());
    s = discard(discard(s, 1, "3d"), 2, "2d");
    s = play(s, "1 raise 500", "2 call");
    // Nobody can bet, but the flop and turn discards still happen, so run it
    // twice isn't possible (each run would need its own discards).
    expect(s.street).toBe("flop");
    expect(s.discard!.pending).toEqual([1, 2]);
    s = discard(discard(s, 2, "7h"), 1, "8h");
    expect(s.street).toBe("turn");
    s = discard(discard(s, 2, "Kc"), 1, "Qc");
    expect(s.street).toBe("complete");
    expect(s.secondRun).toBeNull();
    expect(s.result!.showdown.every((h) => h.hole.length === 2)).toBe(true);
  });

  it("can run it twice once only the river is left", () => {
    let s = start({ 1: 500, 2: 500 }, 1, { ...PINE, runItTwice: "always" }, deck());
    s = discard(discard(s, 1, "3d"), 2, "2d");
    s = play(s, "1 call", "2 check");
    s = discard(discard(s, 2, "7h"), 1, "8h");
    s = play(s, "2 check", "1 check");
    s = discard(discard(s, 2, "Kc"), 1, "Qc");
    s = play(s, "2 raise 480", "1 call");
    expect(s.street).toBe("complete");
    expect(s.secondRun![0]).toHaveLength(5);
  });

  it("a timed-out player discards the lowest card", () => {
    expect(cardToString(lowestCard(parseCards("As Kd 2h 7c 2c")))).toBe("2c");
    expect(cardToString(lowestCard(parseCards("Qs Jd")))).toBe("Jd");
  });

  it("rejects configs that can't work", () => {
    const bad = { ...NL, variant: { ...VARIANTS.PINEAPPLE, holeCards: 4 as const } };
    expect(() => start({ 1: 100, 2: 100 }, 1, bad)).toThrow(/5 hole cards/);
  });
});

describe("short deck", () => {
  it("deals from 36 cards and still ranks quads above a flush", () => {
    // Heads-up, button 1: seat 2 makes a spade flush, seat 1 four queens.
    const deck = stackDeck(["As Ks", "Qd Qh"], "Qs 9s 6s Qc 9d", 36);
    const s = play(start({ 1: 1000, 2: 1000 }, 1, SHORT, deck), "1 call", "2 check");
    let h = s;
    while (h.toAct !== null) h = applyAction(h, { type: "check", seat: h.toAct });
    const shown = h.result!.showdown;
    expect(shown.find((x) => x.seat === 2)!.boards[0]!.high.category).toBe(Category.Flush);
    expect(shown.find((x) => x.seat === 1)!.boards[0]!.high.category).toBe(Category.Quads);
    expect(h.result!.payouts).toEqual([{ seat: 1, amount: 40 }]);
    expect(h.deck).toHaveLength(36);
  });

  it("flush beats full house, trips beat a straight, A-6-7-8-9 is the lowest straight", () => {
    const deck = stackDeck(["As Ks", "Td Th"], "Ts 9s 6s 9c 7d", 36);
    let s = play(start({ 1: 1000, 2: 1000 }, 1, SHORT, deck), "1 call", "2 check");
    while (s.toAct !== null) s = applyAction(s, { type: "check", seat: s.toAct });
    // Seat 2: As Ks + Ts 9s 6s = flush. Seat 1: Td Th + Ts 9s 9c = full house. Flush wins.
    expect(s.result!.payouts).toEqual([{ seat: 2, amount: 40 }]);
    expect(handLabel(VARIANTS.SHORT, parseCards("As 7d"), parseCards("6c 8h 9s")).text).toBe("Straight");
    expect(handLabel(VARIANTS.NLH, parseCards("As 7d"), parseCards("6c 8h 9s")).text).toBe("Ace high");
  });

  it("has no Hi/Lo", () => {
    const hilo36 = { ...NL, variant: { ...VARIANTS.PLOHL, deckSize: 36 as const } };
    expect(() =>
      startHand({ config: hilo36, players: [{ seat: 1, stack: 100 }, { seat: 2, stack: 100 }], button: 1, deck: stackDeck([], "", 36) }),
    ).toThrow(/Hi\/Lo isn't available with short deck/);
  });
});
