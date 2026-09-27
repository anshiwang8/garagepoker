import { describe, expect, it } from "vitest";
import {
  cardToString,
  isCard,
  makeCard,
  makeDeck,
  parseCard,
  parseCards,
  rankOf,
  suitOf,
} from "../src/index.js";

describe("cards", () => {
  it("round-trips every card through its string form", () => {
    for (let c = 0; c < 52; c++) {
      expect(parseCard(cardToString(c))).toBe(c);
      expect(makeCard(rankOf(c), suitOf(c))).toBe(c);
    }
  });

  it("parses rank and suit", () => {
    const c = parseCard("As");
    expect(rankOf(c)).toBe(14);
    expect(suitOf(c)).toBe(3);
    expect(cardToString(parseCard("td"))).toBe("Td");
    expect(parseCards(" 2c  Kh ").map(cardToString)).toEqual(["2c", "Kh"]);
    expect(parseCards("")).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => parseCard("1s")).toThrow();
    expect(() => parseCard("Ax")).toThrow();
    expect(() => parseCard("10s")).toThrow();
    expect(() => makeCard(15, 0)).toThrow();
    expect(isCard(52)).toBe(false);
    expect(isCard(1.5)).toBe(false);
    expect(isCard(0)).toBe(true);
  });
});

describe("deck", () => {
  it("builds a 52-card deck of distinct cards", () => {
    const deck = makeDeck(52);
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
  });

  it("builds a 36-card short deck of 6 through A", () => {
    const deck = makeDeck(36);
    expect(deck).toHaveLength(36);
    expect(new Set(deck).size).toBe(36);
    const ranks = new Set(deck.map(rankOf));
    expect([...ranks].sort((a, b) => a - b)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});
