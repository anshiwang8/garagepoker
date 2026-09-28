"use client";

import type { ClientMessage, SeatView, TableView } from "@garagepoker/protocol";
import { useState } from "react";
import { raisePresets, VARIANTS } from "@garagepoker/engine";
import { chipsToInput, formatChips } from "@/lib/chips";
import { Button, ChipInput } from "../ui";
import { HandResult } from "./HandResult";
import type { Countdown } from "./Seat";

type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

/**
 * The action float (SPEC §7): Fold / Check-Call / Raise with your decision
 * timer when it's your turn, otherwise one compact status pill. On phones it
 * spans the bottom of the screen; in landscape it floats over the bottom-right
 * corner of the table.
 */
export function ActionBar({
  view,
  send,
  countdown,
  seenCommitment,
}: {
  view: TableView;
  send: Send;
  countdown: Countdown | null;
  seenCommitment?: string;
}) {
  const [raising, setRaising] = useState(false);
  const [details, setDetails] = useState(false);
  const legal = view.you.legal;
  const hand = view.hand;
  const dc = view.settings.displayCents;

  if (!hand || !legal) {
    const lastShown = !hand && view.lastHand && view.lastHand.number === view.handNumber;
    const text = hand ? waitingText(view) : lastShown ? "Hand over" : null;
    if (!text) return null;
    return (
      <div className="flex min-h-[4.375rem] items-center justify-center wide:min-h-0 wide:justify-end">
        {lastShown && details && (
          <div className="absolute inset-x-0 bottom-full z-40 max-h-[60vh] overflow-y-auto border-t border-line bg-panel p-2 shadow-2xl rounded-t-2xl wide:mb-2 wide:rounded-2xl wide:border">
            <HandResult view={view} send={send} seenCommitment={seenCommitment} />
          </div>
        )}
        <div className="flex items-center gap-2 rounded-full border border-line bg-panel/95 px-4 py-2 text-sm shadow-lg" role="status">
          <span className="text-text/85">{text}</span>
          {lastShown && (
            <button type="button" className="font-semibold text-gold hover:underline" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              {details ? "Hide" : "Details"}
            </button>
          )}
        </div>
      </div>
    );
  }

  const act = (action: Extract<ClientMessage, { type: "act" }>["action"]) => {
    setRaising(false);
    send({ type: "act", hand: view.handNumber, action });
  };
  const me = view.seats[view.you.seat! - 1]!;
  const callAllIn = legal.callAmount > 0 && legal.callAmount >= me.stack;
  const isBet = hand.currentBet === 0;
  const big = "min-h-12 flex-1 px-2 text-base font-bold wide:min-h-14 wide:text-lg";

  return (
    // Phones: the raise sheet anchors to the full-width float; landscape: to this card.
    <div className="wide:relative wide:rounded-2xl wide:border wide:border-gold/60 wide:bg-panel/95 wide:p-2.5 wide:shadow-2xl">
      {raising && legal.canRaise && (
        <RaisePopup view={view} onCancel={() => setRaising(false)} onRaise={(to) => act({ type: "raise", to })} />
      )}
      <div className="mb-1.5 flex h-4 items-center gap-2" aria-label={countdown ? `${countdown.seconds} seconds left` : "Your turn"}>
        <span className="text-xs font-bold uppercase tracking-wide text-gold">Your turn</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded bg-black/40">
          {countdown && (
            <div
              className={`h-full transition-[width] duration-200 ${countdown.inBank ? "bg-danger" : "bg-gold"}`}
              style={{ width: `${Math.max(0, Math.min(1, countdown.fraction)) * 100}%` }}
            />
          )}
        </div>
        {countdown && (
          <span className={`w-16 text-right text-xs tabular ${countdown.inBank ? "text-danger" : "text-muted"}`}>
            {countdown.inBank ? "Bank " : ""}
            {countdown.seconds}s
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        <Button variant="danger" className={big} onClick={() => act({ type: "fold" })}>
          Fold
        </Button>
        {legal.canCheck ? (
          <Button className={big} onClick={() => act({ type: "check" })}>
            Check
          </Button>
        ) : (
          <Button className={big} onClick={() => act({ type: "call" })}>
            {callAllIn ? "All in" : "Call"} <span className="tabular">{formatChips(legal.callAmount, dc)}</span>
          </Button>
        )}
        <Button variant="primary" className={big} disabled={!legal.canRaise} onClick={() => setRaising((r) => !r)} aria-expanded={raising}>
          {isBet ? "Bet" : "Raise"}
        </Button>
      </div>
    </div>
  );
}

/** Who the hand is waiting on, or how many players act before you. */
function waitingText(view: TableView): string | null {
  const hand = view.hand!;
  // Run-it-twice and discard prompts say who they're waiting for themselves.
  if (!hand.toAct || hand.ritOffer || hand.discard) return null;
  const name = view.seats[hand.toAct - 1]?.nickname ?? `Seat ${hand.toAct}`;
  const me = view.you.seat !== null ? view.seats[view.you.seat - 1] : null;
  const canAct = (s: SeatView | null | undefined) => !!s && s.inHand && !s.folded && !s.allIn;
  if (!me || !canAct(me)) return `Waiting for ${name}…`;
  // You still owe an action this street if you haven't acted voluntarily or are behind the bet.
  const forced = ["smallBlind", "bigBlind", "straddle", "post", "ante"];
  const owes = !me.lastAction || forced.includes(me.lastAction.type) || me.bet < hand.currentBet;
  if (!owes) return `Waiting for ${name}…`;
  const n = view.seats.length;
  let before = 0;
  for (let i = 0; i < n; i++) {
    const seat = ((hand.toAct - 1 + i) % n) + 1;
    if (seat === me.seat) break;
    if (canAct(view.seats[seat - 1])) before++;
  }
  return before >= 2 ? `Your turn in ${before}` : `Waiting for ${name}…`;
}

function RaisePopup({ view, onRaise, onCancel }: { view: TableView; onRaise: (to: number) => void; onCancel: () => void }) {
  const legal = view.you.legal!;
  const hand = view.hand!;
  const dc = view.settings.displayCents;
  const me = view.seats[view.you.seat! - 1]!;
  const min = legal.minRaiseTo;
  const max = legal.maxRaiseTo;
  const allInTo = me.bet + me.stack;
  // SPEC §7: big-blind multiples preflop until someone raises, pot fractions
  // after that and postflop; capped at the pot in pot-limit (engine raisePresets).
  const unopened = hand.street === "preflop" && !view.seats.some((s) => s?.inHand && s.lastAction?.type === "raise");
  const presets = raisePresets({
    unopened,
    postflop: hand.street !== "preflop",
    bigBlind: view.settings.bigBlind,
    pot: hand.pot,
    currentBet: hand.currentBet,
    callAmount: legal.callAmount,
    minRaiseTo: min,
    maxRaiseTo: max,
    allInTo,
    potLimit: VARIANTS[view.settings.variant].betting === "PL",
  });

  const [amount, setAmount] = useState(min);
  const [text, setText] = useState(chipsToInput(min, dc));
  const [bad, setBad] = useState(false);
  const choose = (to: number) => {
    setAmount(to);
    setText(chipsToInput(to, dc));
    setBad(false);
  };
  const valid = !bad && amount <= max && (amount >= min || amount === allInTo);
  const verb = hand.currentBet === 0 ? "Bet" : "Raise to";

  return (
    // Phones: a bottom sheet over the table, just above the buttons. Landscape: a card above them.
    <div className="absolute inset-x-0 bottom-full z-40 rounded-t-2xl border-t border-line bg-panel p-3 shadow-2xl wide:mb-2 wide:rounded-2xl wide:border">
      <div className="mb-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => choose(p.to)}
            className={`flex flex-col items-center rounded-lg border px-1 py-2 text-sm ${
              amount === p.to ? "border-gold bg-gold/15" : "border-line bg-ink"
            }`}
          >
            <span className="font-semibold">{p.label}</span>
            <span className="tabular text-xs text-muted">{formatChips(p.to, dc)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          className="min-w-0 flex-1"
          min={min}
          max={max}
          step={1}
          value={Math.min(max, Math.max(min, amount))}
          aria-label="Raise amount"
          onChange={(e) => choose(Number(e.target.value))}
        />
        <ChipInput
          centMode={dc}
          className="w-28! shrink-0 text-right text-base"
          text={text}
          ariaLabel="Raise amount"
          onText={(t, cents) => {
            setText(t);
            setBad(cents === null);
            if (cents !== null) setAmount(cents);
          }}
        />
      </div>
      {!valid && (
        <p className="mt-1 text-xs text-danger">
          Between {formatChips(min, dc)} and {formatChips(max, dc)}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button className="min-h-11 flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" className="min-h-11 flex-[2] text-base font-bold" disabled={!valid} onClick={() => onRaise(amount)}>
          {amount === allInTo ? "All in" : verb} <span className="tabular">{formatChips(amount, dc)}</span>
        </Button>
      </div>
    </div>
  );
}
