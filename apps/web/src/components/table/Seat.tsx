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
    case "ritAccept":
      return "Run it twice: yes";
    case "ritDecline":
      return "Run it twice: no";
    case "discard":
      return "Discarded";
  }
}

export interface Countdown {
  /** 0..1 of the decision time (or time bank) left. */
  fraction: number;
  seconds: number;
  inBank: boolean;
}


/** Tag colour by hand strength, from the label text (e.g. "Top pair", "Flush / 8-6 low"). */
function tagClass(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("low")) return "bg-sky-700 text-white";
  if (l.includes("straight flush") || l.includes("royal")) return "bg-gold text-ink";
  if (l.includes("four of a kind")) return "bg-rose-600 text-white";
  if (l.includes("full house")) return "bg-fuchsia-600 text-white";
  if (l.includes("flush")) return "bg-emerald-600 text-white";
  if (l.includes("straight")) return "bg-orange-500 text-white";
  if (l.includes("three of a kind")) return "bg-violet-600 text-white";
  if (l.includes("two pair")) return "bg-teal-600 text-white";
  if (l.includes("pair")) return "bg-blue-600 text-white";
  return "bg-zinc-600 text-white";
}

/**
 * Hand-strength tags: one row per board, and in Hi/Lo a tag per half
 * ("FLUSH" + "8-6 LOW"). Only ever passed for your own seat, or for hands
 * shown at showdown.
 */
function HandTags({ labels }: { labels: string[] }) {
  return (
    <div className="mt-1 flex flex-col items-center gap-0.5">
      {labels.map((label, b) => (
        <div key={b} className="flex items-center gap-0.5">
          {labels.length > 1 && <span className="text-[8px] font-bold text-muted">B{b + 1}</span>}
          {label.split(" / ").map((half) => (
            <span
              key={half}
              className={`whitespace-nowrap rounded px-1 py-px text-[9px] font-bold uppercase leading-tight tracking-wide ${tagClass(half)}`}
            >
              {half}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Cards overlapping, like a hand held in real life; Omaha fans 4-5 cards. */
function HeldCards({ cards, big, dim }: { cards: (string | null)[]; big: boolean; dim: boolean }) {
  const n = cards.length;
  const fan = n > 2;
  // How far each card slides under the previous one.
  const overlap = big
    ? fan ? "-ml-9 wide:-ml-7" : "-ml-6 wide:-ml-4"
    : fan ? "-ml-8 wide:-ml-6" : "-ml-5 wide:-ml-4";
  // Rotated cards stick out past their layout box: pad a fan so it never covers
  // the name panel or runs off the screen edge.
  return (
    <div className={`flex items-end pt-1 ${fan ? "px-2.5" : "pl-1"}`}>
      {cards.map((c, i) => (
        <div
          key={i}
          className={i === 0 ? "" : overlap}
          style={fan ? { transform: `rotate(${(i - (n - 1) / 2) * 6}deg)`, transformOrigin: "50% 120%" } : undefined}
        >
          <PlayingCard card={c} size={big ? "seatYou" : "seat"} corner dim={dim} />
        </div>
      ))}
    </div>
  );
}

export function Seat({
  seat,
  number,
  isYou,
  isButton,
  toAct,
  countdown,
  displayCents,
  labels,
  shown,
  won,
  canSit,
  onSit,
}: {
  seat: SeatView | null;
  number: number;
  isYou: boolean;
  isButton: boolean;
  toAct: boolean;
  countdown: Countdown | null;
  displayCents: boolean;
  /** Your own hand-strength labels (one per board); never someone else's. */
  labels: string[] | null;
  /** Cards and labels shown at the last showdown, while the result is up. */
  shown?: { cards: string[]; labels: string[] };
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

  const cards = shown?.cards ?? (seat.inHand && (!seat.folded || isYou) ? seat.cards : null);
  const tagLabels = shown?.labels ?? (isYou && seat.inHand && !seat.folded ? labels : null);

  return (
    <div className={`flex flex-col items-center ${seat.away ? "opacity-55" : ""}`} data-seat={number}>
      {/* Dealer button above the seat that has it (and, on phones, your bet). */}
      <div className="flex h-5 items-end gap-1">
        {isYou && seat.bet > 0 && <BetChip amount={seat.bet} displayCents={displayCents} />}
        {isButton && (
          <span
            className="mb-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[9px] font-black text-ink shadow"
            aria-label="Dealer button"
          >
            D
          </span>
        )}
      </div>
      {/* Phones: other seats put the name panel under the cards so they stay narrow
          and clear of the board; your seat, and every seat in landscape, has it beside. */}
      <div
        className={`relative flex gap-1.5 rounded-xl border px-1 pb-1.5 pt-0.5 shadow-lg ${
          isYou ? "flex-row items-start" : "flex-col items-center wide:flex-row wide:items-start"
        } ${
          toAct && isYou ? "turn-glow border-gold bg-panel-2" : toAct ? "border-gold bg-panel-2 ring-2 ring-gold/60" : isYou ? "border-gold/50 bg-panel/95" : "border-line bg-panel/95"
        }`}
      >
        {cards && (
          <div className="flex flex-col items-center">
            <HeldCards cards={cards} big={isYou} dim={seat.folded && !shown} />
            {tagLabels && tagLabels.length > 0 && <HandTags labels={tagLabels} />}
          </div>
        )}
        <div
          className={`flex min-w-[3.75rem] max-w-[6.5rem] flex-col ${cards ? "py-1" : "px-1 py-1 text-center"} ${
            isYou ? "" : "-mt-1 items-center text-center wide:mt-0 wide:items-start wide:text-left"
          }`}
        >
          <div className="truncate text-xs font-semibold" title={seat.nickname}>
            {seat.isOwner && <span title="Table owner">★ </span>}
            {seat.nickname}
          </div>
          <div className="tabular text-sm font-bold text-gold">{formatChips(seat.stack, displayCents)}</div>
          {seat.allIn && !shown ? (
            <span className="self-start rounded bg-danger px-1 text-[9px] font-bold uppercase text-white">All in</span>
          ) : seat.folded && seat.inHand && !shown ? (
            <div className="text-[10px] text-muted">Folded</div>
          ) : seat.lastAction && seat.inHand && !shown ? (
            <div className="truncate text-[10px] text-muted">{actionText(seat.lastAction, displayCents)}</div>
          ) : tags.length > 0 ? (
            <div className="truncate text-[10px] text-muted">{tags.join(" · ")}</div>
          ) : null}
          {won ? <div className="tabular text-[11px] font-bold text-ok">+{formatChips(won, displayCents)}</div> : null}
        </div>
        {toAct && countdown && (
          <div className="absolute inset-x-1 bottom-0.5 h-1 overflow-hidden rounded bg-black/40" aria-label={`${countdown.seconds} seconds left`}>
            <div
              className={`h-full transition-[width] duration-200 ${countdown.inBank ? "bg-danger" : "bg-gold"}`}
              style={{ width: `${Math.max(0, Math.min(1, countdown.fraction)) * 100}%` }}
            />
          </div>
        )}
      </div>
      {/* Phones: the bet sits with the seat (there's no room between a side seat and the board). */}
      {!isYou && seat.bet > 0 && (
        <div className="mt-0.5">
          <BetChip amount={seat.bet} displayCents={displayCents} />
        </div>
      )}
    </div>
  );
}

/** The current bet as a chip; only on phones (landscape shows bets on the felt). */
function BetChip({ amount, displayCents }: { amount: number; displayCents: boolean }) {
  return (
    <span className="rounded-full bg-black/60 px-1.5 py-px text-[11px] font-semibold tabular text-gold wide:hidden">
      {formatChips(amount, displayCents)}
    </span>
  );
}
