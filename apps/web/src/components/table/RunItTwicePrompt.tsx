"use client";

import type { ClientMessage, TableView } from "@garagepoker/protocol";
import { Button } from "../ui";

type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

/**
 * SPEC §2.7: when run it twice is offered, everyone in the pot gets 5 s to
 * accept. Any decline, or no answer in time, means it runs once. Shown to
 * everyone; only players in the pot who haven't accepted get the buttons.
 */
export function RunItTwicePrompt({ view, send, now }: { view: TableView; send: Send; now: number }) {
  const offer = view.hand?.ritOffer;
  if (!offer) return null;
  const seconds = Math.max(0, Math.ceil((offer.deadline - now) / 1000));
  const me = view.you.seat;
  const mustAnswer = me !== null && offer.seats.includes(me) && !offer.accepted.includes(me);
  const waitingOn = offer.seats
    .filter((s) => !offer.accepted.includes(s))
    .map((s) => view.seats[s - 1]?.nickname ?? `Seat ${s}`);
  const answer = (accept: boolean) => send({ type: "runItTwice", hand: view.handNumber, accept });

  return (
    <div role="alertdialog" aria-label="Run it twice?" className="rounded-xl border border-gold/60 bg-gold/10 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Run it twice?</span>
        <span className="tabular text-sm text-gold" aria-label={`${seconds} seconds left`}>
          {seconds}s
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded bg-black/40">
        <div
          className="h-full bg-gold transition-[width] duration-200"
          style={{ width: `${Math.min(100, (Math.max(0, offer.deadline - now) / 5000) * 100)}%` }}
        />
      </div>
      {mustAnswer ? (
        <div className="mt-2 flex gap-2">
          <Button className="flex-1 py-2.5" onClick={() => answer(false)}>
            No, once
          </Button>
          <Button variant="primary" className="flex-1 py-2.5" onClick={() => answer(true)}>
            Yes, twice
          </Button>
        </div>
      ) : (
        <p className="mt-1.5 text-xs text-muted">
          Waiting for {waitingOn.join(", ")}. Any “no”, or no answer, runs it once.
        </p>
      )}
    </div>
  );
}
