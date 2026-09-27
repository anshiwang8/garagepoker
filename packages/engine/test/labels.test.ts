import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bestOmahaHand,
  Category,
  handLabel,
  makeDeck,
  parseCards,
  suitOf,
  VARIANTS,
} from "../src/index.js";

const nlh = (hole: string, board: string) =>
  handLabel(VARIANTS.NLH, parseCards(hole), parseCards(board)).text;
const plo = (hole: string, board: string) =>
  handLabel(VARIANTS.PLO, parseCards(hole), parseCards(board)).text;

describe("hand labels", () => {
  it("labels preflop hands", () => {
    expect(nlh("As Ad", "")).toBe("Pocket pair");
    expect(nlh("As Kd", "")).toBe("Ace high");
    expect(plo("As Ad Ah Kc", "")).toBe("Pocket pair");
  });

  it("names pairs relative to the board", () => {
    expect(nlh("Ks 4d", "Kh 9c 2s")).toBe("Top pair");
    expect(nlh("9s 4d", "Kh 9c 2s")).toBe("Second pair");
    expect(nlh("2d 4d", "Kh 9c 2s")).toBe("Bottom pair");
    expect(nlh("As Ad", "Kh 9c 2s")).toBe("Overpair");
    expect(nlh("5s 5d", "Kh 9c 2s")).toBe("Pocket pair");
    expect(nlh("As Qd", "Kh Kc 2s")).toBe("Pair");
  });

  it("names made hands", () => {
    expect(nlh("As Kd", "Ah Kc 2s")).toBe("Two pair");
    expect(nlh("2h 2d", "Ah Kc 2s")).toBe("Three of a kind");
    expect(nlh("Qs Jd", "Ah Kc Ts")).toBe("Straight");
    expect(nlh("Qh Jh", "Ah 3h 2h")).toBe("Flush");
    expect(nlh("2h 2d", "Ah Ac 2s")).toBe("Full house");
    expect(nlh("2h 2d", "2c 2s 7d")).toBe("Four of a kind");
    expect(nlh("9h 8h", "7h 6h 5h")).toBe("Straight flush");
    expect(nlh("Ah Kh", "Qh Jh Th")).toBe("Royal flush");
    expect(nlh("As 2d", "3h 4c 5s")).toBe("Straight");
  });

  it("Omaha labels use exactly 2 hole + 3 board", () => {
    // One heart in hand on a four-heart board: no flush in Omaha.
    expect(plo("Ah Kc Qd Js", "2h 5h 8h Th 3c")).toBe("Ace high");
    // Three kings in hand with a king on board: only two hole kings play.
    expect(plo("Kc Kd Kh 7s", "Ks 9c 2d")).toBe("Three of a kind");
    expect(plo("Kc Kd Kh 7s", "Qs 9c 2d")).toBe("Overpair");
    // Board trips + one hole card of that rank: quads need 1 hole + 3 board.
    expect(plo("Qc Jd 8h 7s", "Qs Qh Qd")).toBe("Four of a kind");
  });

  it("every Omaha label describes a 2 + 3 hand", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(makeDeck(52), { minLength: 10, maxLength: 10 }),
        fc.constantFrom(VARIANTS.PLO, VARIANTS.PLO5),
        fc.constantFrom(3, 4, 5),
        (cards, variant, boardCount) => {
          const hole = cards.slice(0, variant.holeCards);
          const board = cards.slice(variant.holeCards, variant.holeCards + boardCount);
          const label = handLabel(variant, hole, board);
          expect(label.value.cards.filter((c) => hole.includes(c))).toHaveLength(2);
          expect(label.value.cards.filter((c) => board.includes(c))).toHaveLength(3);
          expect(label.category).toBe(bestOmahaHand(hole, board).category);
          if (label.category === Category.Flush) {
            const suit = suitOf(label.value.cards[0]!);
            expect(hole.filter((c) => suitOf(c) === suit).length).toBeGreaterThanOrEqual(2);
          }
          expect(label.text.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 5000 },
    );
  });
});
