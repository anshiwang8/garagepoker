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
};

export type CardSize = keyof typeof SIZES;

/** A card from the server: "As", or null for a face-down card. */
export function PlayingCard({ card, size = "md", dim = false }: { card: string | null; size?: CardSize; dim?: boolean }) {
  if (!card) {
    return (
      <div
        aria-label="Face-down card"
        className={`${SIZES[size]} shrink-0 border border-white/20 bg-[repeating-linear-gradient(45deg,#7a2530_0_4px,#5c1a24_4px_8px)] shadow`}
      />
    );
  }
  const rank = card[0] === "T" ? "10" : card[0]!;
  const suit = SUITS[card[1]!]!;
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
