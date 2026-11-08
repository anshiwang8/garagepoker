"use client";

import { redRiverApplies, type TableSettings, VARIANTS, type VariantName } from "@garagepoker/engine";
import type { TableView } from "@garagepoker/protocol";
import { formatChips } from "@/lib/chips";
import { type Prefs, setPrefs, usePrefs } from "@/lib/prefs";
import { Modal, Toggle } from "../ui";
import { VARIANT_LABELS } from "../SettingsForm";

/** Rules for each game, in a few plain sentences. */
const VARIANT_RULES: Record<VariantName, string[]> = {
  NLH: ["You get 2 cards. Five cards are shared on the board.", "Make your best 5-card hand from any of your 2 cards and the 5 on the board."],
  PLO: ["You get 4 cards.", "Your hand must use exactly 2 of your cards and exactly 3 from the board: four hearts in your hand plus one on the board is not a flush."],
  PLO5: ["Like Pot-limit Omaha with 5 cards: still exactly 2 of yours and 3 from the board."],
  PLOHL: [
    "Omaha with a split pot: the best high hand takes half, the best low hand the other half.",
    "A low is five different cards, 8 or lower (aces count low). If nobody has one, the high hand takes it all.",
  ],
  PLO5HL: ["5-card Omaha with the high/low split: exactly 2 of yours and 3 from the board for each half."],
  PINEAPPLE: ["You get 5 cards and discard one face down before the betting on the preflop, flop and turn, so you hold 2 on the river.", "Best 5 cards from your 2 and the board."],
  SHORT: ["The deck has 36 cards (6 to ace).", "A flush beats a full house, three of a kind beats a straight, and A-6-7-8-9 is the lowest straight."],
  TICTACTOE: [
    "You get 2 cards; the board is a 3×3 grid. The flop is the 4 corners, the turn the middle row, the river the top and bottom middle.",
    "Your hand is both of your cards plus the 3 cards of one row, column or diagonal.",
  ],
};

const RANKINGS: [string, string][] = [
  ["Royal flush", "A K Q J 10, all one suit"],
  ["Straight flush", "Five in a row, all one suit"],
  ["Four of a kind", "Four cards of one rank"],
  ["Full house", "Three of a kind plus a pair"],
  ["Flush", "Five cards of one suit"],
  ["Straight", "Five ranks in a row (A-2-3-4-5 counts)"],
  ["Three of a kind", "Three cards of one rank"],
  ["Two pair", "Two different pairs"],
  ["Pair", "Two cards of one rank"],
  ["High card", "None of the above: highest card plays"],
];

const ACTIONS: [string, string][] = [
  ["Check", "Stay in without adding chips. Only when there's no bet to match."],
  ["Bet", "Put chips in when nobody has yet; others must match it to stay in."],
  ["Call", "Match the current bet."],
  ["Raise", "Bet more than the current bet. The minimum raise is the size of the last raise."],
  ["Fold", "Give up the hand and any chips you've put in."],
  ["All in", "Put in all your chips. You can only win what you matched from each player; the rest goes to side pots."],
];

/** Plain-language lines for the table options that are switched on. */
export function extraRules(s: TableSettings): string[] {
  return [
    s.boards === 2 && "Two boards: each board takes half of every pot.",
    s.bombPotMode !== "off" && "Bomb pots: everyone antes and there's no betting before the flop.",
    s.runItTwice !== "no" && "Run it twice: when everyone left is all in, the rest of the board can be dealt twice, each run taking half the pot.",
    s.straddle && "UTG straddle: the player after the big blind posts 2 big blinds before the cards are dealt.",
    s.redRiver &&
      redRiverApplies(s.variant) &&
      "Red river: if the river card is red (hearts or diamonds), another card is dealt with a new betting round, and again while it stays red. Each board is dealt on its own.",
  ].filter(Boolean) as string[];
}

/** "How to play": this table's game, hand rankings, actions and betting limits. Nothing about anyone's cards. */
export function HowToPlayDialog({ view, onClose }: { view: TableView; onClose: () => void }) {
  const v = view.settings.variant;
  const variant = VARIANTS[v];
  const potLimit = variant.betting === "PL";
  const prefs = usePrefs();
  const s = view.settings;
  const extras = extraRules(s);
  return (
    <Modal title="How to play" onClose={onClose} wide>
      <div className="flex flex-col gap-5 text-sm">
        <section>
          <h3 className="mb-1 font-semibold text-gold">This table: {VARIANT_LABELS[v].name}</h3>
          <ul className="list-disc space-y-1 pl-5">
            {VARIANT_RULES[v].map((r) => (
              <li key={r}>{r}</li>
            ))}
            <li>
              {potLimit
                ? "Pot limit: the most you can raise to is the size of the pot after you call."
                : "No limit: you can bet or raise any amount up to all your chips."}
            </li>
            {extras.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-1 font-semibold">Hand rankings, best first</h3>
          {v === "SHORT" && <p className="mb-1 text-xs text-muted">Short deck: flush ranks above full house, three of a kind above straight.</p>}
          <ol className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {RANKINGS.map(([name, what], i) => (
              <li key={name} className="flex gap-2">
                <span className="tabular w-5 shrink-0 text-muted">{i + 1}.</span>
                <span>
                  <span className="font-semibold">{name}</span> <span className="text-muted">· {what}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="mb-1 font-semibold">Actions</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {ACTIONS.map(([k, d]) => (
              <div key={k} className="contents">
                <dt className="font-semibold">{k}</dt>
                <dd className="text-muted">{d}</dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="rounded-xl border border-line bg-ink px-3">
          <Toggle
            label="Learn mode hints"
            checked={prefs.learn}
            onChange={(learn) => setPrefs({ learn })}
            hint="A line above your buttons saying what you can do, on your turn. Only on this device."
          />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Learn mode: what you can do now, in words, from your own legal actions
 * (nothing anyone else can't already see on the table).
 */
export function turnHint(view: TableView): string | null {
  const legal = view.you.legal;
  if (!legal) return null;
  const dc = view.settings.displayCents;
  const pl = VARIANTS[view.settings.variant].betting === "PL";
  const parts = [
    legal.canCheck ? "No bet to match: check to stay in for free" : `Call ${formatChips(legal.callAmount, dc)} to stay in`,
    legal.canRaise
      ? `${view.hand?.currentBet === 0 ? "bet" : "raise"} to between ${formatChips(legal.minRaiseTo, dc)} and ${formatChips(legal.maxRaiseTo, dc)}${pl ? " (pot limit)" : ""}`
      : null,
    legal.canCheck ? null : "or fold",
  ].filter(Boolean);
  return `${parts.join(", ")}.`;
}

const FELTS: { id: Prefs["felt"]; label: string; color: string }[] = [
  { id: "green", label: "Green", color: "#1e7d4d" },
  { id: "blue", label: "Blue", color: "#1f5f91" },
  { id: "burgundy", label: "Burgundy", color: "#7a2b39" },
  { id: "charcoal", label: "Charcoal", color: "#3c4442" },
];
const BACKS: { id: Prefs["back"]; label: string; color: string }[] = [
  { id: "red", label: "GP red", color: "#a3202f" },
  { id: "navy", label: "GP navy", color: "#23408a" },
  { id: "black", label: "GP black", color: "#3a3a3a" },
];

/** Table look, for this browser only: felt, card backs, card readability, motion. */
export function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const p = usePrefs();
  return (
    <Modal title="Appearance" onClose={onClose}>
      <div className="flex flex-col gap-5">
        <Swatches title="Felt" value={p.felt} options={FELTS} onPick={(felt) => setPrefs({ felt })} />
        <Swatches title="Card back" value={p.back} options={BACKS} onPick={(back) => setPrefs({ back })} />
        <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-ink px-3">
          <Toggle
            label="Four-colour deck"
            checked={p.deck === "four"}
            onChange={(on) => setPrefs({ deck: on ? "four" : "two" })}
            hint="Diamonds blue and clubs green: easier to tell apart on a phone"
          />
          <Toggle
            label="Large card corners"
            checked={p.cardSize === "large"}
            onChange={(on) => setPrefs({ cardSize: on ? "large" : "standard" })}
            hint="Bigger rank and suit in the corner of each card"
          />
          <Toggle
            label="Reduce motion"
            checked={p.motion === "reduced"}
            onChange={(on) => setPrefs({ motion: on ? "reduced" : "system" })}
            hint="No dealing or sliding animations (also follows your system setting)"
          />
          <Toggle label="Learn mode hints" checked={p.learn} onChange={(learn) => setPrefs({ learn })} hint="Say what you can do on your turn" />
        </div>
        <p className="text-xs text-muted">Saved on this device only. Other players see their own choices.</p>
      </div>
    </Modal>
  );
}

function Swatches<T extends string>({
  title,
  value,
  options,
  onPick,
}: {
  title: string;
  value: T;
  options: { id: T; label: string; color: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{title}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onPick(o.id)}
            className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm ${value === o.id ? "border-gold bg-gold/15 font-semibold" : "border-line bg-ink"}`}
          >
            <span aria-hidden className="h-5 w-5 rounded-full border border-white/30" style={{ background: o.color }} />
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
