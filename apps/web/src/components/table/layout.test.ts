import { describe, expect, it } from "vitest";
import { boardBlock, type Box, layoutFelt, type LayoutInput } from "./layout";

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
          ] as const) {
            const seats = Array.from({ length: heroSeated ? n : 9 }, (_, i) => i + 1);
            yield {
              label: `${W}x${H} ${seats.length} seats hero=${heroSeated} grid=${grid} rows=${rows} info=${infoExtra}`,
              w,
              h: H - 164,
              seats,
              heroSeated,
              holeCards: grid ? 2 : n % 3 === 0 ? 4 : 2,
              boardRows: rows,
              grid,
              infoExtra,
              bets,
            };
          }
  }
}

describe("felt layout", () => {
  it("always finds a layout: the table is never blank", () => {
    const empty = [...inputs()].filter((inp) => !layoutFelt(inp)).map((inp) => inp.label);
    expect(empty).toEqual([]);
  });

  it("keeps every seat plate off the board", () => {
    const bad: string[] = [];
    for (const inp of inputs()) {
      const l = layoutFelt(inp)!;
      const size = boardBlock(inp, l.z);
      const board: Box = { x: (l.w - size.w) / 2, y: l.center.boardTop, w: size.w, h: size.h };
      const plates = [...l.seats.map((s) => s.plate), ...(l.hero ? [l.hero.plate] : [])];
      if (plates.some((p) => overlap(p, board))) bad.push(inp.label);
    }
    expect(bad).toEqual([]);
  });

  it("keeps the board inside the table's width", () => {
    for (const inp of inputs()) {
      const l = layoutFelt(inp)!;
      const size = boardBlock(inp, l.z);
      expect(size.w, inp.label).toBeLessThanOrEqual(l.w);
    }
  });
});
