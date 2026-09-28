const SUITS: Record<string, { symbol: string; color: string }> = {
  s: { symbol: "♠", color: "text-spade" },
  h: { symbol: "♥", color: "text-heart" },
  d: { symbol: "♦", color: "text-diamond" },
  c: { symbol: "♣", color: "text-club" },
};

const SIZES = {
  xs: "h-8 w-6 text-[11px] rounded",
  sm: "h-11 w-8 text-sm rounded-md",
  md: "h-14 w-10 text-base rounded-md",
  lg: "h-20 w-14 text-2xl rounded-lg",
  /** Other players' seats: large on phones, smaller in the landscape layout. */
  seat: "h-16 w-11 text-xl rounded-md wide:h-11 wide:w-8 wide:text-sm",
  /** Other players' 4-5 card fans: a little smaller on phones so a full table fits. */
  seatFan: "h-14 w-10 text-lg rounded-md wide:h-11 wide:w-8 wide:text-sm",
  /** Your own seat: bigger still. */
  seatYou: "h-[5.5rem] w-16 text-2xl rounded-lg wide:h-14 wide:w-10 wide:text-base",
};

export type CardSize = keyof typeof SIZES;

/**
 * A card from the server: "As", or null for a face-down card. `corner` puts
 * the rank and suit in the top-left corner, so cards stay readable when they
 * overlap at a seat. Dimmed (folded) corner cards darken but stay opaque, so the
 * card underneath never shows through.
 */
export function PlayingCard({
  card,
  size = "md",
  dim = false,
  corner = false,
}: {
  card: string | null;
  size?: CardSize;
  dim?: boolean;
  corner?: boolean;
}) {
  if (!card) {
    return (
      <div
        aria-label="Face-down card"
        className={`${SIZES[size]} shrink-0 border border-white/25 bg-[repeating-linear-gradient(45deg,#7a2530_0_4px,#5c1a24_4px_8px)] shadow-md`}
      />
    );
  }
  const rank = card[0] === "T" ? "10" : card[0]!;
  const suit = SUITS[card[1]!]!;
  if (corner) {
    return (
      <div
        aria-label={card}
        className={`${SIZES[size]} ${suit.color} ${dim ? "brightness-50 grayscale" : ""} relative shrink-0 border border-black/10 bg-white font-bold leading-none shadow-md`}
      >
        <span className="absolute left-[0.18em] top-[0.12em] flex flex-col items-center leading-[0.95]">
          <span className="tracking-tighter">{rank}</span>
          <span>{suit.symbol}</span>
        </span>
        <span className="absolute bottom-[0.1em] right-[0.15em] text-[1.3em] leading-none opacity-80">{suit.symbol}</span>
      </div>
    );
  }
  return (
    <div
      aria-label={card}
      className={`${SIZES[size]} ${suit.color} ${dim ? "opacity-40" : ""} flex shrink-0 flex-col items-center justify-center bg-white font-bold leading-none shadow`}
    >
      <span className="tracking-tighter">{rank}</span>
      <span>{suit.symbol}</span>
    </div>
  );
}

export function CardSlot({ size = "md" }: { size?: CardSize }) {
  return <div className={`${SIZES[size]} shrink-0 border border-dashed border-white/15`} />;
}
