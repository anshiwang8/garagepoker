/**
 * Where everything on the felt goes, in px of the felt area (SPEC §7). Pure:
 * the felt measures itself and passes its size in.
 *
 * Phones: a tall table. You're at the bottom centre; the others sit on the rail
 * in a top row and in up to two seats down each side, one above the board and
 * one below it, because the board is almost as wide as the screen. The pot pill
 * goes above the board, the table info below it.
 *
 * Desktop: a wide stadium with the seats spread round the rail.
 *
 * Either way the layout is tried at full size first and shrunk step by step
 * until nothing overlaps: no seat, bet or button ever covers your seat, and the
 * seats never cover the board.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

export type SeatSide = "left" | "right" | "top" | "bottom";

export interface SeatSlot {
  seat: number;
  side: SeatSide;
  /** The name plate. Cards sit above it, overlapping its top edge. */
  plate: Box;
  /** Centre of this seat's bet chip. `align` says which side of the chip that point is. */
  bet: Pt & { align: "left" | "right" | "center" };
  /** Centre of the dealer button. */
  dealer: Pt;
}

export interface Sizes {
  s: number;
  plateW: number;
  plateH: number;
  nameFont: number;
  stackFont: number;
  /** Opponents' cards, and how far the fan rises above the plate's top edge. */
  cardW: number;
  cardH: number;
  above: number;
  chipH: number;
  chipFont: number;
  heroCardW: number;
  heroCardH: number;
  heroFanW: number;
  heroFanH: number;
  heroPlateW: number;
  heroPlateH: number;
  heroNameFont: number;
  heroStackFont: number;
  boardCardW: number;
  boardCardH: number;
  boardGap: number;
  rowGap: number;
  /** Room for "B1"/"B2" left of each row (0 for one board). */
  boardLabelW: number;
  pillH: number;
  pillFont: number;
  /** The "total" tag and bomb-pot badge above the pill. */
  tagH: number;
  resultH: number;
  infoH: number;
  dealer: number;
  /** Room under an opponent's plate for two showdown tags. */
  tagsBelow: number;
}

export interface FeltLayout {
  mode: "phone" | "desktop";
  w: number;
  h: number;
  z: Sizes;
  /** The felt (inside the rail) and its corner radius. */
  felt: Box;
  radius: number;
  /** Your seat when you're seated; otherwise the bottom seat is a normal one in `seats`. */
  hero: (SeatSlot & { cards: Box }) | null;
  seats: SeatSlot[];
  /** The centre column: x of its middle, and the top of each part. */
  center: { x: number; tagTop: number; pillTop: number; resultTop: number; boardTop: number; infoTop: number };
}

export interface LayoutInput {
  w: number;
  h: number;
  /** Seat numbers clockwise from the bottom: [bottom, ...others]. */
  seats: number[];
  /** The bottom seat is you (big cards, bigger plate). */
  heroSeated: boolean;
  holeCards: number;
  /** Board rows: boards × runs (1–4). */
  boardRows: number;
  /** Extra height under the table info (e.g. the Copy link button), at full size. */
  infoExtra: number;
}

/** Phones: how many opponents go up the left side, along the top and down the right. */
const PHONE_SLOTS: Record<number, [number, number, number]> = {
  0: [0, 0, 0],
  1: [0, 1, 0],
  2: [1, 0, 1],
  3: [1, 1, 1],
  4: [1, 2, 1],
  5: [2, 1, 2],
  6: [2, 2, 2],
  7: [2, 3, 2],
  8: [2, 4, 2],
};

/** Width of a fan of n cards of width `cw`, overlapping by the given step. */
export function fanWidth(n: number, cw: number, step: number): number {
  return cw + step * Math.max(0, n - 1);
}

/** Horizontal step between cards in a seat's fan. */
export function fanStep(n: number, cw: number, maxW?: number): number {
  if (n <= 2) return cw * 0.62;
  const step = cw * (n === 4 ? 0.46 : 0.38);
  return maxW ? Math.min(step, (maxW - cw) / (n - 1)) : step;
}

function sizes(mode: "phone" | "desktop", k: number, holeCards: number, boardRows: number, w: number, s: number): Sizes {
  const fan = holeCards > 2;
  const tier = k <= 3 ? 0 : k <= 5 ? 1 : 2;
  const pick = <T,>(a: [T, T, T]) => a[tier]!;
  const d = mode === "desktop";
  const plateW = d ? 160 : pick([132, 112, 88]);
  const plateH = d ? 58 : pick([52, 50, 46]);
  const cardW = d ? (fan ? 40 : 50) : fan ? pick([34, 30, 28]) : pick([44, 40, 36]);
  const cardH = Math.round(cardW * 1.4);
  const heroCardW = d ? 100 : 84;
  const heroCardH = d ? 140 : 118;
  const heroFanMax = d ? 260 : 210;
  const rows = Math.max(1, boardRows);
  const baseBoardW = d ? [72, 60, 46][Math.min(rows, 3) - 1]! : [62, 52, 40][Math.min(rows, 3) - 1]!;
  const boardGap = rows >= 3 ? 6 : 8;
  const boardLabelW = rows > 1 ? 22 : 0;
  const z: Sizes = {
    s,
    plateW,
    plateH,
    nameFont: d ? 15 : pick([14, 13, 12]),
    stackFont: d ? 17 : pick([16, 15, 14]),
    cardW,
    cardH,
    // The fan rises a little higher than one card: its outer cards are tilted.
    above: cardH + 4 - 8,
    chipH: d ? 26 : tier === 2 ? 22 : 24,
    chipFont: d ? 15 : tier === 2 ? 13 : 14,
    heroCardW,
    heroCardH,
    heroFanW: Math.min(heroFanMax, fanWidth(holeCards, heroCardW, fanStep(holeCards, heroCardW, heroFanMax))) + 12,
    heroFanH: heroCardH + 8,
    heroPlateW: d ? 170 : 150,
    heroPlateH: d ? 60 : 56,
    heroNameFont: d ? 16 : 15,
    heroStackFont: d ? 18 : 17,
    boardCardW: baseBoardW,
    boardCardH: 0,
    boardGap,
    rowGap: 6,
    boardLabelW,
    pillH: d ? 48 : 44,
    pillFont: 28,
    tagH: 16,
    resultH: 18,
    infoH: 36,
    dealer: 24,
    tagsBelow: 26,
  };
  // Scale everything, then fit the board to the width (as large as fits).
  for (const key of Object.keys(z) as (keyof Sizes)[]) if (key !== "s") z[key] = z[key] * s;
  const maxBoardW = (Math.min(w, d ? 1200 : w) - (d ? 120 : 40) - z.boardLabelW - 4 * z.boardGap) / 5;
  z.boardCardW = Math.floor(Math.min(z.boardCardW, maxBoardW));
  z.boardCardH = Math.round(z.boardCardW * 1.42);
  return z;
}

/** The bottom seat (you, or seat 1 for someone watching) and everything it needs above it. */
function bottomSeat(inp: LayoutInput, z: Sizes, m: number) {
  const { w, h } = inp;
  const pw = inp.heroSeated ? z.heroPlateW : z.plateW;
  const ph = inp.heroSeated ? z.heroPlateH : z.plateH;
  const plate: Box = { x: (w - pw) / 2, y: h - m - ph, w: pw, h: ph };
  // Your cards stand just above your plate; hand tags sit on their bottom edge.
  const cards: Box = inp.heroSeated
    ? { w: z.heroFanW, h: z.heroFanH, x: (w - z.heroFanW) / 2, y: plate.y - 6 * z.s - z.heroFanH }
    : { w: pw, h: z.above, x: plate.x, y: plate.y - z.above };
  const bet = { x: w / 2, y: cards.y - 4 * z.s - z.chipH / 2, align: "center" as const };
  const slot: SeatSlot & { cards: Box } = {
    seat: inp.seats[0]!,
    side: "bottom",
    plate,
    cards,
    bet,
    dealer: { x: plate.x - z.dealer / 2 - 6 * z.s, y: plate.y + z.dealer / 2 },
  };
  return { slot, top: bet.y - z.chipH / 2 - 2 * z.s };
}

const overlapsX = (a: { x: number; w: number }, b: { x: number; w: number }, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad;

function phoneLayout(inp: LayoutInput, s: number): FeltLayout | null {
  const { w, h } = inp;
  const k = inp.seats.length - 1;
  const z = sizes("phone", k, inp.holeCards, inp.boardRows, w, s);
  const m = 4 * s;
  const g = 6 * s;
  const [leftN, topN, rightN] = PHONE_SLOTS[Math.min(8, Math.max(0, k))]!;
  const { plateW: pw, plateH: ph } = z;
  // A typical bet pill, chip disc included.
  const chipW = 76 * s;

  const bottom = inp.seats.length > 0 ? bottomSeat(inp, z, m) : null;
  const bottomTop = bottom ? bottom.top : h;

  // Top row: cards above the plates, bets below.
  const topPlateY = m + z.above;
  const topBottom = topN ? topPlateY + ph + Math.max(4 * s + z.chipH, z.tagsBelow) : m;
  const lo = m + pw / 2;
  const hi = w - m - pw / 2;
  const topXs =
    topN === 1
      ? [w / 2]
      : topN === 2
        ? [0.3 * w, 0.7 * w]
        : topN === 3
          ? [0.22 * w, 0.5 * w, 0.78 * w]
          : Array.from({ length: topN }, (_, i) => lo + ((hi - lo) * i) / Math.max(1, topN - 1));
  for (let i = 1; i < topXs.length; i++) if (topXs[i]! - topXs[i - 1]! < pw + 4 * s) return null;
  if (topXs.some((x) => x - pw / 2 < m - 0.5 || x + pw / 2 > w - m + 0.5)) return null;

  // Side columns: under the top row if it reaches over them.
  const sideLeft: Box = { x: m, y: 0, w: pw, h: ph };
  const topReachesSides = topXs.some((x) => overlapsX({ x: x - pw / 2, w: pw }, sideLeft, 16 * s));
  const colTop = topN && topReachesSides ? topBottom + g : m;
  const hasU = leftN >= 1 || rightN >= 1;
  const hasL = leftN >= 2 || rightN >= 2;
  let uPlateY = colTop + z.above;

  const aboveBoard = z.tagH + 2 * s + z.pillH + 4 * s + z.resultH + 6 * s;
  const rows = Math.max(1, inp.boardRows);
  const boardH = rows * z.boardCardH + (rows - 1) * z.rowGap;
  const infoH = z.infoH + inp.infoExtra * s;
  // Under each opponent's plate: their bet during a hand, showdown tags after it.
  const below = Math.max(4 * s + z.chipH, z.tagsBelow);
  const boardTopMin = () => Math.max(hasU ? uPlateY + ph + below + g : 0, (topN ? topBottom + 2 * s : m) + aboveBoard);

  let boardTop = boardTopMin();
  const lPlateY = () => boardTop + boardH + g + z.above;
  // Room left once everything is in: the centre column must end above the bottom
  // seat, and a lower side seat (with its bet) must stay clear of it too.
  const slack = () => {
    const infoBottom = boardTop + boardH + 8 * s + infoH;
    let room = bottomTop - 4 * s - infoBottom;
    if (hasL && bottom) {
      const lBottom = lPlateY() + ph + z.tagsBelow;
      const lChipTop = lPlateY() + ph / 2 - z.chipH / 2;
      if (lChipTop < infoBottom + 2 * s) return -1;
      room = Math.min(room, h - m - lBottom);
      const lSide: Box = { x: m, y: 0, w: pw + 4 * s + chipW, h: 0 };
      const clearOfCards = bottom.slot.cards.y - 4 * s;
      if (overlapsX(lSide, bottom.slot.cards) || overlapsX(lSide, bottom.slot.plate)) room = Math.min(room, clearOfCards - lBottom);
    }
    return room;
  };
  const room = slack();
  if (room < 0) return null;
  // Spread the spare height: the board towards the middle, the upper seats a little.
  boardTop += room / 2;
  if (hasU) uPlateY = Math.min(uPlateY + room / 4, boardTop - g - ph);

  const seats: SeatSlot[] = [];
  const order = inp.seats.slice(1);
  let next = 0;
  const side = (plateY: number, sideName: "left" | "right", lower: boolean) => {
    const plate: Box = { x: sideName === "left" ? m : w - m - pw, y: plateY, w: pw, h: ph };
    const inner = sideName === "left" ? plate.x + pw : plate.x;
    const dir = sideName === "left" ? 1 : -1;
    // Upper seats bet under their plate (the pot pill is beside it); lower ones beside the plate.
    seats.push({
      seat: order[next++]!,
      side: sideName,
      plate,
      bet: lower
        ? { x: inner + dir * 6 * s, y: plateY + ph / 2, align: sideName === "left" ? "left" : "right" }
        : { x: plate.x + pw / 2 + dir * pw * 0.12, y: plateY + ph + 4 * s + z.chipH / 2, align: "center" },
      // On the plate's lower outer corner: clear of the bet (inner side) and the pot.
      dealer: { x: sideName === "left" ? plate.x + z.dealer * 0.7 : plate.x + pw - z.dealer * 0.7, y: plateY + ph },
    });
  };
  // Clockwise from you: up the left side, along the top, down the right.
  if (leftN >= 2) side(lPlateY(), "left", true);
  if (leftN >= 1) side(uPlateY, "left", false);
  for (const x of topXs) {
    const plate: Box = { x: x - pw / 2, y: topPlateY, w: pw, h: ph };
    seats.push({
      seat: order[next++]!,
      side: "top",
      plate,
      bet: { x, y: plate.y + ph + 4 * s + z.chipH / 2, align: "center" },
      dealer: { x: plate.x, y: plate.y + ph },
    });
  }
  if (rightN >= 1) side(uPlateY, "right", false);
  if (rightN >= 2) side(lPlateY(), "right", true);

  const feltTop = topN ? topPlateY + ph / 2 : hasU ? uPlateY + ph / 2 : m + 24 * s;
  const feltBottom = bottom ? bottom.slot.plate.y + bottom.slot.plate.h / 2 : h - m;
  const felt: Box = { x: 16, y: feltTop, w: w - 32, h: Math.max(0, feltBottom - feltTop) };
  return finish("phone", inp, z, felt, Math.min(120 * s, felt.w / 2, felt.h / 2), bottom, seats, boardTop, boardH, aboveBoard);
}

function desktopLayout(inp: LayoutInput, s: number): FeltLayout | null {
  const { w, h } = inp;
  const k = inp.seats.length - 1;
  const z = sizes("desktop", k, inp.holeCards, inp.boardRows, w, s);
  const m = 8 * s;
  const { plateW: pw, plateH: ph } = z;
  const bottom = inp.seats.length > 0 ? bottomSeat(inp, z, m) : null;
  const bottomTop = bottom ? bottom.top : h;

  const feltW = Math.min(1200, w - 48);
  const cx = w / 2;
  const topY = m + z.above + ph / 2;
  const bottomY = bottom ? bottom.slot.plate.y + bottom.slot.plate.h / 2 : h - m - ph / 2;
  const cy = (topY + bottomY) / 2;
  const rx = feltW / 2;
  const ry = (bottomY - topY) / 2;
  if (ry <= 0) return null;

  // Spread evenly along the stadium's edge, clockwise from you at the bottom centre:
  // bottom straight (left half), left end, top straight, right end, bottom (right half).
  const R = ry;
  const straight = Math.max(0, 2 * (rx - R));
  const perimeter = 2 * straight + 2 * Math.PI * R;
  const along = (t: number): [number, number] => {
    let d = t;
    if (d < straight / 2) return [cx - d, cy + R];
    d -= straight / 2;
    if (d < Math.PI * R) {
      const a = d / R; // 0 at the bottom of the left end, π at its top
      return [cx - straight / 2 - R * Math.sin(a), cy + R * Math.cos(a)];
    }
    d -= Math.PI * R;
    if (d < straight) return [cx - straight / 2 + d, cy - R];
    d -= straight;
    if (d < Math.PI * R) {
      const a = d / R;
      return [cx + straight / 2 + R * Math.sin(a), cy - R * Math.cos(a)];
    }
    d -= Math.PI * R;
    return [cx + straight / 2 - d, cy + R];
  };
  const seats: SeatSlot[] = [];
  let centerTopMin = m;
  const boardW = 5 * z.boardCardW + 4 * z.boardGap + z.boardLabelW;
  const column = { x: cx - Math.max(boardW, 260 * s) / 2, w: Math.max(boardW, 260 * s) };
  const blocks: Box[] = [];
  for (let i = 0; i < k; i++) {
    const [px, py] = k === 1 ? [cx, cy - R] : along(((i + 1) * perimeter) / (k + 1));
    // Seats on the bottom rail sit a little higher so their showdown tags stay on screen.
    const plate: Box = { x: Math.min(w - m - pw, Math.max(m, px - pw / 2)), y: Math.min(py - ph / 2, h - m - ph - z.tagsBelow), w: pw, h: ph };
    const pcx = plate.x + pw / 2;
    const pcy = plate.y + ph / 2;
    const vx = cx - pcx;
    const vy = cy - pcy;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len;
    const uy = vy / len;
    // Just clear of the plate, towards the middle.
    const t = Math.min(
      Math.abs(ux) > 1e-6 ? (pw / 2 + 10 * s + 30 * s) / Math.abs(ux) : Infinity,
      Math.abs(uy) > 1e-6 ? (ph / 2 + 8 * s + z.chipH / 2) / Math.abs(uy) : Infinity,
    );
    const bet = { x: pcx + ux * t, y: pcy + uy * t, align: "center" as const };
    const sideName: SeatSide = Math.abs(ux) > Math.abs(uy) ? (ux > 0 ? "left" : "right") : "top";
    const dealer =
      sideName === "top"
        ? { x: plate.x, y: plate.y + ph }
        : { x: sideName === "left" ? plate.x + pw : plate.x, y: uy > 0 ? plate.y + ph : plate.y };
    seats.push({ seat: inp.seats[i + 1]!, side: sideName, plate, bet, dealer });
    if (overlapsX(plate, column)) centerTopMin = Math.max(centerTopMin, plate.y + ph + 4 * s);
    if (bet.x + 30 * s > column.x && bet.x - 30 * s < column.x + column.w && bet.y < cy) {
      centerTopMin = Math.max(centerTopMin, bet.y + z.chipH / 2 + 4 * s);
    }
    blocks.push({ x: plate.x, y: plate.y - z.above, w: pw, h: ph + z.above + z.tagsBelow });
  }
  // Seats (with their cards and tags) never overlap each other or your seat.
  if (bottom) blocks.push({ x: Math.min(bottom.slot.plate.x, bottom.slot.cards.x), y: bottom.slot.cards.y, w: Math.max(bottom.slot.plate.w, bottom.slot.cards.w), h: h - bottom.slot.cards.y });
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]!;
      const b = blocks[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return null;
    }

  const aboveBoard = z.tagH + 2 * s + z.pillH + 4 * s + z.resultH + 6 * s;
  const rows = Math.max(1, inp.boardRows);
  const boardH = rows * z.boardCardH + (rows - 1) * z.rowGap;
  const infoH = z.infoH + inp.infoExtra * s;
  const need = aboveBoard + boardH + 8 * s + infoH;
  const room = bottomTop - 4 * s - centerTopMin - need;
  if (room < 0) return null;
  const boardTop = centerTopMin + aboveBoard + room / 2;
  const felt: Box = { x: cx - feltW / 2, y: topY, w: feltW, h: bottomY - topY };
  return finish("desktop", inp, z, felt, felt.h / 2, bottom, seats, boardTop, boardH, aboveBoard);
}

function finish(
  mode: "phone" | "desktop",
  inp: LayoutInput,
  z: Sizes,
  felt: Box,
  radius: number,
  bottom: ReturnType<typeof bottomSeat> | null,
  seats: SeatSlot[],
  boardTop: number,
  boardH: number,
  aboveBoard: number,
): FeltLayout {
  const s = z.s;
  const pillTop = boardTop - aboveBoard + z.tagH + 2 * s;
  const hero = bottom && inp.heroSeated ? bottom.slot : null;
  if (bottom && !inp.heroSeated) seats.unshift({ ...bottom.slot });
  return {
    mode,
    w: inp.w,
    h: inp.h,
    z,
    felt,
    radius,
    hero,
    seats,
    center: {
      x: inp.w / 2,
      tagTop: boardTop - aboveBoard,
      pillTop,
      resultTop: pillTop + z.pillH + 4 * s,
      boardTop,
      infoTop: boardTop + boardH + 8 * s,
    },
  };
}

/** Desktop once the screen is wide (or clearly landscape); phones otherwise. */
export function layoutMode(w: number, h: number): "phone" | "desktop" {
  return w >= 1024 || w > h * 1.3 ? "desktop" : "phone";
}

/** The largest layout that fits, shrinking in small steps. */
export function layoutFelt(inp: LayoutInput): FeltLayout | null {
  if (inp.w <= 0 || inp.h <= 0) return null;
  const mode = layoutMode(inp.w, inp.h);
  const max = mode === "desktop" ? Math.min(1.35, Math.max(1, inp.h / 600)) : Math.min(1.12, inp.w / 390);
  const fn = mode === "desktop" ? desktopLayout : phoneLayout;
  for (let s = max; s >= 0.5; s -= 0.02) {
    const l = fn(inp, s);
    if (l) return l;
  }
  return fn(inp, 0.5) ?? phoneLayout(inp, 0.5);
}
