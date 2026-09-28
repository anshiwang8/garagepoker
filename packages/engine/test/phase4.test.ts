import { describe, expect, it } from "vitest";
import {
  applyAction,
  cardToString,
  legalActions,
  rabbitCards,
  VARIANTS,
} from "../src/index.js";
import { NL, PL, play, player, stack, stackDeck, start } from "./helpers.js";

const str = (cards: number[]) => cards.map(cardToString).join(" ");
const PLOHL = { ...PL, variant: VARIANTS.PLOHL };
const rit = (s: ReturnType<typeof start>, seat: number, accept: boolean) =>
  applyAction(s, { type: "runItTwice", seat, accept });

describe("run it twice", () => {
  it("splits each pot by run, then board, then hi/lo, with a side pot", () => {
    // The phase 3 exit hand, but seat 1 has only 160, so the flop call puts it
    // all-in and seat 2 is the only player with chips: a run-out.
    // Deal order: seat 2, seat 3, seat 1; then flops B1, B2; then run 1 (turn
    // B1, turn B2, river B1, river B2); then run 2 in the same order.
    const deck = stackDeck(
      ["Qd Qc 8s 6h", "As 2s Kh Kc", "Ad 2h 9c 9d"],
      "3c 4d 7h 9h 5s Jc  Qs Jh Kd Tc  8c Ks 8d 2c".replace(/\s+/g, " "),
    );
    const config = { ...PLOHL, boards: 2 as const, bombPot: { ante: 40 }, runItTwice: "ask" as const };
    let s = start({ 1: 160, 2: 1000, 3: 103 }, 1, config, deck);
    s = play(s, "2 raise 120", "3 call", "1 call");

    // Everyone left is all-in but seat 2: every player in the pot is asked.
    expect(s.ritOffer).toEqual({ seats: [1, 2, 3], accepted: [] });
    expect(s.toAct).toBeNull();
    expect(legalActions(s)).toBeNull();
    expect(() => play(s, "2 check")).toThrow(/run/);
    s = rit(rit(s, 3, true), 1, true);
    expect(s.street).toBe("flop"); // still waiting for seat 2
    s = rit(s, 2, true);
    expect(s.street).toBe("complete");

    expect(s.boards.map(str)).toEqual(["3c 4d 7h Qs Kd", "9h 5s Jc Jh Tc"]);
    expect(s.secondRun!.map(str)).toEqual(["3c 4d 7h 8c 8d", "9h 5s Jc Ks 2c"]);

    // Committed: seat 1 = 40 + 120 = 160, seat 2 = 160, seat 3 = 40 + 63 = 103.
    // Main pot 103 × 3 = 309 (seats 1-3); side pot (160 − 103) × 2 = 114 (seats 1, 2).
    const [main, side] = s.result!.pots;
    expect(main).toMatchObject({ amount: 309, eligible: [1, 2, 3] });
    expect(side).toMatchObject({ amount: 114, eligible: [1, 2] });

    expect(main!.slices).toEqual([
      // Run 1 gets 309 / 2 → 155 (odd chip to run 1); board 1 gets 155 / 2 → 78.
      // A low qualifies: high = ceil(78 / 2) = 39 to seat 3's trip kings.
      { run: 0, board: 0, half: "high", amount: 39, winners: [{ seat: 3, amount: 39 }] },
      // Low = 39: seats 3 and 1 tie with 7-4-3-2-A → 19 r1; odd chip to the
      // first winner left of the button (order 2, 3, 1): seat 3 gets 20.
      { run: 0, board: 0, half: "low", amount: 39, winners: [{ seat: 3, amount: 20 }, { seat: 1, amount: 19 }] },
      // Run 1 board 2 = 155 − 78 = 77, no low possible: seat 1's nines full.
      { run: 0, board: 1, half: "high", amount: 77, winners: [{ seat: 1, amount: 77 }] },
      // Run 2 gets 309 − 155 = 154; board 1 gets 77. High = ceil(77 / 2) = 39:
      // seat 2's trip eights (8s + 8c 8d) beat two pair for seats 3 and 1.
      { run: 1, board: 0, half: "high", amount: 39, winners: [{ seat: 2, amount: 39 }] },
      // Low = 38: seats 3 and 1 tie again with 7-4-3-2-A → 19 each.
      { run: 1, board: 0, half: "low", amount: 38, winners: [{ seat: 3, amount: 19 }, { seat: 1, amount: 19 }] },
      // Run 2 board 2 = 77, no low (only 5 and 2): seat 3's trip kings (Kh Kc + Ks).
      { run: 1, board: 1, half: "high", amount: 77, winners: [{ seat: 3, amount: 77 }] },
    ]);

    expect(side!.slices).toEqual([
      // Run 1 gets 114 / 2 = 57; board 1 gets 29. High = 15: seat 2's trip queens
      // (seat 3 isn't eligible for the side pot).
      { run: 0, board: 0, half: "high", amount: 15, winners: [{ seat: 2, amount: 15 }] },
      // Low = 14: seat 1's 7-4-3-2-A beats seat 2's 8-7-6-4-3.
      { run: 0, board: 0, half: "low", amount: 14, winners: [{ seat: 1, amount: 14 }] },
      // Run 1 board 2 = 28: seat 1's nines full.
      { run: 0, board: 1, half: "high", amount: 28, winners: [{ seat: 1, amount: 28 }] },
      // Run 2 gets 57; board 1 gets 29. High = 15: seat 2's trip eights.
      { run: 1, board: 0, half: "high", amount: 15, winners: [{ seat: 2, amount: 15 }] },
      // Low = 14: seat 1.
      { run: 1, board: 0, half: "low", amount: 14, winners: [{ seat: 1, amount: 14 }] },
      // Run 2 board 2 = 28: seat 1's trip nines beat seat 2's pair of queens.
      { run: 1, board: 1, half: "high", amount: 28, winners: [{ seat: 1, amount: 28 }] },
    ]);

    // Seat 1: 19 + 77 + 19 + 14 + 28 + 14 + 28 = 199. Seat 2: 39 + 15 + 15 = 69.
    // Seat 3: 39 + 20 + 19 + 77 = 155. Total 423 = 309 + 114.
    expect(s.result!.payouts).toEqual([
      { seat: 1, amount: 199 },
      { seat: 2, amount: 69 },
      { seat: 3, amount: 155 },
    ]);
    // Final stacks: 160 − 160 + 199; 1000 − 160 + 69; 103 − 103 + 155. Sum 1263.
    expect([stack(s, 1), stack(s, 2), stack(s, 3)]).toEqual([199, 909, 155]);
    // Showdown hands are evaluated on both runs.
    expect(s.result!.showdown.every((h) => h.secondRun?.length === 2)).toBe(true);
  });

  it("any decline runs it once, using run 1's cards", () => {
    const deck = stackDeck(["As Ad", "Ks Kd"], "2c 7h 9s Jd 4s  3c 8h Tc Qh 5c".replace(/\s+/g, " "));
    let s = start({ 1: 500, 2: 500 }, 1, { ...NL, runItTwice: "ask" }, deck);
    s = play(s, "1 raise 500", "2 call");
    expect(s.ritOffer).toEqual({ seats: [1, 2], accepted: [] });
    s = rit(rit(s, 1, true), 2, false);
    expect(s.street).toBe("complete");
    expect(s.secondRun).toBeNull();
    expect(str(s.boards[0]!)).toBe("2c 7h 9s Jd 4s");
    expect(s.log.slice(-2).map((e) => e.type)).toEqual(["ritAccept", "ritDecline"]);
    expect(s.result!.pots[0]!.slices.every((sl) => sl.run === 0)).toBe(true);
    expect(stack(s, 2)).toBe(1000); // aces hold
  });

  it("'always' runs twice without asking; 'no' never offers", () => {
    const deck = stackDeck(["As Ad", "Ks Kd"], "2c 7h 9s Jd 4s 3c 8h Tc Qh 5c");
    const always = play(start({ 1: 500, 2: 500 }, 1, { ...NL, runItTwice: "always" }, deck), "1 raise 500", "2 call");
    expect(always.street).toBe("complete");
    expect(always.secondRun!.map(str)).toEqual(["3c 8h Tc Qh 5c"]);
    // Pot 1000: 500 per run; aces win both runs.
    expect(always.result!.pots[0]!.slices.map((sl) => [sl.run, sl.amount])).toEqual([
      [0, 500],
      [1, 500],
    ]);
    const no = play(start({ 1: 500, 2: 500 }, 1, NL, deck), "1 raise 500", "2 call");
    expect(no.ritOffer).toBeNull();
    expect(no.secondRun).toBeNull();
  });

  it("is only offered when no more action is possible and cards are still to come", () => {
    const ask = { ...NL, runItTwice: "ask" as const };
    // Two players still have chips after the preflop all-in: action continues.
    let s = play(start({ 1: 1000, 2: 1000, 3: 100 }, 1, ask), "1 raise 100", "2 call", "3 call");
    expect(s.ritOffer).toBeNull();
    expect(s.street).toBe("flop");
    // All-in on the river: nothing left to run.
    s = play(start({ 1: 500, 2: 500 }, 1, ask), "1 call", "2 check", "2 check", "1 check", "2 check", "1 check");
    s = play(s, "2 raise 480", "1 call");
    expect(s.street).toBe("complete");
    expect(s.ritOffer).toBeNull();
  });

  it("isn't offered when the deck can't cover two runs", () => {
    // PLO5, double board, 8 players: 40 hole + 6 flop cards leave 6; two more
    // runs of turn + river on two boards need 8.
    const stacks = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, 1000]));
    const config = { ...PL, variant: VARIANTS.PLO5, boards: 2 as const, bombPot: { ante: 1000 }, runItTwice: "always" as const };
    const s = start(stacks, 1, config);
    expect(s.street).toBe("complete"); // everyone all-in from the ante: runs out once
    expect(s.secondRun).toBeNull();
  });

  it("rejects decisions from outside the pot or twice", () => {
    let s = play(start({ 1: 500, 2: 500 }, 1, { ...NL, runItTwice: "ask" }), "1 raise 500", "2 call");
    expect(() => rit(s, 3, true)).toThrow(/isn't in the pot/);
    s = rit(s, 1, true);
    expect(() => rit(s, 1, true)).toThrow(/already accepted/);
    expect(() => rit(start({ 1: 500, 2: 500 }, 1, NL), 1, true)).toThrow(/isn't being offered/);
  });
});

describe("rabbit hunt", () => {
  it("shows the cards that would have come, from the same deck", () => {
    // Heads-up, button 1: 4 hole cards, then flop, turn, river in order.
    const deck = stackDeck(["As Ad", "Ks Kd"], "2c 7h 9s Jd 4s");
    const s = play(start({ 1: 1000, 2: 1000 }, 1, NL, deck), "1 raise 60", "2 fold");
    expect(s.boards[0]).toEqual([]);
    expect(rabbitCards(s).map(str)).toEqual(["2c 7h 9s Jd 4s"]);
    // Pure: the hand and its pots are untouched.
    expect(s.boards[0]).toEqual([]);
    expect(stack(s, 1)).toBe(1020);
  });

  it("only hunts the missing streets, on every board", () => {
    // Double board: flop B1, flop B2, turn B1, turn B2, river B1, river B2.
    const deck = stackDeck(["As Ad", "Ks Kd"], "2c 7h 9s 3c 8h Tc Jd Qh 4s 5c");
    let s = play(start({ 1: 1000, 2: 1000 }, 1, { ...NL, boards: 2 }, deck), "1 call", "2 check");
    s = play(s, "2 raise 20", "1 fold");
    expect(rabbitCards(s).map(str)).toEqual(["Jd 4s", "Qh 5c"]);
  });

  it("has nothing to hunt after a full board, and refuses mid-hand", () => {
    const allIn = play(start({ 1: 500, 2: 500 }, 1, NL), "1 raise 500", "2 call");
    expect(rabbitCards(allIn)).toEqual([[]]);
    expect(() => rabbitCards(start({ 1: 500, 2: 500 }, 1, NL))).toThrow(/isn't over/);
    expect(player(allIn, 1).hole).toHaveLength(2);
  });
});
