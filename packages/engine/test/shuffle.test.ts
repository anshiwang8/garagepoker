import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeDeck, randomInt, type RandomSource, shuffle } from "../src/index.js";
import { cryptoRandom, seededRandom } from "./helpers.js";

/** A RandomSource that replays fixed values. */
function scripted(values: number[]): RandomSource {
  let i = 0;
  return (buf) => {
    for (let k = 0; k < buf.length; k++) buf[k] = values[i++]!;
  };
}

describe("randomInt", () => {
  it("rejects draws in the biased tail instead of taking them modulo n", () => {
    // For n = 3, 2^32 % 3 = 1, so only 0xFFFFFFFF is in the biased tail.
    expect(randomInt(3, scripted([0xffffffff, 5]))).toBe(2);
    // For n = 52, the tail is the top 2^32 % 52 = 48 values.
    const limit = 2 ** 32 - (2 ** 32 % 52);
    expect(randomInt(52, scripted([limit, limit + 47, limit - 1]))).toBe((limit - 1) % 52);
  });

  it("stays in range", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer(), (n, seed) => {
        const x = randomInt(n, seededRandom(seed));
        return Number.isInteger(x) && x >= 0 && x < n;
      }),
    );
  });

  it("rejects bad bounds", () => {
    expect(() => randomInt(0, cryptoRandom)).toThrow();
    expect(() => randomInt(2.5, cryptoRandom)).toThrow();
  });
});

describe("shuffle", () => {
  it("returns a permutation and leaves the input untouched", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.integer(), (items, seed) => {
        const before = items.slice();
        const out = shuffle(items, seededRandom(seed));
        expect(items).toEqual(before);
        expect(out.slice().sort()).toEqual(before.slice().sort());
      }),
    );
  });

  it("never deals a card twice with the real CSPRNG", () => {
    for (const size of [52, 36] as const) {
      for (let i = 0; i < 1000; i++) {
        const deck = shuffle(makeDeck(size), cryptoRandom);
        expect(new Set(deck).size).toBe(size);
      }
    }
  });

  it("produces all orderings of 4 items uniformly (chi-square)", () => {
    const random = seededRandom(12345);
    const trials = 240_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < trials; i++) {
      const key = shuffle([0, 1, 2, 3], random).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    const expected = trials / 24;
    let chi2 = 0;
    for (const c of counts.values()) chi2 += (c - expected) ** 2 / expected;
    // 23 degrees of freedom; 49.73 is the p = 0.001 critical value.
    expect(chi2).toBeLessThan(49.73);
  });

  it("puts each card in each position uniformly (52-card deck)", () => {
    const random = seededRandom(987);
    const trials = 52_000;
    // counts[card][position]
    const counts = Array.from({ length: 52 }, () => new Array<number>(52).fill(0));
    for (let t = 0; t < trials; t++) {
      shuffle(makeDeck(52), random).forEach((card, pos) => counts[card]![pos]!++);
    }
    const expected = trials / 52;
    for (const row of counts) {
      for (const c of row) expect(Math.abs(c - expected)).toBeLessThan(expected * 0.2);
    }
  });
});
