"use client";

import { VARIANTS } from "@garagepoker/engine";
import type { SeatView, TableView } from "@garagepoker/protocol";
import { Eye } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { formatChips } from "@/lib/chips";
import { CopyLinkButton } from "../ui";
import { wonBySeat } from "./HandResult";
import { type FeltLayout, fanStep, layoutFelt, type SeatSlot } from "./layout";
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
  const infoExtra = (info.copyLink ? 48 : 0) + (view.pendingSettings ? 16 : 0);
  const layout = size
    ? layoutFelt({ ...size, seats: order, heroSeated, holeCards: VARIANTS[settings.variant].holeCards, boardRows, infoExtra })
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
  const bets = hand ? view.seats.reduce((sum, s) => sum + (s?.bet ?? 0), 0) : 0;
  const collected = hand ? hand.pot - bets : result ? result.pots.reduce((sum, p) => sum + p.amount, 0) : null;
  // Nothing collected yet (preflop): only the "total" tag.
  const pot = collected === null || (hand && collected === 0 && bets === 0) ? null : collected;
  const showPill = pot !== null && pot > 0;
  const bombPot = hand?.bombPot ?? result?.bombPot ?? false;
  const boards = hand?.boards ?? result?.boards ?? [];
  const rabbitStrip = !!result?.rabbitAvailable && view.you.seat !== null;
  const rows = [boards, ...(result?.secondRun ? [result.secondRun] : [])].flatMap((run, r) =>
    run.map((cards, b) => ({ run: r, board: b, cards })),
  );
  const multiRun = !!result?.secondRun;
  const rowW = z.boardLabelW + 5 * z.boardCardW + 4 * z.boardGap;
  const line = (top: number, h: number): React.CSSProperties => ({ position: "absolute", left: 0, right: 0, top, height: h });

  return (
    <>
      {/* Bomb-pot badge and "total" tag, above the pill's corners. */}
      {pot !== null && (
        <div style={line(showPill ? center.tagTop : center.pillTop + (z.pillH - z.tagH) / 2, z.tagH)} className="flex justify-center">
          <div className={`relative flex items-end gap-2 ${showPill ? "justify-between" : "justify-center"}`} style={{ minWidth: 140 * z.s, height: z.tagH }}>
            {bombPot ? (
              <span
                className="rounded-full bg-[#dc2626] px-2 font-bold uppercase leading-none tracking-widest text-white"
                style={{ fontSize: 10 * z.s, paddingBlock: 3 * z.s }}
              >
                Bomb pot
              </span>
            ) : showPill ? (
              <span />
            ) : null}
            {hand && bets > 0 && (
              <span className="tabular whitespace-nowrap text-[#bbf7d0]" style={{ fontSize: 11 * z.s }}>
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
            className="tabular flex items-center rounded-full border border-[#3f9d6c] bg-[#0f3f28] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]"
            style={{ height: z.pillH, fontSize: z.pillFont, paddingInline: 22 * z.s, minWidth: 110 * z.s, justifyContent: "center" }}
          >
            {formatChips(pot, dc)}
          </div>
        </div>
      )}
      {result && (
        <div style={line(center.resultTop, z.resultH)} className="flex justify-center px-3">
          <div className="flex min-w-0 max-w-full items-center gap-1.5 text-[#e5e7eb]" style={{ fontSize: 11.5 * z.s }}>
            <span className="truncate" data-box="result">
              {resultSummary(view, result)}
            </span>
            <button type="button" onClick={onDetails} className="shrink-0 font-semibold text-gold underline-offset-2 hover:underline">
              Details
            </button>
          </div>
        </div>
      )}

      {/* Board rows: B1/B2 (and R1/R2 when run twice). Only dealt cards are drawn. */}
      {rows.map(({ run, board, cards }, i) => {
        const top = center.boardTop + i * (z.boardCardH + z.rowGap);
        const label = [multiRun && `R${run + 1}`, boards.length > 1 && `B${board + 1}`].filter(Boolean).join(" ");
        const hunted = run === 0 && result?.rabbit ? (result.rabbit.boards[board] ?? []) : [];
        const missing = run === 0 && rabbitStrip ? 5 - cards.length : 0;
        return (
          <div
            key={`${run}-${board}`}
            data-box="board"
            className="absolute flex items-center"
            style={{ left: (layout.w - rowW) / 2, top, width: rowW, height: z.boardCardH }}
            aria-label={label || "Board"}
          >
            {z.boardLabelW > 0 && (
              <span className="shrink-0 text-center font-bold leading-none text-white/70" style={{ width: z.boardLabelW, fontSize: (label.length > 2 ? 8 : 10) * z.s }}>
                {label}
              </span>
            )}
            <div className="relative flex" style={{ gap: z.boardGap }}>
              <BoardCards cards={cards} w={z.boardCardW} h={z.boardCardH} />
              {/* Rabbit cards: what would have come. Display only. */}
              {hunted.map((c, j) => (
                <PlayingCard key={`r${j}`} card={c} w={z.boardCardW} h={z.boardCardH} dim />
              ))}
              {missing > 0 && (
                <div className="relative flex" style={{ gap: z.boardGap }}>
                  {Array.from({ length: missing }, (_, j) => (
                    <CardBack key={j} w={z.boardCardW} h={z.boardCardH} />
                  ))}
                  {
                    <button
                      type="button"
                      onClick={onRabbit}
                      className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-1.5 bg-black/70 font-bold uppercase tracking-widest text-white hover:bg-black/80"
                      style={{ height: Math.max(28, z.boardCardH * 0.34), fontSize: 12 * z.s }}
                      aria-label="Rabbit hunt: reveal the rest of the board"
                    >
                      <Eye size={16 * z.s} aria-hidden />
                      Reveal
                    </button>
                  }
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Table info, or the table's state when nothing's running. */}
      <div className="absolute inset-x-0 flex flex-col items-center px-4 text-center" style={{ top: center.infoTop }} data-box="info">
        {info.owner && (
          <div className="font-semibold uppercase tracking-[0.12em] text-[#86c9a3]/80" style={{ fontSize: 11 * z.s, lineHeight: 1.3 }}>
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
 * A board's dealt cards. New ones (a flop, then a turn) slide in one after
 * another; cards already out when the row first drew just appear.
 */
function BoardCards({ cards, w, h }: { cards: string[]; w: number; h: number }) {
  const [seen, setSeen] = useState({ n: cards.length, from: cards.length });
  let from = seen.from;
  if (seen.n !== cards.length) {
    from = cards.length < seen.n ? 0 : seen.n;
    setSeen({ n: cards.length, from });
  }
  return cards.map((c, j) => (
    <div key={j} className={j >= from ? "board-in shrink-0" : "shrink-0"} style={j >= from ? { animationDelay: `${(j - from) * 130}ms` } : undefined}>
      <PlayingCard card={c} w={w} h={h} />
    </div>
  ));
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
