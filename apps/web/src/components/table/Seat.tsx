import type { SeatView } from "@garagepoker/protocol";
import type { CSSProperties } from "react";
import { formatChips } from "@/lib/chips";

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
  /** Ms since the time bank started (0 before). */
  bankElapsed: number;
}

/** SPEC §7 tag colours by strength tier, from the high half of a label like "Flush / 8-6 low". */
export function tagColor(label: string): string {
  const l = label.split(" / ")[0]!.toLowerCase();
  if (/four of a kind|straight flush|royal/.test(l)) return "bg-[#dc2626] text-white";
  if (/straight|flush|full house/.test(l)) return "bg-[#7c3aed] text-white";
  if (/two pair|three of a kind/.test(l)) return "bg-[#0d9488] text-white";
  return "bg-[#475569] text-white";
}

/** Shorter names for opponents' tags on a phone: "Trips", "Quads"; no "no low". */
export function shortLabel(label: string): string {
  return label
    .replace(/three of a kind/i, "Trips")
    .replace(/four of a kind/i, "Quads")
    .replace(/straight flush/i, "Str. flush")
    .replace(/ \/ no low$/i, "");
}

/** "Flush / 8-6 low" → "FLUSH · 8-6 LOW" (uppercased by CSS). */
const tagText = (label: string) => label.replace(" / ", " · ");

/**
 * Hand-strength tags, one per board: "B1 PAIR" over "B2 TWO PAIR" with a
 * double board. Only ever given your own labels, or hands shown at showdown.
 */
export function HandTags({ labels, font, short = false }: { labels: string[]; font: number; short?: boolean }) {
  return (
    <div className="flex flex-col items-center" style={{ gap: font * 0.2 }} data-box="tags">
      {labels.map((raw, b) => {
        const label = short ? shortLabel(raw) : raw;
        return (
          <span
            key={b}
            className={`whitespace-nowrap rounded font-bold uppercase leading-none tracking-wide shadow-[0_1px_4px_rgba(0,0,0,.5)] ${tagColor(label)}`}
            style={{ fontSize: font, padding: `${font * 0.3}px ${font * 0.5}px` }}
          >
            {labels.length > 1 && <span className="opacity-75">B{b + 1} </span>}
            {tagText(label)}
          </span>
        );
      })}
    </div>
  );
}

/** Timer colour: green, then yellow, then red; purple in the time bank. */
function timerColor(c: Countdown): string {
  if (c.inBank) return "#a855f7";
  if (c.fraction > 0.5) return "#22c55e";
  if (c.fraction > 0.2) return "#eab308";
  return "#ef4444";
}

/**
 * A seat's name plate: name (★ owner) and stack. White with a glow while it's
 * their turn, with the timer along the bottom edge; a gold glow for winners.
 */
export function NamePlate({
  seat,
  w,
  h,
  nameFont,
  stackFont,
  displayCents,
  countdown,
  winner,
  net,
  dim,
  tag,
  bannerSide = "right",
  style,
}: {
  seat: SeatView;
  w: number;
  h: number;
  nameFont: number;
  stackFont: number;
  displayCents: boolean;
  /** Set while it's this seat's turn. */
  countdown: Countdown | null;
  winner: boolean;
  /** Net for the last hand (shown after it). */
  net: number | null;
  dim: boolean;
  /** A small uppercase tag on the top-right corner: "AWAY", "ALL IN", "CHECK"… */
  tag: { text: string; tone: "danger" | "muted" | "info" } | null;
  /** Which side of the plate the "EXTRA TIME" banner goes (towards the felt). */
  bannerSide?: "left" | "right";
  style?: CSSProperties;
}) {
  const active = !!countdown;
  // Narrow plates (full tables on a phone): the net goes on the top-left corner instead.
  const netCorner = w < 110;
  const netText = net !== null && net !== 0 ? `${net > 0 ? "+" : "−"}${formatChips(Math.abs(net), displayCents)}` : null;
  const extraTime = countdown?.inBank && countdown.bankElapsed < 2000;
  return (
    <div
      data-box="plate"
      data-seat={seat.seat}
      className={`absolute flex flex-col justify-center rounded-lg border ${
        active
          ? "border-white bg-white text-[#141414] shadow-[0_0_18px_4px_rgba(255,255,255,.45)]"
          : "border-white/10 bg-[#2b2b2b] text-white shadow-[0_2px_8px_rgba(0,0,0,.5)]"
      } ${winner && !active ? "winner-glow" : ""}`}
      style={{ width: w, height: h, padding: `0 ${Math.max(6, w * 0.07)}px`, opacity: dim ? 0.5 : 1, ...style }}
    >
      <div className="truncate font-medium leading-tight" style={{ fontSize: nameFont }} title={seat.nickname}>
        {seat.isOwner && <span aria-label="Table owner">★ </span>}
        {seat.nickname}
      </div>
      <div className="flex min-w-0 items-center gap-1 leading-tight">
        <span className="tabular shrink-0 font-semibold" style={{ fontSize: stackFont }}>
          {formatChips(seat.stack, displayCents)}
        </span>
        {netText && !netCorner && net !== null && (
          <span
            data-box="net"
            className={`tabular min-w-0 truncate font-bold ${net > 0 ? (active ? "text-[#15803d]" : "text-[#4ade80]") : active ? "text-[#b91c1c]" : "text-[#f87171]"}`}
            style={{ fontSize: Math.max(10, stackFont * 0.76) }}
          >
            {netText}
          </span>
        )}
      </div>
      {netText && netCorner && net !== null && (
        <span
          data-box="net"
          className={`tabular absolute whitespace-nowrap rounded px-1 font-bold leading-[1.4] shadow ${net > 0 ? "bg-[#16a34a] text-white" : "bg-[#dc2626] text-white"}`}
          style={{ fontSize: Math.max(9, nameFont * 0.8), left: -4, top: -Math.max(7, nameFont * 0.6) }}
        >
          {netText}
        </span>
      )}
      {tag && (
        <span
          className={`absolute whitespace-nowrap rounded px-1 font-bold uppercase leading-[1.4] tracking-wide shadow ${
            tag.tone === "danger" ? "bg-[#dc2626] text-white" : tag.tone === "info" ? "bg-[#e5e7eb] text-[#141414]" : "bg-[#52525b] text-white"
          }`}
          style={{ fontSize: Math.max(9, nameFont * 0.72), right: -4, top: -Math.max(7, nameFont * 0.55) }}
        >
          {tag.text}
        </span>
      )}
      {countdown && (
        <div className="absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-lg bg-black/15" aria-label={`${countdown.seconds} seconds left`}>
          <div
            className="h-full transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.max(0, Math.min(1, countdown.fraction)) * 100}%`, background: timerColor(countdown) }}
          />
        </div>
      )}
      {extraTime && (
        <span
          className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-[#a855f7] px-1.5 font-bold uppercase leading-[1.5] tracking-wide text-white shadow ${
            bannerSide === "right" ? "left-[calc(100%+6px)]" : "right-[calc(100%+6px)]"
          }`}
          style={{ fontSize: Math.max(9, nameFont * 0.72) }}
        >
          Extra time
        </span>
      )}
    </div>
  );
}

/** This street's bet, on the felt between the player and the pot. */
export function BetChip({ amount, displayCents, h, font, style }: { amount: number; displayCents: boolean; h: number; font: number; style?: CSSProperties }) {
  return (
    <span
      data-box="bet"
      className="tabular absolute flex items-center whitespace-nowrap rounded-full bg-[#d9f99d] font-semibold text-[#1a2e05] shadow-[0_2px_6px_rgba(0,0,0,.45)]"
      style={{ height: h, fontSize: font, padding: `0 ${h * 0.4}px`, ...style }}
    >
      {formatChips(amount, displayCents)}
    </span>
  );
}

export function DealerButton({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <span
      data-box="dealer"
      aria-label="Dealer button"
      className="absolute flex items-center justify-center rounded-full bg-white font-black text-[#141414] shadow-[0_1px_4px_rgba(0,0,0,.6)]"
      style={{ width: size, height: size, fontSize: size * 0.5, ...style }}
    >
      D
    </span>
  );
}

/** An empty seat, for people without one: a dashed "Sit" circle. */
export function SitButton({ number, size, onSit, style }: { number: number; size: number; onSit: () => void; style?: CSSProperties }) {
  return (
    <button
      type="button"
      onClick={onSit}
      data-box="sit"
      aria-label={`Sit in seat ${number}`}
      className="absolute flex items-center justify-center rounded-full border-2 border-dashed border-gold/70 bg-black/35 font-semibold text-gold hover:bg-gold/10"
      style={{ width: size, height: size, fontSize: Math.max(12, size * 0.26), ...style }}
    >
      Sit
    </button>
  );
}
