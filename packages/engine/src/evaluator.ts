import { type Card, rankOf, suitOf } from "./cards";

export enum Category {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES: Record<Category, string> = {
  [Category.HighCard]: "High card",
  [Category.Pair]: "Pair",
  [Category.TwoPair]: "Two pair",
  [Category.Trips]: "Three of a kind",
  [Category.Straight]: "Straight",
  [Category.Flush]: "Flush",
  [Category.FullHouse]: "Full house",
  [Category.Quads]: "Four of a kind",
  [Category.StraightFlush]: "Straight flush",
};

/**
 * "standard": 52-card rankings, A-2-3-4-5 is the lowest straight.
 * "shortdeck": Triton rules. Flush beats full house, trips beat a straight,
 * A-6-7-8-9 is the lowest straight.
 */
export type Ranking = "standard" | "shortdeck";

/** Category strength by ranking. Index = Category, value = strength. */
const STRENGTH: Record<Ranking, readonly number[]> = {
  //          HC Pr 2P Tr St Fl FH Qd SF
  standard: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  shortdeck: [0, 1, 2, 4, 3, 6, 5, 7, 8],
};

/** Rank the ace plays as when it completes the lowest straight. */
const ACE_LOW: Record<Ranking, number> = { standard: 1, shortdeck: 5 };

export interface HandValue {
  /** Higher beats lower. Only comparable between hands of the same Ranking. */
  score: number;
  category: Category;
  /** The cards that make the hand, in the order they were evaluated. */
  cards: Card[];
}

/**
 * Evaluates exactly the given cards (1 to 5) as a poker hand. Straights and
 * flushes need all 5; fewer cards (e.g. preflop hole cards) still rank pairs,
 * trips and quads so labels work on every street.
 *
 * Score layout: strength << 20, then up to five 4-bit ranks in the order they
 * matter (grouped by count, then rank), so plain integer comparison is correct.
 */
export function evaluate(cards: readonly Card[], ranking: Ranking = "standard"): HandValue {
  const n = cards.length;
  if (n < 1 || n > 5) throw new RangeError(`evaluate takes 1-5 cards, got ${n}`);

  const counts = new Array<number>(15).fill(0);
  let suitMask = 0;
  for (const c of cards) {
    counts[rankOf(c)]!++;
    suitMask |= 1 << suitOf(c);
  }

  // Ranks ordered by (count desc, rank desc): this is exactly kicker order.
  const groups: number[] = [];
  for (let size = 4; size >= 1; size--) {
    for (let r = 14; r >= 2; r--) if (counts[r] === size) groups.push(r);
  }
  const top = counts[groups[0]!]!;
  const second = groups.length > 1 ? counts[groups[1]!]! : 0;

  let category: Category;
  let ranks = groups;
  if (top === 4) category = Category.Quads;
  else if (top === 3 && second === 2) category = Category.FullHouse;
  else if (top === 3) category = Category.Trips;
  else if (top === 2 && second === 2) category = Category.TwoPair;
  else if (top === 2) category = Category.Pair;
  else {
    const flush = n === 5 && (suitMask & (suitMask - 1)) === 0;
    const straightTop = n === 5 ? straightHigh(groups, ranking) : 0;
    if (straightTop) {
      category = flush ? Category.StraightFlush : Category.Straight;
      ranks = [straightTop];
    } else {
      category = flush ? Category.Flush : Category.HighCard;
    }
  }

  let score = STRENGTH[ranking][category]!;
  for (let i = 0; i < 5; i++) score = score * 16 + (ranks[i] ?? 0);
  return { score, category, cards: cards.slice() };
}

/** Top rank of the straight made by 5 distinct ranks (desc), or 0. */
function straightHigh(desc: readonly number[], ranking: Ranking): number {
  if (desc[0]! - desc[4]! === 4) return desc[0]!;
  // Wheel: the ace plays below the lowest rank of the deck.
  if (desc[0] === 14 && desc[1]! - desc[4]! === 3 && desc[4] === ACE_LOW[ranking] + 1) {
    return desc[1]!;
  }
  return 0;
}

/** Calls `visit` with every k-card combination of `items` (shared buffer). */
export function forEachCombination<T>(
  items: readonly T[],
  k: number,
  visit: (combo: T[]) => void,
): void {
  const combo = new Array<T>(k);
  const walk = (start: number, depth: number): void => {
    if (depth === k) {
      visit(combo);
      return;
    }
    for (let i = start; i <= items.length - (k - depth); i++) {
      combo[depth] = items[i]!;
      walk(i + 1, depth + 1);
    }
  };
  if (k >= 0 && k <= items.length) walk(0, 0);
}

/**
 * Best high hand using any 5 of the cards (Hold'em, Pineapple, short deck).
 * With fewer than 5 cards, evaluates all of them.
 */
export function bestHand(cards: readonly Card[], ranking: Ranking = "standard"): HandValue {
  if (cards.length === 0) throw new RangeError("bestHand needs at least one card");
  let best: HandValue | undefined;
  forEachCombination(cards, Math.min(5, cards.length), (combo) => {
    const v = evaluate(combo, ranking);
    if (!best || v.score > best.score) best = v;
  });
  return best!;
}

/**
 * Best Omaha high hand: exactly 2 hole cards plus exactly 3 board cards.
 * Before the flop (fewer than 3 board cards) it uses 2 hole cards plus all of
 * the board, so the label still never counts more than 2 hole cards.
 */
export function bestOmahaHand(
  hole: readonly Card[],
  board: readonly Card[],
  ranking: Ranking = "standard",
): HandValue {
  if (hole.length < 2) throw new RangeError("Omaha needs at least 2 hole cards");
  let best: HandValue | undefined;
  forOmahaCombos(hole, board, (five) => {
    const v = evaluate(five, ranking);
    if (!best || v.score > best.score) best = v;
  });
  return best!;
}

function forOmahaCombos(
  hole: readonly Card[],
  board: readonly Card[],
  visit: (cards: Card[]) => void,
): void {
  const boardK = Math.min(3, board.length);
  forEachCombination(hole, 2, (h) => {
    forEachCombination(board, boardK, (b) => visit([...h, ...b]));
  });
}

// ---------------------------------------------------------------------------
// 8-or-better low
// ---------------------------------------------------------------------------

export interface LowValue {
  /**
   * LOWER score is the BETTER low (unlike HandValue). Ranks (ace = 1) are
   * compared highest card first.
   */
  score: number;
  /** The five low ranks, highest first, ace = 1. */
  ranks: number[];
  cards: Card[];
}

/**
 * The 8-or-better low value of exactly 5 cards, or null if they don't
 * qualify. Needs 5 distinct ranks, all 8 or lower, ace low. Straights and
 * flushes don't count against a low.
 */
export function evaluateLow(cards: readonly Card[]): LowValue | null {
  if (cards.length !== 5) return null;
  let seen = 0;
  const ranks: number[] = [];
  for (const c of cards) {
    const r = rankOf(c) === 14 ? 1 : rankOf(c);
    if (r > 8 || seen & (1 << r)) return null;
    seen |= 1 << r;
    ranks.push(r);
  }
  ranks.sort((a, b) => b - a);
  let score = 0;
  for (const r of ranks) score = score * 16 + r;
  return { score, ranks, cards: cards.slice() };
}

/** Best 8-or-better low using any 5 of the cards, or null. */
export function bestLow(cards: readonly Card[]): LowValue | null {
  let best: LowValue | null = null;
  forEachCombination(cards, 5, (combo) => {
    const v = evaluateLow(combo);
    if (v && (!best || v.score < best.score)) best = v;
  });
  return best;
}

/** Best Omaha 8-or-better low: exactly 2 hole + 3 board, or null. */
export function bestOmahaLow(hole: readonly Card[], board: readonly Card[]): LowValue | null {
  if (board.length < 3) return null;
  let best: LowValue | null = null;
  forOmahaCombos(hole, board, (five) => {
    const v = evaluateLow(five);
    if (v && (!best || v.score < best.score)) best = v;
  });
  return best;
}

/** "8-6 low", "7-5 low", "5-4 low" (the wheel). */
export function describeLow(low: LowValue): string {
  return `${low.ranks[0]}-${low.ranks[1]} low`;
}
