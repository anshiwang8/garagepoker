import type { TableView } from "@garagepoker/protocol";
import { useEffect, useRef, useState } from "react";
import { formatChips } from "@/lib/chips";
import { CopyLinkButton } from "../ui";
import { CardSlot, PlayingCard } from "./PlayingCard";
import { wonBySeat } from "./HandResult";
import { type Countdown, Seat } from "./Seat";

/**
 * Angle of a seat round the table, 0° = bottom (you), clockwise. The other
 * seats spread evenly over an arc that leaves the bottom corners free: on
 * phones for your own (bigger) seat, in landscape for the action float and its
 * raise panel too, so the arc starts further up there.
 */
function seatAngle(index: number, count: number, wide: boolean): number {
  if (index === 0) return 0;
  const others = count - 1;
  if (others === 1) return 180;
  const start = Math.max(360 / count, wide ? 84 : 55);
  return start + ((360 - 2 * start) * (index - 1)) / (others - 1);
}

/** Point on an ellipse around the table centre, in % of the felt box. */
function ellipse(deg: number, rx: number, ry: number, cy: number) {
  const a = ((90 + deg) * Math.PI) / 180;
  return { x: 50 + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
}

/**
 * Where a seat sits. Yours is pinned to the bottom edge; the others go round
 * the ellipse (.seat-pos in globals.css picks the phone or landscape point and
 * clamps it so a seat near the edge never runs off the screen).
 */
function seatPosition(index: number, count: number): React.CSSProperties {
  if (index === 0) return { left: "50%", bottom: 2, transform: "translateX(-50%)" };
  const p = ellipse(seatAngle(index, count, false), 42, 44, 46);
  const w = ellipse(seatAngle(index, count, true), 42, 44, 46);
  return { "--xp": `${p.x}%`, "--yp": `${p.y}%`, "--xw": `${w.x}%`, "--yw": `${w.y}%` } as React.CSSProperties;
}

/** A seat's bet, pulled toward the centre (landscape only). */
function betPosition(index: number, count: number): React.CSSProperties {
  const b = ellipse(seatAngle(index, count, true), 26, 24, 50);
  return { left: `${b.x}%`, top: `${b.y}%` };
}

export function TableFelt({
  view,
  countdown,
  canSit,
  onSit,
  onShow,
  statusText,
}: {
  view: TableView;
  countdown: Countdown | null;
  canSit: boolean;
  onSit: (seat: number) => void;
  /** Show some or all of your cards from the last hand. */
  onShow: (hand: number, cards: string[]) => void;
  statusText: string | null;
}) {
  const { hand, lastHand, settings } = view;
  const n = settings.seats;
  const dc = settings.displayCents;
  // Rotate so you're at the bottom; spectators see seat 1 there.
  const anchor = view.you.seat ?? 1;
  const indexOf = (seat: number) => (seat - anchor + n) % n;

  const showResult = !hand && lastHand && lastHand.number === view.handNumber;
  const shownBySeat = new Map(showResult ? lastHand.shown.map((s) => [s.seat, s]) : []);
  // Cards players chose to show after the hand, until the next deal.
  const showedBySeat = new Map<number, string[]>();
  if (showResult) for (const s of lastHand.showed) showedBySeat.set(s.seat, [...(showedBySeat.get(s.seat) ?? []), ...s.cards]);
  const won = showResult ? wonBySeat(lastHand) : new Map<number, number>();
  const boards = hand?.boards ?? (showResult ? lastHand.boards : []);
  const bombPot = hand?.bombPot ?? (showResult && lastHand.bombPot);
  const secondRun = showResult ? lastHand.secondRun : null;
  const rabbit = showResult ? lastHand.rabbit : null;
  // One row per run × board: up to 4 when a double board ran twice.
  const rows = [boards, ...(secondRun ? [secondRun] : [])].flatMap((run, r) =>
    run.map((cards, b) => ({ run: r, board: b, cards })),
  );
  const cardSize = rows.length > 2 ? "xs" : "sm";

  // After a hand: the cards you've picked to show (tap again to unpick), per hand.
  const [picked, setPicked] = useState<{ hand: number; cards: string[] }>({ hand: 0, cards: [] });
  const showable = view.you.showable && lastHand ? view.you.showable : null;
  const pickedNow = showable && picked.hand === lastHand!.number ? picked.cards.filter((c) => showable.includes(c)) : [];
  const togglePick = (card: string) =>
    setPicked({ hand: lastHand!.number, cards: pickedNow.includes(card) ? pickedNow.filter((c) => c !== card) : [...pickedNow, card] });
  const show = (cards: string[]) => {
    onShow(lastHand!.number, cards);
    setPicked({ hand: lastHand!.number, cards: [] });
  };

  // Measure your seat, and the tallest other seat, so the others always stay
  // above yours (.seat-pos in globals.css).
  const feltRef = useRef<HTMLDivElement>(null);
  const [heroH, setHeroH] = useState<number | null>(null);
  const [oppH, setOppH] = useState<number | null>(null);
  useEffect(() => {
    const felt = feltRef.current;
    if (!felt) return;
    const measure = () => {
      const hero = felt.querySelector<HTMLElement>("[data-hero]");
      setHeroH(hero ? Math.ceil(hero.getBoundingClientRect().height) : null);
      let tallest = 0;
      felt.querySelectorAll<HTMLElement>(".seat-pos").forEach((el) => (tallest = Math.max(tallest, el.getBoundingClientRect().height)));
      setOppH(tallest ? Math.ceil(tallest) : null);
    };
    const ro = new ResizeObserver(measure);
    felt.querySelectorAll("[data-hero], .seat-pos").forEach((el) => ro.observe(el));
    measure();
    return () => ro.disconnect();
  }, [n]);

  return (
    // overflow-hidden: nothing on the felt ever spills over the action bar below it.
    <div
      className="relative min-h-0 flex-1 select-none overflow-hidden [--seat-edge:3.55rem] wide:[--seat-edge:4.75rem]"
      ref={feltRef}
      style={
        {
          ...(heroH && { "--hero-h": `${heroH + 2}px` }),
          ...(oppH && { "--opp-half": `${Math.ceil(oppH / 2) + 2}px` }),
        } as React.CSSProperties
      }
    >
      {/* Rail and felt */}
      <div className="absolute inset-[9%_7%] rounded-[50%] border-[10px] border-rail bg-[radial-gradient(ellipse_at_center,var(--color-felt)_0%,var(--color-felt-dark)_75%)] shadow-[inset_0_0_40px_rgba(0,0,0,.6)]" />

      {/* Centre: bomb-pot banner, pot above the board(s) */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-[18%] text-center">
        {bombPot && (
          <div className="rounded-full bg-danger px-3 py-0.5 text-[11px] font-bold uppercase tracking-widest text-white shadow">
            Bomb pot
          </div>
        )}
        {hand && (
          <div className="rounded-full bg-black/40 px-3 py-0.5 text-sm">
            Pot <span className="tabular font-bold text-gold">{formatChips(hand.pot, dc)}</span>
          </div>
        )}
        {rows.map(({ run, board, cards: row }) => {
          const label = [secondRun && `Run ${run + 1}`, boards.length > 1 && `Board ${board + 1}`].filter(Boolean).join(" · ");
          const hunted = run === 0 && rabbit ? rabbit.boards[board] ?? [] : [];
          return (
            // Phones: the label goes above its row, keeping a double board narrow enough
            // for the seats beside it; landscape: to the left.
            <div key={`${run}-${board}`} className="flex flex-col items-center gap-0.5 wide:flex-row wide:gap-1.5" aria-label={label || "Board"}>
              {label && (
                <div className="flex shrink-0 items-baseline gap-1 text-[10px] leading-tight wide:w-12 wide:flex-col wide:items-end wide:gap-0">
                  <span className="text-muted">{label}</span>
                  {/* Each board plays for its half of the pot (server-computed). */}
                  {hand && <span className="tabular font-semibold text-gold">{formatChips(hand.boardShares[board]!, dc)}</span>}
                </div>
              )}
              <div className="flex gap-1">
                {Array.from({ length: 5 }, (_, i) => {
                  const card = row[i] ?? hunted[i - row.length];
                  if (!card) return <CardSlot key={i} size={cardSize} />;
                  // Rabbit cards: what would have come. Display only.
                  return <PlayingCard key={i} card={card} size={cardSize} dim={i >= row.length} />;
                })}
              </div>
            </div>
          );
        })}
        {rabbit && (
          <div className="text-[10px] uppercase tracking-wider text-muted">Rabbit hunt by {rabbit.by} · display only</div>
        )}
        {statusText && <div className="max-w-[16rem] text-sm text-text/80">{statusText}</div>}
        {/* No hand running (new, paused or waiting for players): invite people. */}
        {!hand && view.status !== "ended" && (view.status === "paused" || view.handNumber === 0) && <CopyLinkButton />}
      </div>

      {/* Settings saved mid-hand: everyone sees they're coming. */}
      {view.pendingSettings && (
        <div className="absolute inset-x-0 top-1 z-20 flex justify-center">
          <span className="rounded-full border border-gold/50 bg-panel/95 px-3 py-0.5 text-xs text-gold shadow">
            Settings changed · Changes apply next hand
          </span>
        </div>
      )}

      {/* Bets, pulled toward the centre (landscape; phones show them at each seat). */}
      {hand &&
        view.seats.map((s) =>
          s && s.bet > 0 ? (
            <div
              key={`bet-${s.seat}`}
              className="absolute hidden -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold tabular text-gold wide:block"
              style={betPosition(indexOf(s.seat), n)}
            >
              {formatChips(s.bet, dc)}
            </div>
          ) : null,
        )}

      {/* Seats */}
      {view.seats.map((s, i) => {
        const number = i + 1;
        return (
          <div
            key={number}
            data-hero={indexOf(number) === 0 ? "" : undefined}
            className={`absolute z-10 ${indexOf(number) === 0 ? "" : "seat-pos"}`}
            style={seatPosition(indexOf(number), n)}
          >
            <Seat
              seat={s}
              number={number}
              isYou={number === view.you.seat}
              isButton={view.buttonSeat === number && !!s}
              labels={number === view.you.seat ? view.you.labels : null}
              toAct={hand?.toAct === number}
              countdown={hand?.toAct === number ? countdown : null}
              displayCents={dc}
              shown={shownBySeat.get(number)}
              showed={showedBySeat.get(number)}
              picker={
                number === view.you.seat && showable
                  ? { showable, picked: pickedNow, toggle: togglePick, showAll: () => show(showable), showPicked: () => show(pickedNow) }
                  : undefined
              }
              won={won.get(number)}
              canSit={canSit}
              onSit={() => onSit(number)}
            />
          </div>
        );
      })}
    </div>
  );
}
