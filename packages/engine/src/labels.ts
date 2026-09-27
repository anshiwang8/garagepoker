import { type Card, rankOf } from "./cards";
import { Category, CATEGORY_NAMES, type HandValue } from "./evaluator";
import { handValue, type Variant } from "./hand";

export interface HandLabel {
  category: Category;
  /** "Top pair", "Flush", "Ace high", ... */
  text: string;
  /** The hand the label describes; in Omaha always exactly 2 hole + 3 board once there's a flop. */
  value: HandValue;
}

const RANK_NAMES = [
  "", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace",
];

/**
 * The label for a player's current best hand, obeying the variant's hand rule.
 * Works on every street, including preflop with no board.
 */
export function handLabel(variant: Variant, hole: readonly Card[], board: readonly Card[]): HandLabel {
  const value = handValue(variant, hole, board);
  return { category: value.category, text: labelText(value, hole, board), value };
}

function labelText(value: HandValue, hole: readonly Card[], board: readonly Card[]): string {
  const ranks = value.cards.map(rankOf);
  switch (value.category) {
    case Category.StraightFlush:
      return ranks.includes(14) && ranks.includes(13) ? "Royal flush" : "Straight flush";
    case Category.HighCard:
      return `${RANK_NAMES[Math.max(...ranks)]} high`;
    case Category.Pair:
      return pairText(value, hole, board);
    default:
      return CATEGORY_NAMES[value.category];
  }
}

function pairText(value: HandValue, hole: readonly Card[], board: readonly Card[]): string {
  const pairCards = value.cards.filter(
    (c) => value.cards.filter((d) => rankOf(d) === rankOf(c)).length === 2,
  );
  const pairRank = rankOf(pairCards[0]!);
  const fromHole = pairCards.filter((c) => hole.includes(c)).length;
  const boardRanks = [...new Set(board.map(rankOf))].sort((a, b) => b - a);

  if (fromHole === 2) {
    if (boardRanks.length === 0) return "Pocket pair";
    return pairRank > boardRanks[0]! ? "Overpair" : "Pocket pair";
  }
  if (fromHole === 1) {
    if (pairRank === boardRanks[0]) return "Top pair";
    if (pairRank === boardRanks[1]) return "Second pair";
    if (boardRanks.length >= 3 && pairRank === boardRanks.at(-1)) return "Bottom pair";
  }
  return "Pair";
}
