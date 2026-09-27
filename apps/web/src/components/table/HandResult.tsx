import type { LastHandView, SliceView, TableView } from "@garagepoker/protocol";
import { formatChips } from "@/lib/chips";

/** Total won per seat in the last hand, across every pot slice. */
export function wonBySeat(last: LastHandView): Map<number, number> {
  const won = new Map<number, number>();
  for (const pot of last.pots) {
    for (const slice of pot.slices) {
      for (const w of slice.winners) won.set(w.seat, (won.get(w.seat) ?? 0) + w.amount);
    }
  }
  return won;
}

/** "Board 1 high", "Low", "Board 2 (no low)", or "" for a single-board high-only pot. */
function sliceName(slice: SliceView, last: LastHandView, lowOnBoard: boolean): string {
  const parts: string[] = [];
  if (last.boards.length > 1) parts.push(`Board ${slice.board! + 1}`);
  if (last.hiLo) parts.push(slice.half === "low" ? "low" : lowOnBoard ? "high" : "high (no low)");
  const name = parts.join(" ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The high or low part of a Hi/Lo label like "Flush / 8-6 low". */
function handFor(label: string | undefined, half: SliceView["half"]): string | undefined {
  if (!label) return undefined;
  const [high, low] = label.split(" / ");
  return half === "low" ? low : high;
}

/**
 * Who won which slice of which pot: "Main pot · Board 1 high · Alice 78 ·
 * Three of a kind". Everything shown comes from the server's last-hand result.
 */
export function HandResult({ view }: { view: TableView }) {
  const last = view.lastHand;
  if (!last) return null;
  const dc = view.settings.displayCents;
  const name = (seat: number) => last.shown.find((s) => s.seat === seat)?.nickname ?? view.seats[seat - 1]?.nickname ?? `Seat ${seat}`;
  const labelOf = (seat: number, board: number) => last.shown.find((s) => s.seat === seat)?.labels[board];

  return (
    <div className="max-h-44 overflow-y-auto rounded-xl border border-line bg-ink px-3 py-2 text-sm wide:max-h-none" aria-label="Hand result">
      <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-muted">
        <span>
          Hand {last.number} result{last.bombPot ? " · bomb pot" : ""}
        </span>
      </div>
      {last.pots.map((pot, i) => (
        <div key={i} className="py-1">
          {last.pots.length > 1 && (
            <div className="text-xs font-semibold text-muted">
              {i === 0 ? "Main pot" : last.pots.length > 2 ? `Side pot ${i}` : "Side pot"} · <span className="tabular">{formatChips(pot.amount, dc)}</span>
            </div>
          )}
          <ul>
            {pot.slices.map((slice, j) => {
              const lowOnBoard = pot.slices.some((s) => s.board === slice.board && s.half === "low");
              const title = slice.board === null ? "" : sliceName(slice, last, lowOnBoard);
              return (
                <li key={j} className="flex flex-wrap items-baseline gap-x-2 border-b border-line/40 py-1 last:border-0">
                  {title && <span className="w-full text-xs text-muted sm:w-32">{title}</span>}
                  <span className="flex-1">
                    {slice.winners.map((w, k) => {
                      const hand = slice.board === null ? undefined : handFor(labelOf(w.seat, slice.board), slice.half);
                      return (
                        <span key={w.seat}>
                          {k > 0 && ", "}
                          <span className="font-semibold">{name(w.seat)}</span>{" "}
                          <span className="tabular text-gold">{formatChips(w.amount, dc)}</span>
                          {hand && <span className="text-muted"> · {hand}</span>}
                        </span>
                      );
                    })}
                    {slice.board === null && <span className="text-muted"> · uncontested</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
