/**
 * A card is an integer 0..51: `(rank - 2) * 4 + suit`.
 * Ranks run 2..14 (14 = ace); suits 0..3 = clubs, diamonds, hearts, spades.
 * Plain numbers keep game state JSON-serializable and the evaluator fast.
 */
export type Card = number;
export type Rank = number;
export type Suit = 0 | 1 | 2 | 3;

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "cdhs";

export const ACE: Rank = 14;

export function makeCard(rank: Rank, suit: Suit): Card {
  if (!Number.isInteger(rank) || rank < 2 || rank > 14) {
    throw new RangeError(`invalid rank ${rank}`);
  }
  return (rank - 2) * 4 + suit;
}

export function rankOf(card: Card): Rank {
  return (card >> 2) + 2;
}

export function suitOf(card: Card): Suit {
  return (card & 3) as Suit;
}

export function isCard(value: unknown): value is Card {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 52;
}

/** "As", "Td", "2c". */
export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card) - 2]! + SUIT_CHARS[suitOf(card)]!;
}

export function parseCard(text: string): Card {
  if (text.length !== 2) throw new Error(`invalid card "${text}"`);
  const r = RANK_CHARS.indexOf(text[0]!.toUpperCase());
  const s = SUIT_CHARS.indexOf(text[1]!.toLowerCase());
  if (r < 0 || s < 0) throw new Error(`invalid card "${text}"`);
  return makeCard(r + 2, s as Suit);
}

/** Parses a space-separated list like "As Kd 7h". Empty string gives []. */
export function parseCards(text: string): Card[] {
  const trimmed = text.trim();
  return trimmed === "" ? [] : trimmed.split(/\s+/).map(parseCard);
}
