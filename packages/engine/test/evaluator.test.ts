import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bestHand,
  bestLow,
  bestOmahaHand,
  bestOmahaLow,
  type Card,
  Category,
  describeLow,
  evaluate,
  evaluateLow,
  forEachCombination,
  makeDeck,
  parseCards,
  type Ranking,
} from "../src/index.js";

const h = parseCards;
const score = (cards: string, ranking: Ranking = "standard") => evaluate(h(cards), ranking).score;
const category = (cards: string, ranking: Ranking = "standard") =>
  evaluate(h(cards), ranking).category;

/** Evaluates every 5-card hand from the deck; returns category counts and distinct scores. */
function enumerate(deck: Card[], ranking: Ranking) {
  const counts = new Array<number>(9).fill(0);
  const scores = new Set<number>();
  const byCategory = Array.from({ length: 9 }, () => ({ min: Infinity, max: -Infinity }));
  const hand: Card[] = [0, 0, 0, 0, 0];
  const n = deck.length;
  for (let a = 0; a < n; a++) {
    hand[0] = deck[a]!;
    for (let b = a + 1; b < n; b++) {
      hand[1] = deck[b]!;
      for (let c = b + 1; c < n; c++) {
        hand[2] = deck[c]!;
        for (let d = c + 1; d < n; d++) {
          hand[3] = deck[d]!;
          for (let e = d + 1; e < n; e++) {
            hand[4] = deck[e]!;
            const v = evaluate(hand, ranking);
            counts[v.category]!++;
            scores.add(v.score);
            const r = byCategory[v.category]!;
            if (v.score < r.min) r.min = v.score;
            if (v.score > r.max) r.max = v.score;
          }
        }
      }
    }
  }
  return { counts, scores, byCategory };
}

/** Categories listed weakest to strongest must occupy disjoint, increasing score ranges. */
function expectCategoryOrder(
  byCategory: { min: number; max: number }[],
  weakestFirst: Category[],
) {
  for (let i = 1; i < weakestFirst.length; i++) {
    expect(byCategory[weakestFirst[i - 1]!]!.max).toBeLessThan(byCategory[weakestFirst[i]!]!.min);
  }
}

describe("exhaustive 5-card enumeration", () => {
  it("52-card deck matches the known category counts", () => {
    const { counts, scores, byCategory } = enumerate(makeDeck(52), "standard");
    expect(counts).toEqual([1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40]);
    // Every 5-card hand falls into one of 7462 distinct equivalence classes.
    expect(scores.size).toBe(7462);
    expectCategoryOrder(byCategory, [
      Category.HighCard,
      Category.Pair,
      Category.TwoPair,
      Category.Trips,
      Category.Straight,
      Category.Flush,
      Category.FullHouse,
      Category.Quads,
      Category.StraightFlush,
    ]);
  });

  it("36-card short deck matches the combinatorial category counts", () => {
    // 9 ranks, 4 suits, 6 straights (A-6-7-8-9 through T-J-Q-K-A):
    // HC (C(9,5)-6)(4^5-4), pair 9·6·C(8,3)·4^3, two pair C(9,2)·36·7·4,
    // trips 9·4·C(8,2)·16, straight 6(4^5-4), flush 4(C(9,5)-6),
    // full house 9·4·8·6, quads 9·32, straight flush 6·4.
    const { counts, byCategory } = enumerate(makeDeck(36), "shortdeck");
    expect(counts).toEqual([122400, 193536, 36288, 16128, 6120, 480, 1728, 288, 24]);
    expect(counts.reduce((a, b) => a + b)).toBe(376992);
    // Triton ordering: straight < trips, full house < flush.
    expectCategoryOrder(byCategory, [
      Category.HighCard,
      Category.Pair,
      Category.TwoPair,
      Category.Straight,
      Category.Trips,
      Category.FullHouse,
      Category.Flush,
      Category.Quads,
      Category.StraightFlush,
    ]);
  });

  it("52-card deck has 56 distinct 8-or-better lows over 57344 hands", () => {
    const deck = makeDeck(52);
    let qualifying = 0;
    const lows = new Set<number>();
    forEachCombination(deck, 5, (combo) => {
      const low = evaluateLow(combo);
      if (low) {
        qualifying++;
        lows.add(low.score);
      }
    });
    // C(8,5) rank sets, 4^5 suit assignments each.
    expect(lows.size).toBe(56);
    expect(qualifying).toBe(56 * 1024);
  });
});

describe("evaluate", () => {
  it("identifies each category", () => {
    expect(category("As Kd 9h 7c 2s")).toBe(Category.HighCard);
    expect(category("As Ad 9h 7c 2s")).toBe(Category.Pair);
    expect(category("As Ad 9h 9c 2s")).toBe(Category.TwoPair);
    expect(category("As Ad Ah 9c 2s")).toBe(Category.Trips);
    expect(category("9s Td Jh Qc Ks")).toBe(Category.Straight);
    expect(category("As Ks 9s 7s 2s")).toBe(Category.Flush);
    expect(category("As Ad Ah 9c 9s")).toBe(Category.FullHouse);
    expect(category("As Ad Ah Ac 9s")).toBe(Category.Quads);
    expect(category("Ts Js Qs Ks As")).toBe(Category.StraightFlush);
  });

  it("treats the ace as low only in the wheel", () => {
    expect(category("As 2d 3h 4c 5s")).toBe(Category.Straight);
    expect(category("As 2s 3s 4s 5s")).toBe(Category.StraightFlush);
    expect(score("As 2d 3h 4c 5s")).toBeLessThan(score("2s 3d 4h 5c 6s"));
    expect(category("Qs Kd Ah 2c 3s")).toBe(Category.HighCard);
    expect(category("As 6d 7h 8c 9s")).toBe(Category.HighCard);
  });

  it("orders kickers correctly", () => {
    expect(score("As Ad Kh 7c 2s")).toBeGreaterThan(score("As Ad Qh Jc Ts"));
    expect(score("Ks Kd 2h 2c As")).toBeGreaterThan(score("Qs Qd Jh Jc As"));
    expect(score("Ks Kd 5h 5c 3s")).toBeGreaterThan(score("Ks Kd 4h 4c As"));
    expect(score("Ks Kd 5h 5c 3s")).toBeLessThan(score("Kh Kc 5s 5d 4s"));
    expect(score("3s 3d 3h Ac Ks")).toBeLessThan(score("4s 4d 4h 2c 3c"));
    expect(score("Ks Kd Kh 2c 2s")).toBeGreaterThan(score("Qs Qd Qh Ac As"));
    expect(score("As Ks 9s 7s 2s")).toBe(score("Ad Kd 9d 7d 2d"));
  });

  it("uses short-deck rules", () => {
    expect(category("As 6d 7h 8c 9s", "shortdeck")).toBe(Category.Straight);
    expect(category("As 6s 7s 8s 9s", "shortdeck")).toBe(Category.StraightFlush);
    expect(score("As 6d 7h 8c 9s", "shortdeck")).toBeLessThan(score("6s 7d 8h 9c Ts", "shortdeck"));
    // Flush beats full house; trips beat a straight.
    expect(score("As Ks 9s 7s 6s", "shortdeck")).toBeGreaterThan(score("As Ad Ah Kc Ks", "shortdeck"));
    expect(score("6s 6d 6h 7c 8s", "shortdeck")).toBeGreaterThan(score("Ts Jd Qh Kc As", "shortdeck"));
    // ...and the opposite under standard rankings.
    expect(score("As Ks 9s 7s 6s")).toBeLessThan(score("As Ad Ah Kc Ks"));
    expect(score("6s 6d 6h 7c 8s")).toBeLessThan(score("Ts Jd Qh Kc As"));
  });

  it("ranks partial hands for preflop labels", () => {
    expect(category("As Ad")).toBe(Category.Pair);
    expect(category("As Kd")).toBe(Category.HighCard);
    expect(category("As Ks Qs Js")).toBe(Category.HighCard);
    expect(category("As Ad Ah Ac")).toBe(Category.Quads);
    expect(() => evaluate([])).toThrow();
    expect(() => evaluate(h("2s 3s 4s 5s 6s 7s"))).toThrow();
  });

  it("does not depend on card order", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(makeDeck(52), { minLength: 5, maxLength: 5 }),
        fc.constantFrom<Ranking>("standard", "shortdeck"),
        (cards, ranking) => {
          const reversed = cards.slice().reverse();
          expect(evaluate(reversed, ranking).score).toBe(evaluate(cards, ranking).score);
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe("bestHand (any 5)", () => {
  it("finds the best 5 of 7", () => {
    const v = bestHand(h("Ah Kh Qh Jh 2c 2d Th"));
    expect(v.category).toBe(Category.StraightFlush);
    expect(bestHand(h("As Ad 2c 2d 2h 7s 7d")).category).toBe(Category.FullHouse);
    expect(bestHand(h("As 2d 3h 4c 5s 6d")).score).toBe(score("2d 3h 4c 5s 6d"));
  });

  it("beats or ties every 5-card subset and uses 5 of its cards", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(makeDeck(52), { minLength: 5, maxLength: 7 }), (cards) => {
        const best = bestHand(cards);
        expect(best.cards).toHaveLength(5);
        for (const c of best.cards) expect(cards).toContain(c);
        forEachCombination(cards, 5, (combo) => {
          expect(evaluate(combo).score).toBeLessThanOrEqual(best.score);
        });
      }),
      { numRuns: 1000 },
    );
  });
});

describe("bestOmahaHand (exactly 2 hole + 3 board)", () => {
  it("needs two hole cards of the suit for a flush", () => {
    const v = bestOmahaHand(h("Ah Kc Qd Js"), h("2h 5h 8h Th 3c"));
    expect(v.category).not.toBe(Category.Flush);
    expect(bestOmahaHand(h("Ah Kh Qd Js"), h("2h 5h 8h Tc 3c")).category).toBe(Category.Flush);
  });

  it("cannot play the board or four hole cards", () => {
    // Board is a straight, but only 3 board cards may be used.
    const v = bestOmahaHand(h("2c 2d 3c 3d"), h("9s Td Jh Qc Ks"));
    expect(v.category).toBe(Category.Pair);
    // Four aces in hand are just a pair of aces.
    expect(bestOmahaHand(h("As Ad Ah Ac"), h("2c 7d 9h Js 4d")).category).toBe(Category.Pair);
    // Trips on board + a pocket pair is a full house; one more king makes quads.
    expect(bestOmahaHand(h("Qc Qd 8h 8s"), h("Ks Kd Kh 2c 3c")).category).toBe(Category.FullHouse);
    expect(bestOmahaHand(h("Kc Qd 8h 8s"), h("Ks Kd Kh 2c 3c")).category).toBe(Category.Quads);
  });

  it("uses at most 2 hole cards before the flop", () => {
    expect(bestOmahaHand(h("As Ad Ah Kc"), []).category).toBe(Category.Pair);
    expect(bestOmahaHand(h("As Ad Ah Kc"), []).cards).toHaveLength(2);
  });

  it("always uses exactly 2 hole cards and 3 board cards", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(makeDeck(52), { minLength: 12, maxLength: 12 }),
        fc.integer({ min: 4, max: 5 }),
        fc.integer({ min: 3, max: 5 }),
        (cards, holeCount, boardCount) => {
          const hole = cards.slice(0, holeCount);
          const board = cards.slice(holeCount, holeCount + boardCount);
          const v = bestOmahaHand(hole, board);
          expect(v.cards.filter((c) => hole.includes(c))).toHaveLength(2);
          expect(v.cards.filter((c) => board.includes(c))).toHaveLength(3);
          // Never better than a free choice of any 5.
          expect(v.score).toBeLessThanOrEqual(bestHand([...hole, ...board]).score);
          const low = bestOmahaLow(hole, board);
          if (low) {
            expect(low.cards.filter((c) => hole.includes(c))).toHaveLength(2);
            expect(low.cards.filter((c) => board.includes(c))).toHaveLength(3);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe("8-or-better low", () => {
  it("qualifies only 5 distinct ranks of 8 or lower, ace low", () => {
    expect(evaluateLow(h("As 2d 3h 4c 5s"))?.ranks).toEqual([5, 4, 3, 2, 1]);
    expect(evaluateLow(h("8s 7d 6h 5c 4s"))?.ranks).toEqual([8, 7, 6, 5, 4]);
    expect(evaluateLow(h("9s 2d 3h 4c 5s"))).toBeNull();
    expect(evaluateLow(h("As Ad 3h 4c 5s"))).toBeNull();
    expect(evaluateLow(h("As 2d 3h 4c"))).toBeNull();
  });

  it("compares from the highest card down; lower is better", () => {
    const low = (s: string) => evaluateLow(h(s))!.score;
    expect(low("As 2d 3h 4c 5s")).toBeLessThan(low("As 2d 3h 4c 6s"));
    expect(low("8s 5d 4h 3c 2s")).toBeGreaterThan(low("7s 6d 5h 4c 3s"));
    expect(low("8s 6d 4h 3c 2s")).toBeGreaterThan(low("8s 5d 4h 3c 2s"));
    // Flushes and straights don't hurt a low.
    expect(low("As 2s 3s 4s 5s")).toBe(low("As 2d 3h 4c 5s"));
  });

  it("finds the best low of 7 cards", () => {
    expect(bestLow(h("As 2d 3h Kc 7s 8d 4h"))?.ranks).toEqual([7, 4, 3, 2, 1]);
    expect(bestLow(h("As 2d 3h Kc Qs 9d 9h"))).toBeNull();
  });

  it("requires exactly 2 hole + 3 board in Omaha", () => {
    // Four low hole cards but only two low board cards: no low.
    expect(bestOmahaLow(h("As 2d 3h 4c"), h("5s 6d Kh Qc Js"))).toBeNull();
    // Board has five low cards, but a hand with one low hole card can't use them.
    expect(bestOmahaLow(h("As Kd Qh Jc"), h("2s 3d 4h 5c 6s"))).toBeNull();
    expect(bestOmahaLow(h("As 2d Kh Kc"), h("3s 4d 8h Qc Js"))?.ranks).toEqual([8, 4, 3, 2, 1]);
    expect(bestOmahaLow(h("As 2d 3h 4c"), h("5s"))).toBeNull();
  });

  it("can use different hole cards for high and low", () => {
    const hole = h("As 2s Kd Kh");
    const board = h("Ks 3c 5d 9h 7c");
    const high = bestOmahaHand(hole, board);
    const low = bestOmahaLow(hole, board)!;
    expect(high.category).toBe(Category.Trips);
    expect(high.cards).toEqual(expect.arrayContaining(h("Kd Kh")));
    expect(low.ranks).toEqual([7, 5, 3, 2, 1]);
    expect(describeLow(low)).toBe("7-5 low");
  });
});
