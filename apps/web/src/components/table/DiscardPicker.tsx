"use client";

import type { ClientMessage, TableView } from "@garagepoker/protocol";
import { useState } from "react";
import { PlayingCard } from "./PlayingCard";

type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

/**
 * Pineapple: on the preflop, flop and turn everyone discards one card face
 * down, at the same time, before betting. If time runs out the server
 * discards your lowest card.
 */
export function DiscardPicker({ view, send, now }: { view: TableView; send: Send; now: number }) {
  const phase = view.hand?.discard;
  const me = view.you.seat;
  const cards = me !== null ? view.seats[me - 1]?.cards : null;
  const [picked, setPicked] = useState<string | null>(null);
  if (!phase || me === null || !cards) return null;

  const seconds = Math.max(0, Math.ceil((phase.deadline - now) / 1000));
  if (!phase.seats.includes(me)) {
    const waiting = phase.seats.map((s) => view.seats[s - 1]?.nickname ?? `Seat ${s}`);
    return (
      <p className="text-center text-sm text-white/70">
        Waiting for {waiting.join(", ")} to discard… <span className="tabular">{seconds}s</span>
      </p>
    );
  }

  const choice = picked && cards.includes(picked) ? picked : null;
  return (
    <div className="ml-auto flex w-full max-w-[34rem] flex-col gap-1.5" role="group" aria-label="Discard a card">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/60">
        <span>Discard 1 card · lowest goes if time runs out</span>
        <span className="tabular text-gold">{seconds}s</span>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 justify-center gap-1.5">
          {cards.map((card) =>
            card ? (
              <button
                key={card}
                type="button"
                aria-pressed={choice === card}
                aria-label={`Discard ${card}`}
                onClick={() => setPicked(card)}
                className={`rounded-md transition-transform ${choice === card ? "-translate-y-1.5 ring-2 ring-[#ef4444]" : ""}`}
              >
                <PlayingCard card={card} w={40} h={56} dim={choice !== null && choice !== card} />
              </button>
            ) : null,
          )}
        </div>
        <button
          type="button"
          disabled={!choice}
          onClick={() => {
            if (!choice) return;
            send({ type: "discard", hand: view.handNumber, card: choice });
            setPicked(null);
          }}
          className="min-h-14 w-28 shrink-0 rounded-lg border-[1.5px] border-[#ef4444] font-semibold uppercase tracking-wide text-[#f87171] active:bg-[#ef4444] active:text-white disabled:opacity-30"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
