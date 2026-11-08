import { describe, expect, it } from "vitest";
import FIVE_CARDS from "./__fixtures__/layout-5-cards.json";
import { boardBlock, type Box, type FeltLayout, layoutFelt, type LayoutInput } from "./layout";

/** Screens to cover, with the felt's height on each (the page minus the top bar and action zone, ~164 px). */
const SCREENS = [
  [360, 800],
  [375, 667],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 768],
  [1280, 800],
  [1440, 900],
  [1920, 1080],
] as const;

/** Board lengths to sweep: 5, then red river boards (extra cards, wrapping in the extreme cases). */
const LENGTHS = [5, 6, 7, 9, 12, 16] as const;

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function* inputs(): Generator<LayoutInput & { label: string }> {
  for (const [W, H] of SCREENS) {
    const w = W >= 1024 ? Math.min(W - 320, W) : W; // desktop: the sidebar takes 320 px
    for (let n = 2; n <= 9; n++)
      for (const heroSeated of [true, false])
        for (const grid of [false, true])
          for (const [bets, infoExtra, rows] of [
            [true, 0, 1],
            [true, 16, 2],
            [false, 0, 4], // a result with 2 boards run twice
            [false, 48, 1], // between hands: Copy link
            [false, 64, 1],
          ] as const)
            // Grids are always 9 squares: red river only grows rows.
            for (const boardLength of grid ? [5] : LENGTHS) {
              const seats = Array.from({ length: heroSeated ? n : 9 }, (_, i) => i + 1);
              yield {
                label: `${W}x${H} ${seats.length} seats hero=${heroSeated} grid=${grid} rows=${rows} len=${boardLength} info=${infoExtra}`,
                w,
                h: H - 164,
                seats,
                heroSeated,
                holeCards: grid ? 2 : n % 3 === 0 ? 4 : 2,
                boardRows: rows,
                boardLength,
                grid,
                infoExtra,
                bets,
              };
            }
  }
}

/** Every input with its layout, computed once for all the sweeps below. */
const SWEEP: (LayoutInput & { label: string; l: FeltLayout | null })[] = [...inputs()].map((inp) => ({ ...inp, l: layoutFelt(inp) }));

function boardBox(inp: LayoutInput, l: FeltLayout): Box {
  const size = boardBlock(inp, l.z);
  return { x: (l.w - size.w) / 2, y: l.center.boardTop, w: size.w, h: size.h };
}

describe("felt layout", () => {
  it("always finds a layout: the table is never blank", () => {
    const empty = SWEEP.filter((inp) => !inp.l).map((inp) => inp.label);
    expect(empty).toEqual([]);
  });

  it("keeps every seat plate off the board", () => {
    const bad: string[] = [];
    for (const inp of SWEEP) {
      const l = inp.l!;
      const board = boardBox(inp, l);
      const plates = [...l.seats.map((s) => s.plate), ...(l.hero ? [l.hero.plate] : [])];
      if (plates.some((p) => overlap(p, board))) bad.push(inp.label);
    }
    expect(bad).toEqual([]);
  });

  it("keeps the board off your cards (the hero area)", () => {
    const bad: string[] = [];
    for (const inp of SWEEP) {
      const l = inp.l!;
      if (l.hero && overlap(l.hero.cards, boardBox(inp, l))) bad.push(inp.label);
    }
    expect(bad).toEqual([]);
  });

  it("keeps the board inside the table's width", () => {
    for (const inp of SWEEP) {
      const l = inp.l!;
      const size = boardBlock(inp, l.z);
      expect(size.w, inp.label).toBeLessThanOrEqual(l.w);
    }
  });

  it("makes room for every card: each row's lines at the size drawn, at least 5 to a line", () => {
    // Worked out here from the sizes, not by boardBlock, so a board that only
    // claims 5 cards' room for a longer row fails.
    const bad: string[] = [];
    for (const inp of SWEEP) {
      if (inp.grid) continue;
      const { z } = inp.l!;
      const perLine = Math.min(inp.boardLength, z.boardPerLine);
      const lines = Math.ceil(inp.boardLength / z.boardPerLine);
      const rows = Math.max(1, inp.boardRows);
      const w = z.boardLabelW + perLine * z.boardCardW + (perLine - 1) * z.boardGap;
      const h = rows * (lines * z.boardCardH + (lines - 1) * z.boardGap) + (rows - 1) * z.rowGap;
      const size = boardBlock(inp, z);
      if (!(z.boardPerLine >= 5) || Math.abs(size.w - w) > 1e-6 || Math.abs(size.h - h) > 1e-6) bad.push(inp.label);
    }
    expect(bad).toEqual([]);
  });

  it("keeps the board between the pot and the table info", () => {
    const bad: string[] = [];
    for (const inp of SWEEP) {
      const l = inp.l!;
      const size = boardBlock(inp, l.z);
      if (l.center.boardTop + size.h > l.center.infoTop + 0.01) bad.push(inp.label);
    }
    expect(bad).toEqual([]);
  });
});

describe("the badge row above the pot (bomb pot, red river, total)", () => {
  it("stays clear of every seat plate and bet chip, however wide", () => {
    const bad: string[] = [];
    for (const [W, H] of SCREENS)
      for (let n = 2; n <= 9; n++)
        for (const bets of [true, false])
          for (const tagW of [150, 200, 250])
            for (const boardLength of [5, 7]) {
              const w = W >= 1024 ? W - 320 : W;
              const inp: LayoutInput = { w, h: H - 164, seats: Array.from({ length: n }, (_, i) => i + 1), heroSeated: true, holeCards: 2, boardRows: 1, boardLength, infoExtra: 0, bets, tagW };
              const l = layoutFelt(inp)!;
              const s = l.z.s;
              const row: Box = { x: (l.w - tagW * s) / 2, y: l.center.tagTop, w: tagW * s, h: l.z.tagH };
              // A typical bet pill (76 px at scale 1), placed as the felt places it.
              const chipW = 76 * s;
              const chip = (b: FeltLayout["seats"][number]["bet"]): Box => ({
                x: b.align === "left" ? b.x : b.align === "right" ? b.x - chipW : b.x - chipW / 2,
                y: b.y - l.z.chipH / 2,
                w: chipW,
                h: l.z.chipH,
              });
              const boxes = [...l.seats.flatMap((st) => [st.plate, ...(bets ? [chip(st.bet)] : [])]), ...(l.hero ? [l.hero.plate, l.hero.cards] : [])];
              if (boxes.some((b) => overlap(b, row))) bad.push(`${W}x${H} ${n} seats bets=${bets} tagW=${tagW} len=${boardLength}`);
            }
    expect(bad).toEqual([]);
  });
});

/** Inputs for the 5-card baseline in __fixtures__/layout-5-cards.json (same order). */
const FIVE_CARD_INPUTS: Omit<LayoutInput, "boardLength">[] = [
  { w: 360, h: 636, seats: [1, 2, 3, 4, 5, 6], heroSeated: true, holeCards: 2, boardRows: 1, infoExtra: 0, bets: true },
  { w: 390, h: 680, seats: [1, 2, 3, 4], heroSeated: true, holeCards: 4, boardRows: 2, infoExtra: 16, bets: true },
  { w: 430, h: 768, seats: [1, 2, 3], heroSeated: false, holeCards: 2, boardRows: 1, infoExtra: 48, bets: false },
  { w: 1120, h: 736, seats: [1, 2, 3, 4, 5, 6, 7, 8, 9], heroSeated: true, holeCards: 2, boardRows: 4, infoExtra: 0, bets: false },
  { w: 360, h: 636, seats: [1, 2, 3, 4, 5, 6, 7, 8, 9], heroSeated: false, holeCards: 2, boardRows: 4, infoExtra: 0, bets: false },
  { w: 375, h: 503, seats: [1, 2, 3, 4, 5, 6, 7, 8, 9], heroSeated: true, holeCards: 4, boardRows: 2, infoExtra: 16, bets: true },
  { w: 768, h: 860, seats: [1, 2, 3, 4, 5], heroSeated: true, holeCards: 2, boardRows: 1, infoExtra: 64, bets: false },
  { w: 1600, h: 916, seats: [1, 2], heroSeated: true, holeCards: 2, boardRows: 2, infoExtra: 0, bets: true },
  { w: 390, h: 680, seats: [1, 2, 3, 4, 5, 6], heroSeated: true, holeCards: 2, boardRows: 2, grid: true, infoExtra: 0, bets: true },
];

describe("long boards (red river)", () => {
  const base: LayoutInput = { w: 390, h: 680, seats: [1, 2, 3], heroSeated: true, holeCards: 2, boardRows: 1, boardLength: 5, infoExtra: 0, bets: true };

  it("5 cards lay out exactly as before", () => {
    // The whole layout (sizes, centre, seats, you, felt) from the code before
    // boards could grow (commit ad33f92), for a spread of fixed inputs.
    expect(FIVE_CARDS.length).toBe(FIVE_CARD_INPUTS.length);
    FIVE_CARD_INPUTS.forEach((inp, i) => {
      const l = layoutFelt({ ...inp, boardLength: 5 })!;
      const { boardPerLine, ...z } = l.z;
      expect(boardPerLine).toBe(inp.grid ? 3 : 5);
      expect(JSON.parse(JSON.stringify({ ...l, z }))).toEqual(FIVE_CARDS[i]);
    });
  });

  it("a 6th card stays on one line on desktop, at the usual size", () => {
    const desk = { ...base, w: 1120, h: 736 };
    const five = layoutFelt(desk)!;
    const six = layoutFelt({ ...desk, boardLength: 6 })!;
    expect(six.z.boardPerLine).toBe(6);
    // The usual single-board size at this scale (the wider board may shrink the whole table a little).
    expect(six.z.boardCardW).toBe(Math.floor(72 * six.z.s));
    expect(five.z.boardCardW).toBe(Math.floor(72 * five.z.s));
    expect(boardBlock({ ...desk, boardLength: 6 }, six.z).h).toBe(six.z.boardCardH);
  });

  it("on a phone, one line shrinks the cards down to the double-board size (52 px), then wraps", () => {
    // 390 px across: 6 cards fit on one line a little smaller than usual.
    const six = layoutFelt({ ...base, boardLength: 6 })!;
    const five = layoutFelt(base)!;
    expect(six.z.boardPerLine).toBe(6);
    expect(six.z.boardCardW).toBeLessThan(five.z.boardCardW);
    expect(six.z.boardCardW).toBeGreaterThanOrEqual(Math.floor(52 * six.z.s));
    // 9 don't: the row wraps, at least 5 to a line, and the cards stay legible.
    const nine = layoutFelt({ ...base, boardLength: 9 })!;
    expect(nine.z.boardPerLine).toBeLessThan(9);
    expect(nine.z.boardPerLine).toBeGreaterThanOrEqual(5);
    expect(nine.z.boardCardW).toBeGreaterThanOrEqual(Math.floor(52 * nine.z.s));
    const lines = Math.ceil(9 / nine.z.boardPerLine);
    expect(boardBlock({ ...base, boardLength: 9 }, nine.z).h).toBeCloseTo(lines * nine.z.boardCardH + (lines - 1) * nine.z.boardGap, 6);
  });

  it("each row takes ceil(length / per line) lines", () => {
    const inp = { ...base, w: 360, h: 636, boardRows: 2, boardLength: 12 };
    const l = layoutFelt(inp)!;
    const lines = Math.ceil(12 / l.z.boardPerLine);
    const { h, w } = boardBlock(inp, l.z);
    expect(h).toBeCloseTo(2 * (lines * l.z.boardCardH + (lines - 1) * l.z.boardGap) + l.z.rowGap, 6);
    expect(w).toBeCloseTo(l.z.boardLabelW + l.z.boardPerLine * l.z.boardCardW + (l.z.boardPerLine - 1) * l.z.boardGap, 6);
  });

  it("an extreme board (4 rows of 16 on a 360 px phone) still draws, smaller than the usual minimum", () => {
    const inp = { ...base, w: 360, h: 636, seats: [1, 2, 3, 4, 5, 6, 7, 8, 9], boardRows: 4, boardLength: 16, bets: false };
    const l = layoutFelt(inp)!;
    expect(l).not.toBeNull();
    expect(boardBlock(inp, l.z).w).toBeLessThanOrEqual(360);
  });
});
