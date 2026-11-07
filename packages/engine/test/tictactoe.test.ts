import { describe, expect, it } from "vitest";
import {
  boardSize,
  cardsNeeded,
  Category,
  cardToString,
  DEFAULT_SETTINGS,
  handLabel,
  handValue,
  lineCards,
  parseCards,
  rabbitCards,
  streetOfPosition,
  streetWithDealt,
  TICTACTOE_BOARD,
  validateConfig,
  VARIANTS,
} from "../src/index.js";
import { checkDown, NL, play, player, stackDeck, start } from "./helpers.js";

const TTT = { ...NL, variant: VARIANTS.TICTACTOE };
const GRID = TICTACTOE_BOARD.grid;
const str = (cards: readonly number[]) => cards.map(cardToString).join(" ");

/**
 * A board written as the grid looks, rows separated by "/", turned into
 * dealing order (corners, middle row, then top- and bottom-middle).
 */
function grid(rows: string): string {
  const squares = rows.split("/").flatMap((row) => row.trim().split(/\s+/));
  expect(squares).toHaveLength(9);
  return GRID.cells.map((cell) => squares[cell]!).join(" ");
}

/** The squares a 5-card hand's board cards sit on, sorted. */
function squaresOf(cards: readonly number[], board: readonly number[]): number[] {
  return cards
    .filter((c) => board.includes(c))
    .map((c) => GRID.cells[board.indexOf(c)]!)
    .sort((a, b) => a - b);
}

const isLine = (squares: number[]) => GRID.lines.some((line) => [...line].sort().join() === squares.join());

describe("Tic-Tac-Toe board layout", () => {
  it("deals the corners on the flop, the middle row on the turn and the top- and bottom-middle on the river", () => {
    expect(boardSize(TICTACTOE_BOARD)).toBe(9);
    expect(GRID.cells.slice(0, 4)).toEqual([0, 2, 6, 8]);
    expect(GRID.cells.slice(4, 7)).toEqual([3, 4, 5]);
    expect(GRID.cells.slice(7)).toEqual([1, 7]);
    expect([...GRID.cells].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => streetOfPosition(TICTACTOE_BOARD, i))).toEqual([
      "flop", "flop", "flop", "flop", "turn", "turn", "turn", "river", "river",
    ]);
    expect([0, 4, 7, 9].map((n) => streetWithDealt(TICTACTOE_BOARD, n))).toEqual(["preflop", "flop", "turn", "river"]);
    expect(() => streetWithDealt(TICTACTOE_BOARD, 5)).toThrow();
  });

  it("has the 8 tic-tac-toe lines: 3 rows, 3 columns, 2 diagonals", () => {
    expect(GRID.lines.map((l) => l.join(""))).toEqual(["012", "345", "678", "036", "147", "258", "048", "246"]);
  });

  it("completes no line on the flop, 5 lines on the turn and all 8 on the river", () => {
    const board = parseCards(grid("Ah 2c 7d / Qs Js Ts / 3h 4d 9c"));
    const complete = (dealt: number) => lineCards(GRID, board.slice(0, dealt)).filter((l) => l.length === 3).length;
    expect(complete(4)).toBe(0);
    expect(complete(7)).toBe(5);
    expect(complete(9)).toBe(8);
  });

  it("deals 4 / 3 / 2 in a hand", () => {
    // Heads-up, button 1: seat 2 is dealt first, then seat 1, then the board.
    const deck = stackDeck(["Kd Kc", "5c 5d"], grid("Ah 2c 7d / Qs Js Ts / 3h 4d 9c"));
    let s = play(start({ 1: 1000, 2: 1000 }, 1, TTT, deck), "1 call", "2 check");
    expect(s.street).toBe("flop");
    expect(str(s.boards[0]!)).toBe("Ah 7d 3h 9c");
    s = play(s, "2 check", "1 check");
    expect(str(s.boards[0]!)).toBe("Ah 7d 3h 9c Qs Js Ts");
    s = play(s, "2 check", "1 check");
    expect(s.street).toBe("river");
    expect(str(s.boards[0]!)).toBe("Ah 7d 3h 9c Qs Js Ts 2c 4d");
  });
});

describe("Tic-Tac-Toe hands: both hole cards plus one line", () => {
  const value = (hole: string, rows: string) =>
    handValue(VARIANTS.TICTACTOE, parseCards(hole), parseCards(grid(rows)));

  it("three suited cards that aren't in a line don't make a flush", () => {
    // Hearts on squares 0, 2 and 4: no row, column or diagonal holds all three.
    const rows = "Ah 8s 2h / 3c 9h Jd / 7c 4s 6d";
    expect(value("Kh Qh", rows).category).toBe(Category.HighCard);
    expect(handValue(VARIANTS.NLH, parseCards("Kh Qh"), parseCards(grid(rows))).category).toBe(Category.Flush);
    // The same hearts across the top row do.
    expect(value("Kh Qh", "Ah 9h 2h / 3c 8s Jd / 7c 4s 6d").category).toBe(Category.Flush);
  });

  it("always uses both hole cards", () => {
    // Kings fill the middle row: trips, with both hole cards as kickers, never the board's ace.
    const v = value("Qs 2c", "Ad 7h 3d / Kd Kh Ks / 8c 4h 9s");
    expect(v.category).toBe(Category.Trips);
    expect(str(v.cards.filter((c) => parseCards("Qs 2c").includes(c)))).toBe("Qs 2c");
    expect(squaresOf(v.cards, parseCards(grid("Ad 7h 3d / Kd Kh Ks / 8c 4h 9s")))).toEqual([3, 4, 5]);
  });

  it("takes the best of the 8 lines", () => {
    // Trips on the right column (9h) beat two pair on the bottom row (4c 4d).
    const rows = "2c Jd 9h / Th 6s 3d / 4c 4d 8s";
    const v = value("9s 9d", rows);
    expect(v.category).toBe(Category.Trips);
    expect(isLine(squaresOf(v.cards, parseCards(grid(rows))))).toBe(true);
  });

  it("labels count the hole cards plus each line's dealt cards before the river", () => {
    const hole = parseCards("Qs Js");
    const board = parseCards(grid("As 8d Ks / Ts 4h 5h / 2s 9c 3s"));
    const label = (dealt: number) => handLabel(VARIANTS.TICTACTOE, hole, board.slice(0, dealt));
    expect(label(0).text).toBe("Queen high");
    // Flop: four spades in the corners, but a line holds at most 2 of them, so 4 cards and no flush.
    expect(label(4).category).toBe(Category.HighCard);
    expect(label(4).value.cards).toHaveLength(4);
    // Turn: the left column (As Ts 2s) completes, making the flush.
    expect(label(7).text).toBe("Flush");
    expect(label(9).text).toBe("Flush");
  });

  it("names pairs against the line the hand uses", () => {
    // The queen pairs the top of the diagonal (Qd 6s Th), though the board has an ace (not in a line with it).
    expect(handLabel(VARIANTS.TICTACTOE, parseCards("Qs 3d"), parseCards(grid("Qd 2s 5c / 8c 6s Ac / 4h 9s Th"))).text).toBe(
      "Top pair",
    );
  });

  it("settles the pot with the line rule at showdown", () => {
    // Seat 2's hearts aren't in a line; seat 1's fives win with a pair.
    const deck = stackDeck(["Kh Qh", "5c 5d"], grid("Ah 8s 2h / 3c 9h Jd / 7c 4s 6d"));
    const s = checkDown(play(start({ 1: 1000, 2: 1000 }, 1, TTT, deck), "1 call", "2 check"));
    expect(s.street).toBe("complete");
    const shown = s.result!.showdown;
    expect(shown.find((h) => h.seat === 2)!.boards[0]!.high.category).toBe(Category.HighCard);
    const winner = shown.find((h) => h.seat === 1)!.boards[0]!.high;
    expect(winner.category).toBe(Category.Pair);
    expect(isLine(squaresOf(winner.cards, s.boards[0]!))).toBe(true);
    expect(s.result!.payouts).toEqual([{ seat: 1, amount: 40 }]);
    expect(player(s, 1).stack).toBe(1020);
  });
});

describe("Tic-Tac-Toe with table options", () => {
  it("runs it twice from the flop, sharing the corners and dealing 5 new cards per run", () => {
    const deck = stackDeck(["Kd Kc", "5c 5d"], "Ah 7d 3h 9c  Qs Js Ts 2c 4d  8h 8d 6c Ac 2d".replace(/\s+/g, " "));
    let s = play(start({ 1: 1000, 2: 1000 }, 1, { ...TTT, runItTwice: "always" }, deck), "1 call", "2 check");
    s = play(s, "2 raise 980", "1 call");
    expect(s.street).toBe("complete");
    expect(str(s.boards[0]!)).toBe("Ah 7d 3h 9c Qs Js Ts 2c 4d");
    expect(str(s.secondRun![0]!)).toBe("Ah 7d 3h 9c 8h 8d 6c Ac 2d");
    expect(s.result!.pots[0]!.slices.map((x) => x.run)).toEqual([0, 1]);
  });

  it("runs it twice from the turn, sharing 7 cards", () => {
    const deck = stackDeck(["Kd Kc", "5c 5d"], "Ah 7d 3h 9c Qs Js Ts  2c 4d  8h 8d".replace(/\s+/g, " "));
    let s = play(start({ 1: 1000, 2: 1000 }, 1, { ...TTT, runItTwice: "always" }, deck), "1 call", "2 check");
    s = play(s, "2 check", "1 check", "2 raise 980", "1 call");
    expect(str(s.secondRun![0]!)).toBe("Ah 7d 3h 9c Qs Js Ts 8h 8d");
  });

  it("rabbit hunts the turn's 3 and the river's 2 after a hand ends on the flop", () => {
    const deck = stackDeck(["Kd Kc", "5c 5d"], grid("Ah 2c 7d / Qs Js Ts / 3h 4d 9c"));
    const s = play(start({ 1: 1000, 2: 1000 }, 1, TTT, deck), "1 call", "2 check", "2 raise 100", "1 fold");
    expect(s.boards[0]).toHaveLength(4);
    expect(rabbitCards(s).map(str)).toEqual(["Qs Js Ts 2c 4d"]);
  });

  it("deals two grids with double board", () => {
    const s = checkDown(play(start({ 1: 1000, 2: 1000 }, 1, { ...TTT, boards: 2 }), "1 call", "2 check"));
    expect(s.boards.map((b) => b.length)).toEqual([9, 9]);
    expect(new Set(s.boards.flat()).size).toBe(18);
  });

  it("deck math counts 9 cards a board", () => {
    expect(cardsNeeded(8, 2, 1, 1, 9)).toBe(25);
    const settings = { ...DEFAULT_SETTINGS, variant: "TICTACTOE" as const, boards: 2 as const, runItTwice: "ask" as const };
    expect(validateConfig({ ...settings, seats: 8 })).toEqual([]); // 16 + 36 = 52
    expect(validateConfig({ ...settings, seats: 9 }).map((i) => i.field)).toEqual(["seats"]); // 18 + 36 = 54
  });

  it("rejects line rules without a grid, and hi/lo with lines", () => {
    const deal = (variant: object) => () => start({ 1: 1000, 2: 1000 }, 1, { ...NL, variant: variant as typeof VARIANTS.NLH });
    expect(deal({ ...VARIANTS.NLH, handRule: "lines" })).toThrow(/grid/);
    expect(deal({ ...VARIANTS.TICTACTOE, split: "hilo" })).toThrow(/Hi\/Lo/);
    expect(deal({ ...VARIANTS.NLH, board: TICTACTOE_BOARD })).toThrow(/grid/);
    const badGrid = { ...TICTACTOE_BOARD, grid: { ...GRID, cells: [0, 0, 6, 8, 3, 4, 5, 1, 7] } };
    expect(deal({ ...VARIANTS.TICTACTOE, board: badGrid })).toThrow(/grid/);
  });
});
