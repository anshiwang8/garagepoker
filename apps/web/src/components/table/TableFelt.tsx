import type { TableView } from "@garagepoker/protocol";
import { formatChips } from "@/lib/chips";
import { CardSlot, PlayingCard } from "./PlayingCard";
import { wonBySeat } from "./HandResult";
import { type Countdown, Seat } from "./Seat";

/** Point on an ellipse around the table centre, in % of the felt box. 0° = bottom, clockwise. */
function around(index: number, count: number, rx: number, ry: number, offsetDeg = 0) {
  const a = ((90 + (index * 360) / count + offsetDeg) * Math.PI) / 180;
  return { left: `${50 + rx * Math.cos(a)}%`, top: `${50 + ry * Math.sin(a)}%` };
}

export function TableFelt({
  view,
  countdown,
  canSit,
  onSit,
  statusText,
}: {
  view: TableView;
  countdown: Countdown | null;
  canSit: boolean;
  onSit: (seat: number) => void;
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

  return (
    <div className="relative min-h-0 flex-1 select-none">
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
            <div key={`${run}-${board}`} className="flex items-center gap-1.5" aria-label={label || "Board"}>
              {label && (
                <div className="flex w-12 shrink-0 flex-col items-end text-[10px] leading-tight">
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
      </div>

      {/* Bets, pulled toward the centre */}
      {hand &&
        view.seats.map((s) =>
          s && s.bet > 0 ? (
            <div
              key={`bet-${s.seat}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-semibold tabular text-gold"
              style={around(indexOf(s.seat), n, 26, 24)}
            >
              {formatChips(s.bet, dc)}
            </div>
          ) : null,
        )}

      {/* Dealer button */}
      {view.buttonSeat !== null && view.seats[view.buttonSeat - 1] && (
        <div
          className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[10px] font-black text-ink shadow"
          style={around(indexOf(view.buttonSeat), n, 32, 30, 16)}
          aria-label="Dealer button"
        >
          D
        </div>
      )}

      {/* Seats */}
      {view.seats.map((s, i) => {
        const number = i + 1;
        return (
          <div key={number} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={around(indexOf(number), n, 42, 41)}>
            <Seat
              seat={s}
              number={number}
              isYou={number === view.you.seat}
              toAct={hand?.toAct === number}
              countdown={hand?.toAct === number ? countdown : null}
              displayCents={dc}
              shown={shownBySeat.get(number)}
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
