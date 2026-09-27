import { describe, expect, it } from "vitest";
import {
  applyAction,
  Category,
  legalActions,
  nextButton,
  potTotal,
  startHand,
  VARIANTS,
} from "../src/index.js";
import { bet, checkDown, NL, PL, play, player, stack, stackDeck, start } from "./helpers.js";

const four = { 1: 1000, 2: 1000, 3: 1000, 4: 1000 };
const three = { 1: 1000, 2: 1000, 3: 1000 };
const two = { 1: 1000, 2: 1000 };

describe("button and blinds", () => {
  it("moves the button one dealt-in seat per hand", () => {
    expect(nextButton(null, [5, 1, 3])).toBe(1);
    expect(nextButton(3, [1, 3, 5])).toBe(5);
    expect(nextButton(5, [1, 3, 5])).toBe(1);
    // The previous button left: the next seat after it gets the button.
    expect(nextButton(4, [1, 3, 5])).toBe(5);
  });

  it("heads-up: button posts the SB and acts first preflop, last after", () => {
    let s = start(two, 1);
    expect(bet(s, 1)).toBe(10);
    expect(bet(s, 2)).toBe(20);
    expect(s.toAct).toBe(1);
    s = play(s, "1 call");
    // Big blind's option.
    expect(s.toAct).toBe(2);
    expect(legalActions(s)).toMatchObject({ canCheck: true, canRaise: true });
    s = play(s, "2 check");
    expect(s.street).toBe("flop");
    expect(s.boards[0]).toHaveLength(3);
    expect(s.toAct).toBe(2);
  });

  it("3+ players: SB and BB left of the button, UTG first, SB first postflop", () => {
    let s = start(three, 1);
    expect([bet(s, 2), bet(s, 3)]).toEqual([10, 20]);
    expect(s.toAct).toBe(1);
    s = play(s, "1 call", "2 call", "3 check");
    expect(s.street).toBe("flop");
    expect(s.toAct).toBe(2);
  });

  it("wraps around the table", () => {
    const s = start({ 1: 1000, 3: 1000, 5: 1000 }, 3);
    expect(bet(s, 5)).toBe(10);
    expect(bet(s, 1)).toBe(20);
    expect(s.toAct).toBe(3);
  });

  it("a short big blind still makes others call the full big blind", () => {
    const s = start({ 1: 1000, 2: 1000, 3: 5 }, 1);
    expect(bet(s, 3)).toBe(5);
    expect(legalActions(s)).toMatchObject({ callAmount: 20, minRaiseTo: 40 });
  });

  it("a new player can post a live big blind and gets the option", () => {
    let s = start(four, 1, NL, undefined, [1]);
    expect(bet(s, 1)).toBe(20);
    expect(s.toAct).toBe(4);
    s = play(s, "4 call");
    expect(s.toAct).toBe(1);
    expect(legalActions(s)).toMatchObject({ canCheck: true, callAmount: 0, canRaise: true });
    s = play(s, "1 check", "2 call", "3 check");
    expect(s.street).toBe("flop");
    expect(potTotal(s)).toBe(80);
  });
});

describe("antes and straddle", () => {
  it("antes are dead money and don't count toward calling", () => {
    const s = start(three, 1, { ...NL, ante: 5 });
    expect(s.log.filter((e) => e.type === "ante")).toHaveLength(3);
    expect(potTotal(s)).toBe(45);
    expect(legalActions(s)!.callAmount).toBe(20);
  });

  it("an ante that puts a player all-in deals them in without a blind", () => {
    let s = start({ 1: 1000, 2: 5, 3: 1000 }, 1, { ...NL, ante: 5 });
    expect(stack(s, 2)).toBe(0);
    expect(s.log.some((e) => e.seat === 2 && e.type === "smallBlind")).toBe(false);
    s = play(s, "1 call");
    expect(s.toAct).toBe(3);
    s = checkDown(play(s, "3 check"));
    expect(s.street).toBe("complete");
    expect(s.result!.pots[0]).toMatchObject({ amount: 15, eligible: [1, 2, 3] });
  });

  it("UTG straddles 2 BB; action starts left of the straddler, who gets the option", () => {
    let s = start(four, 1, { ...NL, straddle: true });
    expect(bet(s, 4)).toBe(40);
    expect(s.toAct).toBe(1);
    expect(legalActions(s)).toMatchObject({ callAmount: 40, minRaiseTo: 80 });
    s = play(s, "1 call", "2 call", "3 call");
    expect(s.toAct).toBe(4);
    expect(legalActions(s)).toMatchObject({ canCheck: true, canRaise: true });
    s = play(s, "4 check");
    expect(s.street).toBe("flop");
    expect(s.toAct).toBe(2);
  });

  it("3-handed, UTG is the button and straddles", () => {
    const s = start(three, 1, { ...NL, straddle: true });
    expect(bet(s, 1)).toBe(40);
    expect(s.toAct).toBe(2);
  });

  it("no straddle heads-up or when UTG can't cover it", () => {
    expect(bet(start(two, 1, { ...NL, straddle: true }), 1)).toBe(10);
    const s = start({ ...four, 4: 40 }, 1, { ...NL, straddle: true });
    expect(bet(s, 4)).toBe(0);
    expect(s.toAct).toBe(4);
  });
});

describe("betting", () => {
  it("min-raise is the size of the last raise", () => {
    let s = start(four, 1);
    expect(legalActions(s)!.minRaiseTo).toBe(40);
    s = play(s, "4 raise 60");
    expect(legalActions(s)!.minRaiseTo).toBe(100);
    expect(() => play(s, "1 raise 99")).toThrow(/minimum raise/);
    s = play(s, "1 raise 100");
    expect(legalActions(s)!.minRaiseTo).toBe(140);
  });

  it("postflop: min bet is the BB; bet 100, raise to 250, min re-raise is 400", () => {
    let s = play(start(two, 1), "1 call", "2 check");
    expect(legalActions(s)).toMatchObject({ canCheck: true, minRaiseTo: 20 });
    s = play(s, "2 raise 100");
    expect(s.log.at(-1)!.type).toBe("bet");
    expect(legalActions(s)!.minRaiseTo).toBe(200);
    s = play(s, "1 raise 250");
    expect(s.log.at(-1)!.type).toBe("raise");
    expect(legalActions(s)!.minRaiseTo).toBe(400);
  });

  it("a short all-in does not reopen betting to players who already acted", () => {
    let s = play(start({ 1: 1000, 2: 1000, 3: 150 }, 1), "1 call", "2 call", "3 check");
    expect(s.toAct).toBe(2);
    s = play(s, "2 raise 100", "3 raise 130");
    expect(s.log.at(-1)).toMatchObject({ type: "raise", to: 130, allIn: true });
    // Seat 1 hasn't acted this street, so it may raise; the min raise is still +100.
    expect(legalActions(s)).toMatchObject({ seat: 1, canRaise: true, minRaiseTo: 230 });
    s = play(s, "1 call");
    // Seat 2 already acted and faces only 30 more: call or fold.
    expect(legalActions(s)).toMatchObject({ seat: 2, canRaise: false, callAmount: 30 });
    expect(() => play(s, "2 raise 400")).toThrow(/not allowed/);
    s = play(s, "2 call");
    expect(s.street).toBe("turn");
  });

  it("short all-ins that add up to a full raise do reopen betting", () => {
    let s = start({ 1: 1000, 2: 1000, 3: 170, 4: 220 }, 1);
    s = play(s, "4 call", "1 call", "2 call", "3 check", "2 raise 100", "3 raise 150", "4 raise 200");
    s = play(s, "1 call");
    expect(legalActions(s)).toMatchObject({ seat: 2, canRaise: true, minRaiseTo: 300 });
  });

  it("can't raise when everyone else is all-in", () => {
    const s = play(start({ 1: 1000, 2: 300 }, 1), "1 call", "2 check", "2 raise 280");
    expect(legalActions(s)).toMatchObject({ seat: 1, canRaise: false, callAmount: 280 });
  });

  it("rejects illegal actions without changing state", () => {
    const s = start(three, 1);
    const snapshot = JSON.stringify(s);
    expect(() => play(s, "2 call")).toThrow(/turn/);
    expect(() => play(s, "1 check")).toThrow(/check/);
    expect(() => play(s, "1 raise 40.5")).toThrow(/invalid amount/);
    expect(() => play(s, "1 raise 1001")).toThrow(/maximum/);
    expect(() => applyAction(s, { type: "shove", seat: 1 } as never)).toThrow(/unknown/);
    const option = play(s, "1 call", "2 call");
    expect(() => play(option, "3 call")).toThrow(/nothing to call/);
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it("rejects actions once the hand is complete", () => {
    const s = play(start(two, 1), "1 fold");
    expect(s.street).toBe("complete");
    expect(legalActions(s)).toBeNull();
    expect(() => play(s, "2 check")).toThrow(/complete/);
  });
});

describe("pot-limit", () => {
  it("caps a raise at call + the pot after the call", () => {
    let s = start(four, 1, PL);
    // Pot 30, call 20: raise to 20 + 30 + 20.
    expect(legalActions(s)!.maxRaiseTo).toBe(70);
    expect(() => play(s, "4 raise 71")).toThrow(/maximum/);
    s = play(s, "4 call");
    expect(legalActions(s)!.maxRaiseTo).toBe(90);
    s = play(s, "1 call", "2 call");
    // BB option: pot 80, nothing to call.
    expect(legalActions(s)!.maxRaiseTo).toBe(100);
    s = play(s, "3 check");
    expect(legalActions(s)!.maxRaiseTo).toBe(80);
    s = play(s, "2 raise 80");
    expect(legalActions(s)!.maxRaiseTo).toBe(320);
  });

  it("counts antes in the pot", () => {
    expect(legalActions(start(four, 1, { ...PL, ante: 5 }))!.maxRaiseTo).toBe(90);
  });

  it("allows all-in below the pot limit", () => {
    const s = start({ ...four, 4: 50 }, 1, PL);
    expect(legalActions(s)!.maxRaiseTo).toBe(50);
  });
});

describe("pots and showdown", () => {
  it("builds side pots and returns the uncalled bet", () => {
    // Button 1: deal order is seat 2, 3, 1.
    const deck = stackDeck(["Ah Ad", "Kh Kd", "Qh Qd"], "2c 7s 9c Js 4d");
    let s = start({ 1: 500, 2: 100, 3: 300 }, 1, NL, deck);
    s = play(s, "1 raise 500", "2 call", "3 call");
    expect(s.street).toBe("complete");
    expect(s.boards[0]).toHaveLength(5);
    expect(s.log.find((e) => e.type === "uncalled")).toMatchObject({ seat: 1, amount: 200 });
    expect(s.result!.pots).toMatchObject([
      { amount: 300, eligible: [1, 2, 3], winners: [{ seat: 2, amount: 300 }] },
      { amount: 400, eligible: [1, 3], winners: [{ seat: 3, amount: 400 }] },
    ]);
    expect([stack(s, 1), stack(s, 2), stack(s, 3)]).toEqual([200, 300, 400]);
  });

  it("splits ties and gives the odd chip to the first seat left of the button", () => {
    // Button 2: SB 3, BB 1. Deal order 3, 1, 2. The board is a royal flush.
    const deck = stackDeck(["2c 3d", "2d 3c", "4c 5d"], "Ts Js Qs Ks As");
    let s = start(three, 2, { ...NL, ante: 1 }, deck);
    s = checkDown(play(s, "2 fold", "3 call", "1 check"));
    expect(s.result!.pots).toMatchObject([
      {
        amount: 43,
        eligible: [1, 3],
        slices: [
          {
            board: 0,
            half: "high",
            amount: 43,
            // Winners in left-of-button order: seat 3 gets the odd chip.
            winners: [
              { seat: 3, amount: 22 },
              { seat: 1, amount: 21 },
            ],
          },
        ],
      },
    ]);
    expect([stack(s, 1), stack(s, 2), stack(s, 3)]).toEqual([1000, 999, 1001]);
  });

  it("everyone folds to the big blind: the uncalled part goes back", () => {
    const s = play(start(three, 1), "1 fold", "2 fold");
    expect(s.street).toBe("complete");
    expect(s.result!.showdown).toEqual([]);
    expect(s.log.at(-1)).toMatchObject({ type: "uncalled", seat: 3, amount: 10 });
    expect([stack(s, 1), stack(s, 2), stack(s, 3)]).toEqual([1000, 990, 1010]);
  });

  it("a folded-to bet is returned", () => {
    const s = play(start(two, 1), "1 call", "2 check", "2 raise 500", "1 fold");
    expect(s.result!.payouts).toEqual([{ seat: 2, amount: 40 }]);
    expect([stack(s, 1), stack(s, 2)]).toEqual([980, 1020]);
  });

  it("runs out the board when everyone is all-in", () => {
    const s = play(start({ 1: 500, 2: 800 }, 1), "1 raise 500", "2 call");
    expect(s.street).toBe("complete");
    expect(s.boards[0]).toHaveLength(5);
    expect(s.result!.showdown).toHaveLength(2);
    expect(stack(s, 1) + stack(s, 2)).toBe(1300);
  });

  it("skips betting on later streets when only one player has chips", () => {
    let s = play(start({ 1: 1000, 2: 1000, 3: 100 }, 1), "1 call", "2 call", "3 raise 100");
    s = play(s, "1 call", "2 call");
    expect(s.street).toBe("flop");
    expect(s.toAct).toBe(2);
    s = play(s, "2 check", "1 raise 200", "2 fold");
    // Seat 1 vs the all-in seat 3: no more betting, run it out.
    expect(s.street).toBe("complete");
    expect(s.boards[0]).toHaveLength(5);
  });

  it("Omaha showdown uses exactly 2 hole cards + 3 board cards", () => {
    // Heads-up, button 1: seat 2 is dealt first. Seat 2 has one heart on a
    // four-heart board, so no flush in Omaha, and loses to seat 1's nines.
    const deck = stackDeck(["Ah Kc Qd Js", "9h 9d 4c 4d"], "2h 5h 8h Th 3c");
    const s = checkDown(play(start(two, 1, PL, deck), "1 call"));
    const shown = s.result!.showdown;
    const byseat = (seat: number) => shown.find((x) => x.seat === seat)!.boards[0]!.high;
    expect(byseat(2).category).toBe(Category.HighCard);
    expect(byseat(1).category).toBe(Category.Pair);
    for (const { hole, boards } of shown) {
      expect(boards[0]!.high.cards.filter((c) => hole.includes(c))).toHaveLength(2);
      expect(boards[0]!.low).toBeNull();
    }
    expect(s.result!.payouts).toEqual([{ seat: 1, amount: 40 }]);
  });
});

describe("startHand validation", () => {
  it("rejects bad input", () => {
    expect(() => start(two, 3)).toThrow(/button/);
    expect(() => start({ 1: 1000, 2: 0 }, 1)).toThrow(/stack/);
    expect(() => start({ 1: 1000, 2: 10.5 }, 1)).toThrow(/stack/);
    expect(() => start({ 1: 1000 }, 1)).toThrow(/at least 2/);
    expect(() => start(two, 1, { ...NL, smallBlind: 30 })).toThrow(/small blind/);
    expect(() => start(two, 1, NL, [1, 1, ...Array.from({ length: 50 }, (_, i) => i + 2)])).toThrow(
      /deck/,
    );
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 1000]));
    expect(() => start(ten, 1, { ...NL, variant: VARIANTS.PLO5 })).toThrow(/not enough cards/);
    expect(() =>
      startHand({
        config: NL,
        players: [
          { seat: 1, stack: 100 },
          { seat: 1, stack: 100 },
        ],
        button: 1,
        deck: stackDeck([], ""),
      }),
    ).toThrow(/duplicate/);
  });

  it("deals each player their hole cards from the deck", () => {
    const s = start(three, 1, PL);
    expect(player(s, 2).hole).toHaveLength(4);
    const dealt = s.players.flatMap((p) => p.hole);
    expect(new Set(dealt).size).toBe(12);
  });
});
