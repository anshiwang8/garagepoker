"use client";

import type { ClientMessage, TableView } from "@garagepoker/protocol";
import { useState } from "react";
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
  const capped = max < allInTo;
  const unit = dc ? 1 : 100;

  const clamp = (x: number) => Math.min(max, Math.max(min, x));
  /** Raise to the current bet plus a fraction of the pot after calling. */
  const potFraction = (f: number) => {
    const raw = hand.currentBet + Math.round(f * (hand.pot + legal.callAmount));
    return clamp(Math.floor(raw / unit) * unit);
  };
  const presets: { label: string; to: number; note?: string }[] = [
    { label: "Min", to: min },
    { label: "⅓ pot", to: potFraction(1 / 3) },
    { label: "½ pot", to: potFraction(1 / 2) },
    { label: "¾ pot", to: potFraction(3 / 4) },
    { label: "All in", to: max, note: capped ? "pot max" : undefined },
  ];

  const [amount, setAmount] = useState(min);
  const [text, setText] = useState(chipsToInput(min));
  const [bad, setBad] = useState(false);
  const choose = (to: number) => {
    setAmount(to);
    setText(chipsToInput(to));
    setBad(false);
  };
  const valid = !bad && amount <= max && (amount >= min || amount === allInTo);
  const verb = hand.currentBet === 0 ? "Bet" : "Raise to";

  return (
    <div className="absolute inset-x-0 bottom-full mb-2 rounded-2xl border border-line bg-panel p-3 shadow-2xl">
      <div className="mb-3 grid grid-cols-5 gap-1.5">
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
            <span className="tabular text-[10px] text-muted">{p.note ?? formatChips(p.to, dc)}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          className="min-w-0 flex-1"
          min={min}
          max={max}
          step={unit}
          value={Math.min(max, Math.max(min, amount))}
          aria-label="Raise amount"
          onChange={(e) => {
            const v = Number(e.target.value);
            choose(max - v < unit ? max : v);
          }}
        />
        <ChipInput
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
