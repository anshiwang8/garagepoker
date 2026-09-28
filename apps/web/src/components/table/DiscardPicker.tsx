"use client";

import type { ClientMessage, TableView } from "@garagepoker/protocol";
import { useState } from "react";
import { Button } from "../ui";
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
      <p className="text-center text-sm text-muted">
        Waiting for {waiting.join(", ")} to discard… <span className="tabular">{seconds}s</span>
      </p>
    );
  }

  const choice = picked && cards.includes(picked) ? picked : null;
  return (
    <div className="flex flex-col items-center gap-2" role="group" aria-label="Discard a card">
      <div className="flex w-full items-center justify-between text-sm">
        <span className="font-semibold">Discard 1 card</span>
        <span className="tabular text-gold">{seconds}s</span>
      </div>
      <div className="flex gap-1.5">
        {cards.map((card) =>
          card ? (
            <button
              key={card}
              type="button"
              aria-pressed={choice === card}
              aria-label={`Discard ${card}`}
              onClick={() => setPicked(card)}
              className={`rounded-md transition-transform ${choice === card ? "-translate-y-2 ring-2 ring-danger" : ""}`}
            >
              <PlayingCard card={card} size="md" dim={choice !== null && choice !== card} />
            </button>
          ) : null,
        )}
      </div>
      <Button
        variant="danger"
        className="w-full py-2.5"
        disabled={!choice}
        onClick={() => {
          if (!choice) return;
          send({ type: "discard", hand: view.handNumber, card: choice });
          setPicked(null);
        }}
      >
        {choice ? `Discard ${choice}` : "Tap a card to discard"}
      </Button>
      <p className="text-xs text-muted">Out of time? Your lowest card is discarded.</p>
    </div>
  );
}
