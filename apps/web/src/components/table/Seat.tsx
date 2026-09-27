import type { SeatView } from "@garagepoker/protocol";
import { formatChips } from "@/lib/chips";
import { PlayingCard } from "./PlayingCard";

export function actionText(a: NonNullable<SeatView["lastAction"]>, displayCents: boolean): string {
  const amt = (n: number) => formatChips(n, displayCents);
  switch (a.type) {
    case "fold":
      return "Fold";
    case "check":
      return "Check";
    case "call":
      return `Call ${amt(a.amount)}`;
    case "bet":
      return `Bet ${amt(a.to ?? a.amount)}`;
    case "raise":
      return `Raise to ${amt(a.to ?? a.amount)}`;
    case "smallBlind":
      return "Small blind";
    case "bigBlind":
      return "Big blind";
    case "straddle":
      return "Straddle";
    case "post":
      return "Posted BB";
    case "ante":
      return "Ante";
    case "uncalled":
      return "Returned";
  }
}

export interface Countdown {
  /** 0..1 of the decision time (or time bank) left. */
  fraction: number;
  seconds: number;
  inBank: boolean;
}

export function Seat({
  seat,
  number,
  isYou,
  toAct,
  countdown,
  displayCents,
  shown,
  won,
  canSit,
  onSit,
}: {
  seat: SeatView | null;
  number: number;
  isYou: boolean;
  toAct: boolean;
  countdown: Countdown | null;
  displayCents: boolean;
  /** Cards and label shown at the last showdown, while the result is up. */
  shown?: { cards: string[]; label: string };
  won?: number;
  canSit: boolean;
  onSit: () => void;
}) {
  if (!seat) {
    return canSit ? (
      <button
        type="button"
        onClick={onSit}
        className="flex h-12 w-16 items-center justify-center rounded-xl border border-dashed border-gold/60 bg-black/30 text-xs font-semibold text-gold hover:bg-gold/10"
        aria-label={`Sit in seat ${number}`}
      >
        Sit
      </button>
    ) : (
      <div className="flex h-10 w-14 items-center justify-center rounded-xl border border-dashed border-white/10 text-[10px] text-white/30">
        {number}
      </div>
    );
  }

  const tags: string[] = [];
  if (!seat.connected) tags.push("Offline");
  if (seat.away) tags.push("Away");
  if (seat.waitingForBB) tags.push("Waiting for BB");
  if (seat.leaving) tags.push("Leaving");
  if (seat.allIn) tags.push("All in");

  const cards = shown?.cards ?? (seat.inHand && !seat.folded ? seat.cards : null);
  const dim = seat.folded || seat.away;

  return (
    <div className={`flex w-[88px] flex-col items-center ${dim ? "opacity-55" : ""}`}>
      <div className="-mb-2 flex h-8 items-end gap-0.5">
        {cards?.map((c, i) => <PlayingCard key={i} card={c} size="xs" />)}
      </div>
      <div
        className={`relative w-full overflow-hidden rounded-xl border px-1.5 pb-1.5 pt-1 text-center shadow-lg ${
          toAct ? "border-gold bg-panel-2 ring-2 ring-gold/60" : isYou ? "border-gold/40 bg-panel" : "border-line bg-panel"
        }`}
      >
        <div className="truncate text-xs font-semibold" title={seat.nickname}>
          {seat.isOwner && <span title="Table owner">★ </span>}
          {seat.nickname}
        </div>
        <div className="tabular text-sm font-bold text-gold">{formatChips(seat.stack, displayCents)}</div>
        {shown ? (
          <div className="truncate text-[10px] text-text">{shown.label}</div>
        ) : seat.lastAction && seat.inHand ? (
          <div className="truncate text-[10px] text-muted">{actionText(seat.lastAction, displayCents)}</div>
        ) : tags.length > 0 ? (
          <div className="truncate text-[10px] text-muted">{tags.join(" · ")}</div>
        ) : null}
        {won ? <div className="tabular text-[11px] font-bold text-ok">+{formatChips(won, displayCents)}</div> : null}
        {toAct && countdown && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40" aria-label={`${countdown.seconds} seconds left`}>
            <div
              className={`h-full transition-[width] duration-200 ${countdown.inBank ? "bg-danger" : "bg-gold"}`}
              style={{ width: `${Math.max(0, Math.min(1, countdown.fraction)) * 100}%` }}
            />
          </div>
        )}
      </div>
      {seat.inHand && tags.includes("All in") && !shown && (
        <span className="mt-0.5 rounded bg-danger px-1 text-[9px] font-bold uppercase">All in</span>
      )}
    </div>
  );
}
