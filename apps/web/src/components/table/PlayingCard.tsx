import type { CSSProperties } from "react";

export const SUITS: Record<string, { symbol: string; color: string }> = {
  s: { symbol: "♠", color: "var(--color-spade)" },
  h: { symbol: "♥", color: "var(--color-heart)" },
  d: { symbol: "♦", color: "var(--color-diamond)" },
  c: { symbol: "♣", color: "var(--color-club)" },
};

/** "Kh" → "K", "Tc" → "10". */
export const rankText = (card: string) => (card[0] === "T" ? "10" : card[0]!);
const RANK_ORDER = "23456789TJQKA";
/** High to low: a stable order for cards shown after a hand. */
export const byRank = (a: string, b: string) => RANK_ORDER.indexOf(b[0]!) - RANK_ORDER.indexOf(a[0]!) || a[1]!.localeCompare(b[1]!);

/** "Kh" → "K♥". */
export const prettyCard = (card: string) => `${rankText(card)}${SUITS[card[1]!]!.symbol}`;

/**
 * GaragePoker's own card back: deep red, a thin light border and a faint
 * repeating GP monogram.
 */
const GP_PATTERN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18'%3E%3Ctext x='9' y='12' text-anchor='middle' font-family='Arial,sans-serif' font-weight='800' font-size='8' fill='%23ffffff' fill-opacity='0.08'%3EGP%3C/text%3E%3C/svg%3E\")";

export function CardBack({ w, h, style }: { w: number; h: number; style?: CSSProperties }) {
  const r = Math.max(3, w * 0.1);
  return (
    <div
      aria-label="Face-down card"
      className="card-back relative shrink-0"
      style={{ width: w, height: h, borderRadius: r, ...style }}
    >
      <div
        className="absolute rounded-[inherit] border border-white/35"
        style={{ inset: Math.max(2, w * 0.07), backgroundImage: GP_PATTERN, backgroundSize: `${Math.max(10, w * 0.36)}px` }}
      />
    </div>
  );
}

/**
 * A face-up card: rank and suit in the top-left corner (readable when cards
 * overlap), and a large suit in the lower right. `card` null is a card back.
 */
export function PlayingCard({
  card,
  w,
  h,
  dim = false,
  style,
}: {
  card: string | null;
  w: number;
  h: number;
  dim?: boolean;
  style?: CSSProperties;
}) {
  if (!card) return <CardBack w={w} h={h} style={style} />;
  const suit = SUITS[card[1]!]!;
  const rank = rankText(card);
  const r = Math.max(3, w * 0.1);
  return (
    <div
      aria-label={card}
      className={`relative shrink-0 card-face overflow-hidden font-bold leading-none ${dim ? "brightness-[.55]" : ""}`}
      style={{ width: w, height: h, borderRadius: r, color: suit.color, ...style }}
    >
      <span
        className="absolute flex flex-col items-center"
        style={{ left: w * 0.07, top: w * 0.06, fontSize: w * (rank.length > 1 ? 0.36 : 0.42), lineHeight: 0.95 }}
      >
        <span className={rank.length > 1 ? "tracking-[-0.08em]" : ""}>{rank}</span>
        <span style={{ fontSize: w * 0.36 }}>{suit.symbol}</span>
      </span>
      <span className="absolute leading-none" style={{ right: w * 0.06, bottom: w * 0.02, fontSize: w * 0.62 }}>
        {suit.symbol}
      </span>
    </div>
  );
}

/**
 * How a seat's cards are dealt: from (x, y), relative to the fan's top left,
 * one card per player per round, starting with the seat `slot` places left of
 * the button's left.
 */
export type Deal = { x: number; y: number; slot: number; players: number; gap: number };

/**
 * Cards held at a seat: overlapping and fanned about their bottom centre.
 * `step` is how far each card sits right of the previous one. With `deal`,
 * the cards fly in from the dealer when they mount.
 */
export function CardFan({
  cards,
  w,
  h,
  step,
  spread,
  dim = false,
  deal,
}: {
  cards: (string | null)[];
  w: number;
  h: number;
  step: number;
  /** Degrees between neighbouring cards. */
  spread: number;
  dim?: boolean;
  deal?: Deal | null;
}) {
  const n = cards.length;
  const width = w + step * Math.max(0, n - 1);
  return (
    <div className="relative" style={{ width, height: h }}>
      {cards.map((c, i) => (
        <div
          key={i}
          className={deal ? "deal-in" : undefined}
          style={{
            position: "absolute",
            left: i * step,
            top: 0,
            width: w,
            height: h,
            ...(deal && {
              "--deal-dx": `${deal.x - (i * step + w / 2)}px`,
              "--deal-dy": `${deal.y - h / 2}px`,
              animationDelay: `${(i * deal.players + deal.slot) * deal.gap}ms`,
            }),
          }}
        >
          <PlayingCard
            card={c}
            w={w}
            h={h}
            dim={dim}
            style={{ transform: `rotate(${(i - (n - 1) / 2) * spread}deg)`, transformOrigin: "50% 100%" }}
          />
        </div>
      ))}
    </div>
  );
}
