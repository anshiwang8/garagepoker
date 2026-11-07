import type { Card } from "./cards";
import type { Street } from "./hand";

/**
 * The shape of a variant's board (SPEC §1): how many cards each street deals,
 * and, for a grid board, where each card goes and which lines a hand may use.
 * A board is always stored as a list of cards in dealing order; the grid is
 * only how those cards are arranged.
 */
export interface BoardLayout {
  /** Cards dealt on the flop, turn and river. */
  streets: readonly [flop: number, turn: number, river: number];
  /** Grid boards only (handRule "lines"). */
  grid?: BoardGrid;
}

export interface BoardGrid {
  /** Squares per side; squares are numbered row by row from the top left. */
  size: number;
  /** The square each board card lands on, in dealing order. */
  cells: readonly number[];
  /** The lines a hand may use, as lists of squares. */
  lines: readonly (readonly number[])[];
}

/** Five cards in a row: 3 on the flop, 1 on the turn, 1 on the river. */
export const ROW_BOARD = { streets: [3, 1, 1] } as const satisfies BoardLayout;

/**
 * Tic-Tac-Toe Hold'em (SPEC §1): a 3×3 grid, squares numbered
 *
 *     0 1 2
 *     3 4 5
 *     6 7 8
 *
 * The flop is the four corners, the turn the middle row, the river the
 * top-middle and bottom-middle squares. A hand uses one row, column or diagonal.
 */
export const TICTACTOE_BOARD = {
  streets: [4, 3, 2],
  grid: {
    size: 3,
    cells: [0, 2, 6, 8, 3, 4, 5, 1, 7],
    lines: [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ],
  },
} as const satisfies BoardLayout;

const STREETS = ["flop", "turn", "river"] as const;

/** Cards on a full board. */
export function boardSize(layout: BoardLayout): number {
  return layout.streets[0] + layout.streets[1] + layout.streets[2];
}

/** Cards dealt on this street (0 preflop). */
export function cardsOnStreet(layout: BoardLayout, street: Street): number {
  const i = STREETS.indexOf(street as (typeof STREETS)[number]);
  return i < 0 ? 0 : layout.streets[i]!;
}

/** The street on which the board card at this position (0-based, dealing order) is dealt. */
export function streetOfPosition(layout: BoardLayout, position: number): Street {
  let dealt = 0;
  for (let i = 0; i < STREETS.length; i++) {
    dealt += layout.streets[i]!;
    if (position < dealt) return STREETS[i]!;
  }
  throw new RangeError(`board position ${position} is past the river`);
}

/** The last street dealt when the board holds `dealt` cards: "preflop" for none. */
export function streetWithDealt(layout: BoardLayout, dealt: number): Street {
  if (dealt === 0) return "preflop";
  let total = 0;
  for (let i = 0; i < STREETS.length; i++) {
    total += layout.streets[i]!;
    if (dealt === total) return STREETS[i]!;
  }
  throw new RangeError(`a board can't hold ${dealt} cards after a whole street`);
}

/**
 * The dealt cards of every line of a grid board, line by line, in the line's
 * square order. Lines with nothing dealt yet come back empty.
 */
export function lineCards(grid: BoardGrid, board: readonly Card[]): Card[][] {
  return grid.lines.map((line) =>
    line.flatMap((cell) => {
      const card = board[grid.cells.indexOf(cell)];
      return card === undefined ? [] : [card];
    }),
  );
}
