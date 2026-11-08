"use client";

import { type BoardGrid, type Variant, VARIANTS } from "@garagepoker/engine";
import type { LastHandView, SeatView, TableView } from "@garagepoker/protocol";
import { Eye } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { formatChips } from "@/lib/chips";
import { CopyLinkButton } from "../ui";
import { wonBySeat } from "./HandResult";
import { boardBlock, type FeltLayout, fanStep, GRID_SIZE, layoutFelt, rowHeight, type SeatSlot, tagRowWidth } from "./layout";
import { byRank, CardBack, CardFan, type Deal, PlayingCard } from "./PlayingCard";
import { BetChip, type Countdown, DealerButton, HandTags, NamePlate, SitButton } from "./Seat";
import { resultSummary, showingResult, tableStateText, VARIANT_SHORT } from "./tableText";

/** The lines of table info under the board, and the Copy link button when nothing's running. */
function useInfo(view: TableView) {
  const owner = view.seats.find((s) => s?.isOwner)?.nickname ?? null;
  const state = tableStateText(view);
  const copyLink = !view.hand && view.status !== "ended" && !showingResult(view) && !view.you.watchBlocked;
  return { owner, state, copyLink };
}

/**
 * The grid the boards on the felt are laid out in (Tic-Tac-Toe), or null for
 * rows of 5. A finished hand keeps its own, even if the owner has since
 * switched games.
 */
function boardGridOf(view: TableView): BoardGrid | null {
  if (!view.hand && showingResult(view)) return view.lastHand!.grid;
  return (VARIANTS[view.settings.variant] as Variant).board.grid ?? null;
}

/** One board row on the felt (or one grid): a board of one run. */
interface BoardRowData {
  run: number;
  board: number;
  /** "B1", "R2 B1"; empty for a single board run once. */
  label: string;
  cards: string[];
  /** Rabbit-hunted cards after the dealt ones (run 1 only). */
  hunted: string[];
  /** Face-down backs under the Reveal strip, as the server counts them (run 1 only). */
  backs: number;
}

/**
 * The boards to draw: this hand's, or the last hand's (both runs). Rabbit-hunt
 * backs show only while a seated player can still hunt, and how many comes
 * from the server: a red river board can need one more than the cards still
 * to come, and the client never works that out from the board's length.
 */
function boardRowsOf(view: TableView): { rows: BoardRowData[]; rabbitStrip: boolean; longest: number } {
  const result = showingResult(view) ? view.lastHand : null;
  const boards = view.hand?.boards ?? result?.boards ?? [];
  const multiRun = !!result?.secondRun;
  const rabbitStrip = !!result?.rabbitAvailable && !result.rabbit && view.you.seat !== null;
  const rows = [boards, ...(result?.secondRun ? [result.secondRun] : [])].flatMap((run, r) =>
    run.map((cards, b) => ({
      run: r,
      board: b,
      label: [multiRun && `R${r + 1}`, boards.length > 1 && `B${b + 1}`].filter(Boolean).join(" "),
      cards,
      hunted: r === 0 && result?.rabbit ? (result.rabbit.boards[b] ?? []) : [],
      backs: r === 0 && rabbitStrip ? (result.rabbitBacks[b] ?? 0) : 0,
    })),
  );
  // Red river boards can be longer than 5 (and run 2 longer than run 1).
  const longest = Math.max(5, ...rows.map((row) => row.cards.length + row.hunted.length + row.backs));
  return { rows, rabbitStrip, longest };
}

/**
 * The badges above the pot: "Bomb pot", and "Red river" (with the round
 * number during extra rounds: "RED RIVER 2") while red river is on for the
 * hand. Side by side when both are on.
 */
function badgesOf(view: TableView): { bombPot: boolean; redRiver: string | null } {
  const result = showingResult(view) ? view.lastHand : null;
  const { hand } = view;
  const bombPot = hand?.bombPot ?? result?.bombPot ?? false;
  const on = hand?.redRiver ?? result?.redRiver ?? false;
  const round = hand?.street === "extra" && hand.extraRound > 0 ? hand.extraRound : 0;
  return { bombPot, redRiver: on ? (round ? `Red river ${round}` : "Red river") : null };
}

/** Chips bet on this street, not yet in the pot. */
const streetBets = (view: TableView) => (view.hand ? view.seats.reduce((sum, s) => sum + (s?.bet ?? 0), 0) : 0);

/** Seats clockwise from the bottom: you first; people watching see seat 1 there and every seat. */
function seatOrder(view: TableView): { seats: number[]; heroSeated: boolean } {
  const n = view.settings.seats;
  const me = view.you.seat;
  const anchor = me ?? 1;
  const all = Array.from({ length: n }, (_, i) => ((anchor - 1 + i) % n) + 1);
  // Seated: only occupied seats are drawn, so they spread round the whole rail.
  return me !== null ? { seats: all.filter((s) => s === me || view.seats[s - 1]), heroSeated: true } : { seats: all, heroSeated: false };
}

/** The deal for a seat's cards, given the fan's top left on the felt. */
type Dealer = (seat: number, fan: { x: number; y: number }) => Deal;

/** Cards go round from the button's left, one per player per round, from the middle of the felt. */
function dealerFor(view: TableView, layout: FeltLayout): Dealer {
  const n = view.settings.seats;
  const button = view.buttonSeat ?? 0;
  const fromButton = (s: number) => (s - button - 1 + n) % n;
  const dealt = view.seats.flatMap((s) => (s?.inHand ? [s.seat] : [])).sort((a, b) => fromButton(a) - fromButton(b));
  const rounds = VARIANTS[view.settings.variant].holeCards;
  // About a second for the whole deal, however many cards.
  const gap = Math.min(70, 1000 / Math.max(1, dealt.length * rounds));
  const { felt } = layout;
  const x = felt.x + felt.w / 2;
  const y = felt.y + felt.h / 2;
  return (seat, fan) => ({ x: x - fan.x, y: y - fan.y, slot: Math.max(0, dealt.indexOf(seat)), players: dealt.length, gap });
}

export function Felt({
  view,
  countdown,
  canSit,
  onSit,
  onRabbit,
  onDetails,
}: {
  view: TableView;
  countdown: Countdown | null;
  canSit: boolean;
  onSit: (seat: number) => void;
  onRabbit: () => void;
  onDetails: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const { hand, settings } = view;
  const result = showingResult(view) ? view.lastHand : null;
  const { seats: order, heroSeated } = seatOrder(view);
  const info = useInfo(view);
  const boards = hand?.boards ?? result?.boards ?? [];
  const runs = result?.secondRun ? 2 : 1;
  const boardRows = Math.max(1, boards.length) * runs;
  const boardLength = boardRowsOf(view).longest;
  // With the red river badge, the row above the pot can be wider than the gap
  // between the seats beside it, so the layout keeps it clear of them. (A bomb
  // pot alone keeps today's layout.)
  const badges = badgesOf(view);
  const badgeTexts = [badges.bombPot && "Bomb pot", badges.redRiver].filter((b): b is string => !!b);
  const bets = streetBets(view);
  const tagW = badges.redRiver ? tagRowWidth(badgeTexts, hand && bets > 0 ? `total ${formatChips(hand.pot, settings.displayCents)}` : null) : undefined;
  const infoExtra = (info.copyLink ? 48 : 0) + (view.pendingSettings ? 16 : 0);
  const layout = size
    ? layoutFelt({
        ...size,
        seats: order,
        heroSeated,
        holeCards: VARIANTS[settings.variant].holeCards,
        boardRows,
        boardLength,
        // Between hands nothing is drawn, so a grid needs no room.
        grid: !!boardGridOf(view) && !!(hand || result),
        infoExtra,
        bets: !!hand,
        tagW,
      })
    : null;
  // Hands dealt while you watch fly in; one already running when the page opened just appears.
  const [openedOn] = useState(() => (view.hand ? view.handNumber : null));
  const dealer = layout && hand && view.handNumber !== openedOn ? dealerFor(view, layout) : null;

  return (
    <div ref={ref} className="absolute inset-0 select-none overflow-hidden" data-mode={layout?.mode}>
      {layout && (
        <>
          <Rail layout={layout} />
          <Center view={view} layout={layout} info={info} onRabbit={onRabbit} onDetails={onDetails} />
          {layout.hero && (
            <Hero view={view} slot={layout.hero} layout={layout} countdown={countdown} dealer={dealer} />
          )}
          {layout.seats.map((slot) => (
            <Opponent
              key={slot.seat}
              view={view}
              slot={slot}
              layout={layout}
              countdown={hand?.toAct === slot.seat ? countdown : null}
              dealer={dealer}
              canSit={canSit}
              onSit={() => onSit(slot.seat)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Rail({ layout }: { layout: FeltLayout }) {
  const { felt, radius, z } = layout;
  const rail = Math.max(11, 18 * z.s);
  const trim = Math.max(2, 3.5 * z.s);
  const feltRadius = Math.max(0, radius - rail);
  // The betting line sits a little in from the rail.
  const line = Math.max(12, 24 * z.s);
  return (
    <div
      aria-hidden
      className="table-rail absolute"
      style={{
        left: felt.x,
        top: felt.y,
        width: felt.w,
        height: felt.h,
        borderRadius: radius,
        ["--rail" as string]: `${rail}px`,
        ["--trim" as string]: `${trim}px`,
        ["--radius" as string]: `${radius}px`,
      }}
    >
      <div className="table-felt absolute" style={{ inset: rail, borderRadius: feltRadius }}>
        <div className="table-bet-line" style={{ inset: line, borderRadius: Math.max(0, feltRadius - line) }} />
      </div>
    </div>
  );
}

/** Pot pill, result line, board(s) with rabbit hunt, and the table info. */
function Center({
  view,
  layout,
  info,
  onRabbit,
  onDetails,
}: {
  view: TableView;
  layout: FeltLayout;
  info: ReturnType<typeof useInfo>;
  onRabbit: () => void;
  onDetails: () => void;
}) {
  const { hand, settings } = view;
  const dc = settings.displayCents;
  const { z, center } = layout;
  const result = showingResult(view) ? view.lastHand : null;
  const bets = streetBets(view);
  const collected = hand ? hand.pot - bets : result ? result.pots.reduce((sum, p) => sum + p.amount, 0) : null;
  // Nothing collected yet (preflop): only the "total" tag.
  const pot = collected === null || (hand && collected === 0 && bets === 0) ? null : collected;
  const showPill = pot !== null && pot > 0;
  const { bombPot, redRiver } = badgesOf(view);
  const { rows, rabbitStrip, longest } = boardRowsOf(view);
  const grid = boardGridOf(view);
  // Rows: as wide as the longest row's first line; each row as tall as its own lines, the stack centred in the board's room.
  const block = boardBlock({ boardRows: rows.length, boardLength: longest, grid: false }, z);
  const heights = rows.map((r) => rowHeight(r.cards.length + r.hunted.length + r.backs, z));
  const rowTops = heights.map((_, i) => heights.slice(0, i).reduce((sum, h) => sum + h + z.rowGap, 0));
  const used = heights.reduce((sum, h) => sum + h, 0) + Math.max(0, rows.length - 1) * z.rowGap;
  const rowsTop = center.boardTop + Math.max(0, (block.h - used) / 2);
  const line = (top: number, h: number): React.CSSProperties => ({ position: "absolute", left: 0, right: 0, top, height: h });

  return (
    <>
      {/* Bomb-pot badge and "total" tag, above the pill's corners. */}
      {pot !== null && (
        <div style={line(showPill ? center.tagTop : center.pillTop + (z.pillH - z.tagH) / 2, z.tagH)} className="flex justify-center">
          <div className={`relative flex items-end gap-2 ${showPill ? "justify-between" : "justify-center"}`} style={{ minWidth: 140 * z.s, height: z.tagH }}>
            {bombPot || redRiver ? (
              <span className="flex items-end gap-1">
                {bombPot && (
                  <span
                    data-box="bomb-pot"
                    className="rounded-full bg-alert px-2 font-bold uppercase leading-none tracking-widest text-white"
                    style={{ fontSize: 10 * z.s, paddingBlock: 3 * z.s }}
                  >
                    Bomb pot
                  </span>
                )}
                {redRiver && (
                  <span
                    data-box="red-river"
                    className="whitespace-nowrap rounded-full bg-heart px-2 font-bold uppercase leading-none tracking-widest text-white"
                    style={{ fontSize: 10 * z.s, paddingBlock: 3 * z.s }}
                  >
                    {redRiver}
                  </span>
                )}
              </span>
            ) : showPill ? (
              <span />
            ) : null}
            {hand && bets > 0 && (
              <span className="tabular whitespace-nowrap text-felt-text" style={{ fontSize: 11 * z.s }}>
                total {formatChips(hand.pot, dc)}
              </span>
            )}
          </div>
        </div>
      )}
      {showPill && (
        <div style={line(center.pillTop, z.pillH)} className="flex justify-center">
          <div
            data-box="pot"
            className="tabular flex items-center rounded-full border border-pot-line bg-pot font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]"
            style={{ height: z.pillH, fontSize: z.pillFont, paddingInline: 22 * z.s, minWidth: 110 * z.s, justifyContent: "center" }}
          >
            {formatChips(pot, dc)}
          </div>
        </div>
      )}
      {result && (
        <div style={line(center.resultTop, z.resultH)} className="flex justify-center px-3">
          <div className="flex min-w-0 max-w-full items-center gap-1.5 text-paper" style={{ fontSize: 11.5 * z.s }}>
            <span className="truncate" data-box="result">
              {resultSummary(view, result)}
            </span>
            <button type="button" onClick={onDetails} className="shrink-0 font-semibold text-gold underline-offset-2 hover:underline relative before:absolute before:-inset-x-2 before:-inset-y-3 before:content-['']">
              Details
            </button>
          </div>
        </div>
      )}

      {/* Tic-Tac-Toe: one 3×3 grid per board (and run), side by side. */}
      {/* (Nothing between hands: an empty grid would say nothing.) */}
      {grid && (hand || result) && (
        <GridBoards
          rows={rows}
          grid={grid}
          layout={layout}
          rabbitStrip={rabbitStrip}
          onRabbit={onRabbit}
          winning={result ? winningCards(result) : null}
        />
      )}

      {/* Board rows: B1/B2 (and R1/R2 when run twice). Only dealt cards are drawn; a long red river row wraps. */}
      {!grid &&
        rows.map((row, i) => (
          <BoardRow
            key={`${row.run}-${row.board}`}
            row={row}
            layout={layout}
            box={{ x: (layout.w - block.w) / 2, y: rowsTop + rowTops[i]!, w: block.w, h: heights[i]! }}
            onRabbit={onRabbit}
          />
        ))}

      {/* Table info, or the table's state when nothing's running. */}
      <div className="absolute inset-x-0 flex flex-col items-center px-4 text-center" style={{ top: center.infoTop }} data-box="info">
        {info.owner && (
          <div className="font-semibold uppercase tracking-[0.12em] text-felt-muted/80" style={{ fontSize: 11 * z.s, lineHeight: 1.3 }}>
            Owner: {info.owner}
          </div>
        )}
        <div className="font-medium text-white/85" style={{ fontSize: 14 * z.s, lineHeight: 1.4 }}>
          {info.state ?? (
            <>
              {VARIANT_SHORT[settings.variant]} ~ {formatChips(settings.smallBlind, dc)} / {formatChips(settings.bigBlind, dc)}
              {settings.ante > 0 && <span className="text-white/60"> · ante {formatChips(settings.ante, dc)}</span>}
            </>
          )}
        </div>
        {view.pendingSettings && (
          <div className="font-semibold text-gold" style={{ fontSize: 11 * z.s, lineHeight: 1.4 }}>
            Changes apply next hand
          </div>
        )}
        {info.copyLink && <CopyLinkButton />}
      </div>
    </>
  );
}

/**
 * The board cards each showdown winner played, per run and board ("0-1" is run
 * 1, board 2), so a grid can light up the winning lines. From the server's
 * shown hands; nothing is evaluated here.
 */
function winningCards(result: LastHandView): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (result.shown.length === 0) return out;
  for (const pot of result.pots) {
    for (const slice of pot.slices) {
      if (slice.half === "low" || slice.board === null) continue;
      const run = slice.run ?? 0;
      const board = (run === 1 ? result.secondRun : result.boards)?.[slice.board];
      if (!board) continue;
      const key = `${run}-${slice.board}`;
      const set = out.get(key) ?? new Set<string>();
      for (const w of slice.winners) {
        const shown = result.shown.find((h) => h.seat === w.seat);
        const played = (run === 1 ? shown?.secondRunBest : shown?.best)?.[slice.board] ?? [];
        for (const c of played) if (board.includes(c)) set.add(c);
      }
      out.set(key, set);
    }
  }
  return out;
}

/**
 * Tic-Tac-Toe boards: a 3×3 grid each, side by side (two to a line on phones). Dealt cards fill their
 * squares (new ones slide in); undealt squares are faint outlines, or card
 * backs under a Reveal strip when rabbit hunt is available. At showdown the
 * winning lines' cards are outlined in gold and the rest dimmed.
 */
function GridBoards({
  rows,
  grid,
  layout,
  rabbitStrip,
  onRabbit,
  winning,
}: {
  rows: BoardRowData[];
  grid: BoardGrid;
  layout: FeltLayout;
  rabbitStrip: boolean;
  onRabbit: () => void;
  winning: Map<string, Set<string>> | null;
}) {
  const { z, center } = layout;
  const block = boardBlock({ boardRows: rows.length, boardLength: GRID_SIZE * GRID_SIZE, grid: true }, z);
  return (
    <div
      className="absolute grid items-start justify-center"
      style={{
        left: (layout.w - block.w) / 2,
        top: center.boardTop,
        width: block.w,
        height: block.h,
        gridTemplateColumns: `repeat(${Math.min(rows.length, z.gridCols)}, auto)`,
        columnGap: z.gridGap,
        rowGap: z.rowGap,
      }}
    >
      {rows.map(({ run, board, cards, label, hunted }) => {
        const lit = winning?.get(`${run}-${board}`) ?? null;
        const backs = run === 0 && rabbitStrip;
        return (
          <div key={`${run}-${board}`} data-box="board" className="flex flex-col items-center" aria-label={label || "Board"}>
            {z.gridLabelH > 0 && (
              <span className="text-center font-bold leading-none text-white/70" style={{ height: z.gridLabelH, fontSize: 10 * z.s }}>
                {label}
              </span>
            )}
            <div className="relative">
              <GridSquares cards={cards} hunted={hunted} backs={backs} lit={lit && lit.size > 0 ? lit : null} grid={grid} layout={layout} />
              {backs && (
                <button
                  type="button"
                  onClick={onRabbit}
                  className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-1.5 bg-black/70 font-bold uppercase tracking-widest text-white hover:bg-black/80"
                  style={{ height: Math.max(28, z.boardCardH * 0.5), fontSize: 12 * z.s }}
                  aria-label="Rabbit hunt: reveal the rest of the board"
                >
                  <Eye size={16 * z.s} aria-hidden />
                  Reveal
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GridSquares({
  cards,
  hunted,
  backs,
  lit,
  grid,
  layout,
}: {
  cards: string[];
  hunted: string[];
  backs: boolean;
  lit: Set<string> | null;
  grid: BoardGrid;
  layout: FeltLayout;
}) {
  const { z } = layout;
  const w = z.boardCardW;
  const h = z.boardCardH;
  // Cards dealt since the grid first drew slide in, one after another.
  const [seen, setSeen] = useState({ n: cards.length, from: cards.length });
  let from = seen.from;
  if (seen.n !== cards.length) {
    from = cards.length < seen.n ? 0 : seen.n;
    setSeen({ n: cards.length, from });
  }
  const r = Math.max(3, w * 0.1);
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, ${w}px)`, gap: z.boardGap }}>
      {Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, square) => {
        const i = grid.cells.indexOf(square);
        const card = cards[i];
        if (card) {
          const isNew = i >= from;
          const inLine = lit?.has(card) ?? false;
          return (
            <div
              key={square}
              className={isNew ? "board-in" : undefined}
              style={{
                ...(isNew && { animationDelay: `${(i - from) * 130}ms` }),
                ...(lit && !inLine && { opacity: 0.45 }),
                ...(inLine && { borderRadius: r, boxShadow: `0 0 0 ${Math.max(2, 2.5 * z.s)}px var(--color-gold)` }),
              }}
            >
              <PlayingCard card={card} w={w} h={h} />
            </div>
          );
        }
        const rabbit = hunted[i - cards.length];
        if (rabbit) return <PlayingCard key={square} card={rabbit} w={w} h={h} dim />;
        if (backs) return <CardBack key={square} w={w} h={h} />;
        return <div key={square} aria-hidden className="border border-dashed border-white/15" style={{ width: w, height: h, borderRadius: r }} />;
      })}
    </div>
  );
}

/**
 * The Reveal strip across a row's face-down backs. Over a single back (a red
 * river win often leaves just one) the word sits under the eye, smaller, so it
 * stays on the back.
 */
function RevealStrip({ onClick, narrow, h, s }: { onClick: () => void; narrow: boolean; h: number; s: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center bg-black/70 font-bold uppercase text-white hover:bg-black/80 ${
        narrow ? "flex-col gap-0.5 tracking-wide" : "gap-1.5 tracking-widest"
      }`}
      style={{ height: Math.max(narrow ? 32 : 28, h * 0.34), fontSize: (narrow ? 9 : 12) * s }}
      aria-label="Rabbit hunt: reveal the rest of the board"
    >
      <Eye size={(narrow ? 14 : 16) * s} aria-hidden />
      Reveal
    </button>
  );
}

/**
 * One board row: its dealt cards, then any rabbit-hunted cards, then the
 * face-down backs under a Reveal strip. Each row is drawn at its own length
 * and wraps after `boardPerLine` cards. New cards (a flop, then a turn, then
 * a red river card) slide in one after another; cards already out when the
 * row first drew just appear.
 */
function BoardRow({
  row,
  layout,
  box,
  onRabbit,
}: {
  row: BoardRowData;
  layout: FeltLayout;
  box: { x: number; y: number; w: number; h: number };
  onRabbit: () => void;
}) {
  const { z } = layout;
  const { cards } = row;
  const [seen, setSeen] = useState({ n: cards.length, from: cards.length });
  let from = seen.from;
  if (seen.n !== cards.length) {
    from = cards.length < seen.n ? 0 : seen.n;
    setSeen({ n: cards.length, from });
  }
  const w = z.boardCardW;
  const h = z.boardCardH;
  const items: ({ kind: "card"; card: string; j: number } | { kind: "hunted"; card: string } | { kind: "back" })[] = [
    ...cards.map((card, j) => ({ kind: "card" as const, card, j })),
    ...row.hunted.map((card) => ({ kind: "hunted" as const, card })),
    ...Array.from({ length: row.backs }, () => ({ kind: "back" as const })),
  ];
  const per = Math.max(1, z.boardPerLine);
  const lines = Array.from({ length: Math.max(1, Math.ceil(items.length / per)) }, (_, l) => items.slice(l * per, (l + 1) * per));
  // Backs come last, so on each line they're one run with a Reveal strip across it; the first strip is the labelled button.
  const firstBacks = lines.findIndex((line) => line.some((it) => it.kind === "back"));
  return (
    <div
      data-box="board"
      className="absolute flex items-center"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      aria-label={row.label || "Board"}
    >
      {z.boardLabelW > 0 && (
        <span className="shrink-0 text-center font-bold leading-none text-white/70" style={{ width: z.boardLabelW, fontSize: (row.label.length > 2 ? 8 : 10) * z.s }}>
          {row.label}
        </span>
      )}
      <div className="flex flex-col" style={{ gap: z.boardGap }}>
        {lines.map((line, l) => {
          const cardsHere = line.filter((it) => it.kind !== "back");
          const backs = line.length - cardsHere.length;
          const strip = backs === 0 ? null : l === firstBacks ? "button" : "extra";
          return (
            <div key={l} className="relative flex" style={{ gap: z.boardGap }}>
              {cardsHere.map((it, k) =>
                it.kind === "card" ? (
                  <div
                    key={`c${it.j}`}
                    className={it.j >= from ? "board-in shrink-0" : "shrink-0"}
                    style={it.j >= from ? { animationDelay: `${(it.j - from) * 130}ms` } : undefined}
                  >
                    <PlayingCard card={it.card} w={w} h={h} />
                  </div>
                ) : (
                  // Rabbit cards: what would have come. Display only.
                  <PlayingCard key={`r${l}-${k}`} card={it.card} w={w} h={h} dim />
                ),
              )}
              {strip && (
                <div className="relative flex" style={{ gap: z.boardGap }}>
                  {Array.from({ length: backs }, (_, j) => (
                    <CardBack key={j} w={w} h={h} />
                  ))}
                  {strip === "button" ? (
                    <RevealStrip onClick={onRabbit} narrow={backs * w + (backs - 1) * z.boardGap < 84 * z.s} h={h} s={z.s} />
                  ) : (
                    // The rest of the backs, wrapped onto a later line: the same strip, nothing to press.
                    <div aria-hidden className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-black/70" style={{ height: Math.max(28, h * 0.34) }} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A plate's corner tag: the seat's state, or what they did this street. */
function plateTag(seat: SeatView, view: TableView): { text: string; tone: "danger" | "muted" | "info" } | null {
  if (seat.away) return { text: "Away", tone: "muted" };
  if (!seat.connected) return { text: "Offline", tone: "muted" };
  if (seat.leaving) return { text: "Leaving", tone: "muted" };
  if (!view.hand) return seat.waitingForBB ? { text: "Wait BB", tone: "muted" } : null;
  if (seat.inHand && !seat.folded && seat.allIn) return { text: "All in", tone: "danger" };
  const a = seat.lastAction?.type;
  if (seat.inHand && !seat.folded && (a === "check" || a === "call" || a === "bet" || a === "raise")) return { text: a, tone: "info" };
  return null;
}

/** What the last hand left at a seat: winner, net, cards shown at showdown or after. */
function seatResult(view: TableView, seat: number) {
  const result = showingResult(view) ? view.lastHand : null;
  if (!result) return { won: false, net: null, shown: undefined, showed: undefined };
  const shown = result.shown.find((s) => s.seat === seat);
  const showed = result.showed.filter((s) => s.seat === seat).flatMap((s) => s.cards);
  return {
    won: (wonBySeat(result).get(seat) ?? 0) > 0,
    // (A server older than this page sends no nets or log.)
    net: result.nets?.find((n) => n.seat === seat)?.net ?? null,
    shown,
    showed: showed.length ? showed : undefined,
  };
}

function Opponent({
  view,
  slot,
  layout,
  countdown,
  canSit,
  onSit,
  dealer,
}: {
  view: TableView;
  slot: SeatSlot;
  layout: FeltLayout;
  countdown: Countdown | null;
  canSit: boolean;
  onSit: () => void;
  dealer: Dealer | null;
}) {
  const seat = view.seats[slot.seat - 1];
  const { z } = layout;
  const { plate } = slot;
  if (!seat) {
    if (!canSit) return null;
    const d = Math.min(plate.h * 1.15, plate.w);
    return <SitButton number={slot.seat} size={d} onSit={onSit} style={{ left: plate.x + plate.w / 2 - d / 2, top: plate.y + plate.h / 2 - d / 2 }} />;
  }
  const { hand } = view;
  const res = seatResult(view, slot.seat);
  const cards = res.shown?.cards ?? res.showed ?? (hand && seat.inHand && !seat.folded ? seat.cards : null);
  const n = cards?.length ?? 0;
  const step = fanStep(n, z.cardW);
  const fanW = z.cardW + step * Math.max(0, n - 1);
  const dim = seat.away || (!!hand && (!seat.inHand || seat.folded));
  const tagFont = 10 * z.s;
  const fan = { x: plate.x + (plate.w - fanW) / 2, y: plate.y + 8 * z.s - z.cardH };
  return (
    <div data-opp={slot.seat}>
      {cards && n > 0 && (
        <div
          data-box="cards"
          className="absolute"
          style={{ left: fan.x, top: fan.y, width: fanW, height: z.cardH }}
        >
          <CardFan
            key={view.handNumber}
            cards={cards}
            w={z.cardW}
            h={z.cardH}
            step={step}
            spread={n === 2 ? 10 : 6}
            deal={dealer?.(slot.seat, fan)}
          />
        </div>
      )}
      {/* Showdown tags just under the plate (the layout keeps that room free); the bottom seat's go over its cards. */}
      {res.shown && res.shown.labels.length > 0 && (
        <div
          className="absolute z-10 flex -translate-x-1/2"
          style={{ left: plate.x + plate.w / 2, top: slot.side === "bottom" ? plate.y - 30 * z.s : plate.y + plate.h - 3 * z.s }}
        >
          <HandTags labels={res.shown.labels} font={tagFont} short />
        </div>
      )}
      <NamePlate
        seat={seat}
        w={plate.w}
        h={plate.h}
        nameFont={z.nameFont}
        stackFont={z.stackFont}
        displayCents={view.settings.displayCents}
        countdown={countdown}
        winner={res.won}
        net={res.net}
        dim={dim}
        tag={plateTag(seat, view)}
        bannerSide={slot.side === "right" ? "left" : "right"}
        style={{ left: plate.x, top: plate.y }}
      />
      <SeatExtras view={view} seat={seat} slot={slot} layout={layout} />
    </div>
  );
}

/** Bet chip and dealer button for a seat. */
function SeatExtras({ view, seat, slot, layout }: { view: TableView; seat: SeatView; slot: SeatSlot; layout: FeltLayout }) {
  const { z } = layout;
  const b = slot.bet;
  const chipStyle: React.CSSProperties =
    b.align === "left"
      ? { left: b.x, top: b.y - z.chipH / 2 }
      : b.align === "right"
        ? { right: layout.w - b.x, top: b.y - z.chipH / 2 }
        : { left: b.x, top: b.y - z.chipH / 2, transform: "translateX(-50%)" };
  return (
    <>
      {view.hand && seat.bet > 0 && <BetChip amount={seat.bet} displayCents={view.settings.displayCents} h={z.chipH} font={z.chipFont} style={chipStyle} />}
      {view.buttonSeat === seat.seat && (
        <DealerButton size={z.dealer} style={{ left: slot.dealer.x - z.dealer / 2, top: slot.dealer.y - z.dealer / 2 }} />
      )}
    </>
  );
}

/** Your seat: big face-up cards over the rail, your plate under them. */
function Hero({
  view,
  slot,
  layout,
  countdown,
  dealer,
}: {
  view: TableView;
  slot: SeatSlot & { cards: import("./layout").Box };
  layout: FeltLayout;
  countdown: Countdown | null;
  dealer: Dealer | null;
}) {
  const seat = view.seats[slot.seat - 1];
  if (!seat) return null;
  const { z } = layout;
  const { hand } = view;
  const res = seatResult(view, slot.seat);
  const showable = view.you.showable ?? [];
  const cards: string[] | null =
    res.shown?.cards ??
    (hand ? (seat.inHand ? (seat.cards as string[] | null) : null) : showingResult(view) && (res.showed || showable.length) ? [...(res.showed ?? []), ...showable].sort(byRank) : null);
  const labels = res.shown?.labels ?? (hand && seat.inHand && !seat.folded ? view.you.labels : null);
  const n = cards?.length ?? 0;
  const step = fanStep(n, z.heroCardW, slot.cards.w - 12);
  const fanW = z.heroCardW + step * Math.max(0, n - 1);
  const folded = !!hand && seat.folded;
  const dim = seat.away || folded;
  const { plate } = slot;
  const fan = { x: slot.cards.x + (slot.cards.w - fanW) / 2, y: slot.cards.y + (slot.cards.h - z.heroCardH) };
  return (
    <div data-hero>
      {cards && n > 0 && (
        <div
          data-box="hero-cards"
          className="absolute"
          style={{ left: fan.x, top: fan.y, width: fanW, height: z.heroCardH }}
        >
          <CardFan
            key={view.handNumber}
            cards={cards}
            w={z.heroCardW}
            h={z.heroCardH}
            step={step}
            spread={n === 2 ? 12 : 5}
            dim={folded}
            deal={dealer?.(slot.seat, fan)}
          />
          {labels && labels.length > 0 && (
            <div className="absolute inset-x-0 z-10 flex justify-center" style={{ bottom: -4 * z.s }}>
              <HandTags labels={labels} font={Math.max(10, 11.5 * z.s)} />
            </div>
          )}
        </div>
      )}
      <NamePlate
        seat={seat}
        w={plate.w}
        h={plate.h}
        nameFont={z.heroNameFont}
        stackFont={z.heroStackFont}
        displayCents={view.settings.displayCents}
        countdown={countdown && hand?.toAct === slot.seat ? countdown : null}
        winner={res.won}
        net={res.net}
        dim={dim}
        tag={seat.away || seat.allIn ? plateTag(seat, view) : null}
        style={{ left: plate.x, top: plate.y }}
      />
      <SeatExtras view={view} seat={seat} slot={slot} layout={layout} />
    </div>
  );
}
