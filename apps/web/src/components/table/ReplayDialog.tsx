"use client";

import { type ReplayEvent, type ReplayView, streetTitle } from "@garagepoker/protocol";
import { useEffect, useState } from "react";
import { formatChips } from "@/lib/chips";
import { Button, Modal } from "../ui";
import { PlayingCard } from "./PlayingCard";
import { RED_RIVER_STOPS } from "./OptionsSheet";
import { actionText } from "./Seat";

export function eventText(e: ReplayEvent, name: (seat: number) => string, dc: boolean, boards: number, twoRuns: boolean): string {
  switch (e.kind) {
    case "action":
      return `${name(e.seat)}: ${actionText({ type: e.type, amount: e.amount, to: e.to }, dc)}${e.allIn ? " (all in)" : ""}`;
    case "deal": {
      const where = [twoRuns && `Run ${e.run + 1}`, boards > 1 && `board ${e.board + 1}`].filter(Boolean).join(", ");
      return `${streetTitle(e.street, e.extraRound) || e.street}${where ? ` (${where})` : ""}: ${e.cards.join(" ")}`;
    }
    case "showdown":
      return `${name(e.seat)} shows ${e.cards.join(" ")} (${e.labels.join(" | ")})`;
    case "win":
      return `${name(e.seat)} wins ${formatChips(e.amount, dc)}`;
    case "show":
      return `${name(e.seat)} shows ${e.cards.join(" ")}`;
  }
}

/** Where the "No cards left" note goes: before the first showdown or win (or at the very end), if red river stopped. */
export function stopPoint(replay: ReplayView): { frame: number; event: number } | null {
  if (!replay.redRiverStopped) return null;
  for (let f = 0; f < replay.frames.length; f++) {
    const event = replay.frames[f]!.events.findIndex((e) => e.kind === "showdown" || e.kind === "win");
    if (event >= 0) return { frame: f, event };
  }
  const end = replay.frames.length - 1;
  return { frame: end, event: replay.frames[end]!.events.length };
}

/**
 * Steps through the last finished hand. Everything shown comes from the
 * server's replay, which only includes your own cards and cards shown at
 * showdown or after the hand.
 */
export function ReplayDialog({ replay, displayCents, onClose }: { replay: ReplayView; displayCents: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = replay.frames.length - 1;
  const frame = replay.frames[Math.min(step, last)]!;
  const dc = displayCents;
  const names = new Map(replay.frames[0]!.seats.map((s) => [s.seat, s.nickname]));
  const name = (seat: number) => names.get(seat) ?? `Seat ${seat}`;
  const boardCount = frame.boards.length;
  const twoRuns = !!replay.frames[last]!.secondRun;
  const rows = [frame.boards, ...(frame.secondRun ? [frame.secondRun] : [])].flatMap((run, r) =>
    run.map((cards, b) => ({ r, b, cards })),
  );

  // Red river stopped once the last round's cards and betting were done: the note goes just before the result (as in the export).
  const stop = stopPoint(replay);
  const lines = frame.events.map((e, i) => <li key={i}>{eventText(e, name, dc, boardCount, twoRuns)}</li>);
  if (stop && stop.frame === Math.min(step, last)) lines.splice(stop.event, 0, <li key="stopped" className="italic text-muted">{RED_RIVER_STOPS}</li>);

  const atEnd = step >= last;
  useEffect(() => {
    if (!playing || atEnd) return;
    const t = setInterval(() => setStep((s) => Math.min(last, s + 1)), 1_000);
    return () => clearInterval(t);
  }, [playing, atEnd, last]);

  return (
    <Modal title={`Last hand: #${replay.hand}`} onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{streetTitle(frame.street, frame.extraRound) || "Result"}</span>
          <span className="tabular">
            Step {step + 1} of {last + 1}
            {frame.pot > 0 && (
              <>
                {" · Pot "}
                <span className="text-gold">{formatChips(frame.pot, dc)}</span>
              </>
            )}
          </span>
        </div>

        <ul className="min-h-12 rounded-lg border border-line bg-ink px-3 py-2" aria-live="polite">
          {lines.length === 0 ? <li className="text-muted">Cards dealt.</li> : lines}
        </ul>

        {replay.grid ? (
          <div className="flex flex-wrap justify-center gap-4 rounded-lg bg-felt-dark/70 py-2">
            {rows.map(({ r, b, cards }) => (
              <div key={`${r}-${b}`} className="flex flex-col items-center gap-1">
                {(twoRuns || boardCount > 1) && (
                  <span className="text-[10px] text-muted">{[twoRuns && `Run ${r + 1}`, boardCount > 1 && `B${b + 1}`].filter(Boolean).join(" · ")}</span>
                )}
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${replay.grid!.size}, 24px)` }}>
                  {Array.from({ length: replay.grid!.size ** 2 }, (_, square) => {
                    const card = cards[replay.grid!.cells.indexOf(square)];
                    return card ? (
                      <PlayingCard key={square} card={card} w={24} h={34} />
                    ) : (
                      <div key={square} className="h-[34px] w-6 rounded border border-dashed border-white/15" />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 rounded-lg bg-felt-dark/70 py-2">
            {rows.map(({ r, b, cards }) => (
              <div key={`${r}-${b}`} className="flex max-w-full items-center gap-1.5 px-2">
                {(twoRuns || boardCount > 1) && (
                  <span className="w-12 shrink-0 text-right text-[10px] text-muted">
                    {[twoRuns && `Run ${r + 1}`, boardCount > 1 && `B${b + 1}`].filter(Boolean).join(" · ")}
                  </span>
                )}
                {/* At least 5 slots; a red river board is longer, and wraps if it must. */}
                <div className="flex min-w-0 flex-wrap gap-1">
                  {Array.from({ length: Math.max(5, cards.length) }, (_, i) =>
                    cards[i] ? <PlayingCard key={i} card={cards[i]!} w={24} h={34} /> : <div key={i} className="h-[34px] w-6 rounded border border-dashed border-white/15" />,
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <ul className="flex flex-col divide-y divide-line/50">
          {frame.seats.map((s) => (
            <li key={s.seat} className={`flex items-center gap-2 py-1.5 ${s.folded ? "opacity-50" : ""}`}>
              <span className="w-24 truncate font-semibold">{s.nickname}</span>
              <span className="flex gap-0.5">
                {s.cards.map((c, i) => (
                  <PlayingCard key={i} card={c} w={24} h={34} />
                ))}
              </span>
              <span className="ml-auto text-right tabular">
                {s.bet > 0 && <span className="mr-2 text-xs text-muted">bet {formatChips(s.bet, dc)}</span>}
                <span className="text-gold">{formatChips(s.stack, dc)}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-5 gap-1.5">
          <Button onClick={() => setStep(0)} disabled={step === 0} aria-label="First step">
            ⏮
          </Button>
          <Button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} aria-label="Previous step">
            ◀
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              // Play from the start again once the end is reached.
              if (atEnd) {
                setStep(0);
                setPlaying(true);
              } else {
                setPlaying((p) => !p);
              }
            }}
          >
            {playing && !atEnd ? "Pause" : "Play"}
          </Button>
          <Button onClick={() => setStep((s) => Math.min(last, s + 1))} disabled={step >= last} aria-label="Next step">
            ▶
          </Button>
          <Button onClick={() => setStep(last)} disabled={step >= last} aria-label="Last step">
            ⏭
          </Button>
        </div>
      </div>
    </Modal>
  );
}
