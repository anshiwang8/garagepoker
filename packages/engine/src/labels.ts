import { type Card, rankOf } from "./cards";
import { Category, CATEGORY_NAMES, describeLow, type HandValue, type LowValue } from "./evaluator";
import { handValue, lowValue, type Variant } from "./hand";

export interface HandLabel {
  category: Category;
  /** "Pair", "Flush", "Ace high"; in Hi/Lo both halves: "Flush / 8-6 low". */
  text: string;
  /** The high hand; in Omaha always exactly 2 hole + 3 board once there's a flop. */
  value: HandValue;
  /** Hi/Lo only: the qualifying low (also 2 + 3 in Omaha), or null. */
  low: LowValue | null;
}

const RANK_NAMES = [
  "", "", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King", "Ace",
];

/**
 * The label for a player's current best hand, obeying the variant's hand rule.
 * Works on every street, including preflop with no board. With double board,
 * call it once per board.
 */
export function handLabel(variant: Variant, hole: readonly Card[], board: readonly Card[]): HandLabel {
  const value = handValue(variant, hole, board);
  const high = labelText(value);
  if (variant.split !== "hilo" || board.length < 3) {
    return { category: value.category, text: high, value, low: null };
  }
  const low = lowValue(variant, hole, board);
  return { category: value.category, text: `${high} / ${low ? describeLow(low) : "no low"}`, value, low };
}

/** Every one-pair hand is just "Pair": no top pair, overpair or pocket pair. */
function labelText(value: HandValue): string {
  const ranks = value.cards.map(rankOf);
  switch (value.category) {
    case Category.StraightFlush:
      return ranks.includes(14) && ranks.includes(13) ? "Royal flush" : "Straight flush";
    case Category.HighCard:
      return `${RANK_NAMES[Math.max(...ranks)]} high`;
    default:
      return CATEGORY_NAMES[value.category];
  }
}
