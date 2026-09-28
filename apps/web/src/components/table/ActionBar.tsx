"use client";

import type { ClientMessage, TableView } from "@garagepoker/protocol";
import { useState } from "react";
import { raisePresets, VARIANTS } from "@garagepoker/engine";
import { chipsToInput, formatChips } from "@/lib/chips";
import { Button, ChipInput } from "../ui";
import type { Countdown } from "./Seat";

type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

export function ActionBar({ view, send, countdown }: { view: TableView; send: Send; countdown: Countdown | null }) {
  const [raising, setRaising] = useState(false);
  const legal = view.you.legal;
  const hand = view.hand;
  const dc = view.settings.displayCents;

  if (!hand || !legal) {
    const waitingOn = hand?.toAct ? view.seats[hand.toAct - 1]?.nickname : null;
    const inHand = view.you.seat !== null && view.seats[view.you.seat - 1]?.inHand;
    if (!inHand || !waitingOn) return null;
    return <div className="py-3 text-center text-sm text-muted">Waiting for {waitingOn}…</div>;
  }

  const act = (action: Extract<ClientMessage, { type: "act" }>["action"]) => {
    setRaising(false);
    send({ type: "act", hand: view.handNumber, action });
  };
  const me = view.seats[view.you.seat! - 1]!;
  const callAllIn = legal.callAmount > 0 && legal.callAmount >= me.stack;
  const isBet = hand.currentBet === 0;

  return (
    <div className="relative">
      {raising && legal.canRaise && (
        <RaisePopup
          view={view}
          onCancel={() => setRaising(false)}
          onRaise={(to) => act({ type: "raise", to })}
        />
      )}
      <div className="flex items-stretch gap-2">
        <Button variant="danger" className="flex-1 py-3 text-base" onClick={() => act({ type: "fold" })}>
          Fold
        </Button>
        {legal.canCheck ? (
          <Button className="flex-1 py-3 text-base" onClick={() => act({ type: "check" })}>
            Check
          </Button>
        ) : (
          <Button className="flex-1 flex-col py-2 text-base leading-tight" onClick={() => act({ type: "call" })}>
            <span>{callAllIn ? "Call all in" : "Call"}</span>
            <span className="tabular text-sm font-bold text-gold">{formatChips(legal.callAmount, dc)}</span>
          </Button>
        )}
        <Button
          variant="primary"
          className="flex-1 py-3 text-base"
          disabled={!legal.canRaise}
          onClick={() => setRaising((r) => !r)}
          aria-expanded={raising}
        >
          {isBet ? "Bet" : "Raise"}
        </Button>
      </div>
      {countdown && (
        <div className={`mt-1 text-center text-xs tabular ${countdown.inBank ? "text-danger" : "text-muted"}`}>
          {countdown.inBank ? "Time bank: " : ""}
          {countdown.seconds}s
        </div>
      )}
    </div>
  );
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
    // z-40: above the seats on the felt, which it overlaps on a phone.
    <div className="absolute inset-x-0 bottom-full z-40 mb-2 rounded-2xl border border-line bg-panel p-3 shadow-2xl">
      <div className="mb-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => choose(p.to)}
            className={`flex flex-col items-center rounded-lg border px-1 py-1.5 text-xs ${
              amount === p.to ? "border-gold bg-gold/15" : "border-line bg-ink"
            }`}
          >
            <span className="font-semibold">{p.label}</span>
            <span className="tabular text-[10px] text-muted">{formatChips(p.to, dc)}</span>
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
          className="w-24 text-right"
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
        <Button className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" className="flex-[2] py-2.5" disabled={!valid} onClick={() => onRaise(amount)}>
          {amount === allInTo ? "All in" : verb} <span className="tabular">{formatChips(amount, dc)}</span>
        </Button>
      </div>
    </div>
  );
}
