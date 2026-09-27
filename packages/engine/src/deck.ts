import { type Card, makeCard, type Suit } from "./cards.js";

export type DeckSize = 52 | 36;

/** Lowest rank in the deck: 2 for a full deck, 6 for short deck. */
export function lowestRank(deckSize: DeckSize): number {
  return deckSize === 52 ? 2 : 6;
}

/** A fresh, ordered deck. Short deck (36) is 6 through A. */
export function makeDeck(deckSize: DeckSize): Card[] {
  const deck: Card[] = [];
  for (let rank = lowestRank(deckSize); rank <= 14; rank++) {
    for (let suit = 0; suit < 4; suit++) deck.push(makeCard(rank, suit as Suit));
  }
  return deck;
}

/**
 * Fills the array with uniformly random 32-bit values. Matches the shape of
 * `crypto.getRandomValues`, which the server passes in; tests may pass a
 * seeded generator. The engine never sources randomness itself.
 */
export type RandomSource = (buffer: Uint32Array) => void;

const TWO_POW_32 = 0x1_0000_0000;

/**
 * Returns an integer in [0, n) with no modulo bias: 32-bit draws at or above
 * the largest multiple of n are rejected and redrawn.
 */
export function randomInt(n: number, random: RandomSource): number {
  if (!Number.isInteger(n) || n < 1 || n > TWO_POW_32) {
    throw new RangeError(`randomInt bound out of range: ${n}`);
  }
  const limit = TWO_POW_32 - (TWO_POW_32 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    random(buf);
    const x = buf[0]!;
    if (x < limit) return x % n;
  }
}

/** Unbiased Fisher-Yates. Returns a new array; the input is left untouched. */
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, random);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
