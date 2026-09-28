import { describe, expect, it } from "vitest";
import {
  cardToString,
  handLabel,
  legalActions,
  parseCards,
  potTotal,
  splitEven,
  startHand,
  VARIANTS,
} from "../src/index.js";
import { checkDown, NL, PL, play, player, stack, stackDeck, start } from "./helpers.js";

const str = (cards: number[]) => cards.map(cardToString).join(" ");
const PLOHL = { ...PL, variant: VARIANTS.PLOHL };

describe("SPEC §10 phase 3 exit: double-board Hi/Lo bomb pot with a side pot", () => {
  it("splits every slice of every pot correctly", () => {
    // Button 1, so cards are dealt to seat 2, seat 3, seat 1. Then boards are
    // dealt street by street, board 1 before board 2:
    //   flop B1 "3c 4d 7h", flop B2 "9h 5s Jc", turn B1 "Qs", turn B2 "Jh",
    //   river B1 "Kd", river B2 "Tc".
    const deck = stackDeck(
      ["Qd Qc 8s 6h", "As 2s Kh Kc", "Ad 2h 9c 9d"],
      "3c 4d 7h 9h 5s Jc Qs Jh Kd Tc",
    );
    const config = { ...PLOHL, straddle: true, boards: 2 as const, bombPot: { ante: 40 } };
    let s = start({ 1: 1000, 2: 1000, 3: 103 }, 1, config, deck);

    // Bomb pot: 40 ante each, no blinds, no straddle, straight to the flop.
    expect(s.bombPot).toBe(true);
    expect(s.log.map((e) => e.type)).toEqual(["ante", "ante", "ante"]);
    expect(s.street).toBe("flop");
    expect(s.boards.map(str)).toEqual(["3c 4d 7h", "9h 5s Jc"]);
    expect(potTotal(s)).toBe(120); // 3 × 40
    // First to act is left of the button. Pot-limit bet max = the pot, 120.
    expect(legalActions(s)).toMatchObject({ seat: 2, canCheck: true, maxRaiseTo: 120 });

    s = play(s, "2 raise 120", "3 call", "1 call");
    expect(player(s, 3)).toMatchObject({ stack: 0, committed: 103 }); // 40 ante + 63 all-in call
    s = checkDown(s);
    expect(s.boards.map(str)).toEqual(["3c 4d 7h Qs Kd", "9h 5s Jc Jh Tc"]);

    // Committed: seat 1 = 40 + 120 = 160, seat 2 = 160, seat 3 = 103.
    // Main pot: 103 × 3 = 309 (seats 1, 2, 3). Side pot: (160 − 103) × 2 = 114 (seats 1, 2).
    const [main, side] = s.result!.pots;
    expect(main).toMatchObject({ amount: 309, eligible: [1, 2, 3] });
    expect(side).toMatchObject({ amount: 114, eligible: [1, 2] });

    expect(main!.slices).toEqual([
      // Board 1 share: 309 / 2 → 155 (board 1 takes the odd chip).
      // A low qualifies, so high = ceil(155 / 2) = 78 (odd chip to the high half).
      // Seat 3's trip kings (Kh Kc + Kd Q 7) beat seat 2's trip queens and seat 1's nines.
      { run: 0, board: 0, half: "high", amount: 78, winners: [{ seat: 3, amount: 78 }] },
      // Low = 155 − 78 = 77. Seats 3 and 1 tie with 7-4-3-2-A (A2 + 3 4 7);
      // seat 2's 8-7-6-4-3 is worse. 77 / 2 = 38 r1: the odd chip goes to the
      // first winner left of the button (order 2, 3, 1), so seat 3 gets 39, seat 1 gets 38.
      {
        run: 0,
        board: 0,
        half: "low",
        amount: 77,
        winners: [
          { seat: 3, amount: 39 },
          { seat: 1, amount: 38 },
        ],
      },
      // Board 2 share: 309 − 155 = 154. Board 2 has one low card (5), so no low:
      // the high takes all 154. Seat 1's nines full (9c 9d + 9h Jc Jh) wins.
      { run: 0, board: 1, half: "high", amount: 154, winners: [{ seat: 1, amount: 154 }] },
    ]);

    expect(side!.slices).toEqual([
      // Board 1 share: 114 / 2 = 57. High = ceil(57 / 2) = 29. Seat 3 isn't
      // eligible, so seat 2's trip queens (Qd Qc + Qs K 7) win.
      { run: 0, board: 0, half: "high", amount: 29, winners: [{ seat: 2, amount: 29 }] },
      // Low = 57 − 29 = 28. Seat 1's 7-4-3-2-A beats seat 2's 8-7-6-4-3.
      { run: 0, board: 0, half: "low", amount: 28, winners: [{ seat: 1, amount: 28 }] },
      // Board 2 share: 57, no low: seat 1's nines full take it.
      { run: 0, board: 1, half: "high", amount: 57, winners: [{ seat: 1, amount: 57 }] },
    ]);

    // Totals: seat 1 = 38 + 154 + 28 + 57 = 277; seat 2 = 29; seat 3 = 78 + 39 = 117.
    // 277 + 29 + 117 = 423 = 309 + 114.
    expect(s.result!.payouts).toEqual([
      { seat: 1, amount: 277 },
      { seat: 2, amount: 29 },
      { seat: 3, amount: 117 },
    ]);
    // Final stacks: seat 1 = 1000 − 160 + 277 = 1117; seat 2 = 1000 − 160 + 29 = 869;
    // seat 3 = 103 − 103 + 117 = 117. Sum 2103 = 1000 + 1000 + 103.
    expect([stack(s, 1), stack(s, 2), stack(s, 3)]).toEqual([1117, 869, 117]);

    // Labels show both halves per board and obey 2 + 3.
    const [b1, b2] = s.boards;
    expect(handLabel(VARIANTS.PLOHL, player(s, 2).hole, b1!).text).toBe("Three of a kind / 8-7 low");
    expect(handLabel(VARIANTS.PLOHL, player(s, 1).hole, b2!).text).toBe("Full house / no low");
  });
});

describe("hi/lo", () => {
  // Heads-up, button 1: seat 2 is dealt first.
  it("the high hand scoops when nobody has a low", () => {
    const deck = stackDeck(["Ah Kh Qc Jc", "9s 9d 2c 3d"], "Th 9h 4h Kd Qs");
    const s = checkDown(play(start({ 1: 1000, 2: 1000 }, 1, PLOHL, deck), "1 call"));
    // Board has only one low card (4): no low possible. Seat 2's A K + T 9 4
    // hearts is a flush; seat 1 has trip nines. Flush takes all 40.
    expect(s.result!.pots[0]!.slices).toEqual([{ run: 0, board: 0, half: "high", amount: 40, winners: [{ seat: 2, amount: 40 }] }]);
  });

  it("splits high and low, odd chip to the high half, and can scoop both", () => {
    // 3-handed with a 1-chip ante; seat 1 folds preflop so the pot is odd.
    // Button 1: cards go to seat 2, seat 3, seat 1.
    const deck = stackDeck(["As 2s Kc Kd", "8h 7h Qc Qd", "Tc Td Jc Jd"], "3c 4d 5h Ks 9c");
    let s = start({ 1: 1000, 2: 1000, 3: 1000 }, 1, { ...PLOHL, ante: 1 }, deck);
    // Button 1: SB 2, BB 3, seat 1 acts first.
    s = checkDown(play(s, "1 fold", "2 call", "3 check"));
    // Pot: 3 antes + 20 + 20 = 43. High = ceil(43 / 2) = 22, low = 21.
    // Seat 2 (As 2s Kc Kd): high = the wheel (A2 + 3 4 5), low = 5-4-3-2-A.
    // Seat 3 (8h 7h Qc Qd): high = pair of queens, low = 8-7-5-4-3. Seat 2 scoops.
    expect(s.result!.pots[0]!.slices).toEqual([
      { run: 0, board: 0, half: "high", amount: 22, winners: [{ seat: 2, amount: 22 }] },
      { run: 0, board: 0, half: "low", amount: 21, winners: [{ seat: 2, amount: 21 }] },
    ]);
    expect(s.result!.payouts).toEqual([{ seat: 2, amount: 43 }]);
  });

  it("labels show both halves", () => {
    const hole = parseCards("Ah 2h Kc Qd");
    // Only two low board cards (3, 6): Omaha needs three for a low.
    expect(handLabel(VARIANTS.PLOHL, hole, parseCards("3h 6h 9h")).text).toBe("Flush / no low");
    expect(handLabel(VARIANTS.PLOHL, hole, parseCards("3h 6h 8c")).text).toBe("Ace high / 8-6 low");
    expect(handLabel(VARIANTS.PLOHL, hole, parseCards("Th Js 9c")).text).toBe("Straight / no low");
    // Preflop: no board, so only the high half.
    expect(handLabel(VARIANTS.PLOHL, hole, []).text).toBe("Ace high");
  });
});

describe("double board", () => {
  it("each board takes half of each pot", () => {
    // NLH heads-up, button 1: seat 2 dealt first. Seat 2 wins board 1, seat 1 board 2.
    // Flops dealt B1 then B2, then turns, then rivers.
    const deck = stackDeck(["As Ad", "Ks Kd"], "2c 7h 9s  3c 8h Tc  Jd Qh  4s 5c".replace(/\s+/g, " "));
    const s = checkDown(play(start({ 1: 1000, 2: 1000 }, 1, { ...NL, boards: 2 }, deck), "1 call"));
    expect(s.boards.map(str)).toEqual(["2c 7h 9s Jd 4s", "3c 8h Tc Qh 5c"]);
    // Both players have one pair on each board; aces beat kings on both boards.
    // Pot 40: 20 per board, both to seat 2.
    expect(s.result!.pots[0]!.slices).toEqual([
      { run: 0, board: 0, half: "high", amount: 20, winners: [{ seat: 2, amount: 20 }] },
      { run: 0, board: 1, half: "high", amount: 20, winners: [{ seat: 2, amount: 20 }] },
    ]);
  });

  it("splits boards between different winners, odd chip to board 1", () => {
    // Seat 2 (Ah Kh) makes a flush on board 1; seat 1 (Qs Qd) makes trips on board 2.
    const deck = stackDeck(["Ah Kh", "Qs Qd"], "2h 7h 9h  Qc 8s 3d  Jd 4c  5s 6d".replace(/\s+/g, " "));
    const s = checkDown(play(start({ 1: 1000, 2: 1000 }, 1, { ...NL, ante: 1, boards: 2 }, deck), "1 call"));
    // Pot = 2 antes + 20 + 20 = 42: 21 per board. (Heads-up with equal calls the
    // pot is always even, so the board odd-chip rule is checked via splitEven below.)
    expect(s.result!.pots[0]!.slices).toEqual([
      { run: 0, board: 0, half: "high", amount: 21, winners: [{ seat: 2, amount: 21 }] },
      { run: 0, board: 1, half: "high", amount: 21, winners: [{ seat: 1, amount: 21 }] },
    ]);
    expect(splitEven(155, 2)).toEqual([78, 77]);
    expect(splitEven(309, 2)).toEqual([155, 154]);
    expect(splitEven(1, 2)).toEqual([1, 0]);
  });

  it("enforces deck math: seats × hole + boards × 5 ≤ deck", () => {
    const stacks = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 1000]));
    const plo5 = { ...PL, variant: VARIANTS.PLO5, boards: 2 as const };
    // 8 × 5 + 2 × 5 = 50 ≤ 52: fine. 9 × 5 + 2 × 5 = 55 > 52: refused (SPEC §3).
    expect(() => start(stacks(8), 1, plo5)).not.toThrow();
    expect(() => start(stacks(9), 1, plo5)).toThrow(/not enough cards: need 55/);
    expect(() => start(stacks(2), 1, { ...NL, boards: 3 as never })).toThrow(/boards/);
  });
});

describe("bomb pots", () => {
  it("antes everyone, skips blinds, straddle and preflop betting", () => {
    const s = start({ 1: 1000, 2: 1000, 3: 1000, 4: 1000 }, 1, { ...NL, straddle: true, ante: 5, bombPot: { ante: 40 } });
    expect(s.street).toBe("flop");
    expect(s.boards[0]).toHaveLength(3);
    // Only the bomb ante is posted: no regular ante, blinds or straddle.
    expect(s.log).toEqual([2, 3, 4, 1].map((seat) => ({ street: "preflop", seat, type: "ante", amount: 40, allIn: false })));
    expect(s.currentBet).toBe(0);
    expect(s.toAct).toBe(2);
    expect(legalActions(s)).toMatchObject({ canCheck: true, minRaiseTo: 20 });
  });

  it("short stacks ante all-in and are still dealt in; with nobody left to bet it runs out", () => {
    const s = start({ 1: 30, 2: 1000 }, 1, { ...NL, bombPot: { ante: 40 } });
    // Seat 1 antes all-in for 30; only seat 2 has chips, so no betting: run it out.
    expect(s.street).toBe("complete");
    expect(s.boards[0]).toHaveLength(5);
    // Antes are dead money, not bets: seat 2's extra 10 forms a side pot only
    // seat 2 can win, and the 60 main pot is contested.
    expect(s.result!.pots).toMatchObject([
      { amount: 60, eligible: [1, 2] },
      { amount: 10, eligible: [2], slices: [{ run: null, board: null, half: null, amount: 10, winners: [{ seat: 2, amount: 10 }] }] },
    ]);
    expect(stack(s, 1) + stack(s, 2)).toBe(1030);
  });

  it("rejects a zero bomb-pot ante", () => {
    expect(() =>
      startHand({ config: { ...NL, bombPot: { ante: 0 } }, players: [{ seat: 1, stack: 100 }, { seat: 2, stack: 100 }], button: 1, deck: stackDeck([], "") }),
    ).toThrow(/bomb pot ante/);
  });
});
