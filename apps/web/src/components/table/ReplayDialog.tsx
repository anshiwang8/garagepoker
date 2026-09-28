"use client";

import type { ReplayEvent, ReplayView } from "@garagepoker/protocol";
import { useEffect, useState } from "react";
import { formatChips } from "@/lib/chips";
import { Button, Modal } from "../ui";
import { CardSlot, PlayingCard } from "./PlayingCard";
import { actionText } from "./Seat";

const STREET_NAMES: Record<string, string> = { flop: "Flop", turn: "Turn", river: "River" };

function eventText(e: ReplayEvent, name: (seat: number) => string, dc: boolean, boards: number, twoRuns: boolean): string {
  switch (e.kind) {
    case "action":
      return `${name(e.seat)}: ${actionText({ type: e.type, amount: e.amount, to: e.to }, dc)}${e.allIn ? " (all in)" : ""}`;
    case "deal": {
      const where = [twoRuns && `Run ${e.run + 1}`, boards > 1 && `board ${e.board + 1}`].filter(Boolean).join(", ");
      return `${STREET_NAMES[e.street] ?? e.street}${where ? ` (${where})` : ""}: ${e.cards.join(" ")}`;
    }
    case "showdown":
      return `${name(e.seat)} shows ${e.cards.join(" ")} (${e.labels.join(" | ")})`;
    case "win":
      return `${name(e.seat)} wins ${formatChips(e.amount, dc)}`;
  }
}

/**
 * Steps through the last finished hand. Everything shown comes from the
 * server's replay, which only includes your own cards and cards shown at
 * showdown.
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
          <span className="capitalize">{frame.street === "complete" ? "Result" : frame.street}</span>
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
          {frame.events.length === 0 ? (
            <li className="text-muted">Cards dealt.</li>
          ) : (
            frame.events.map((e, i) => <li key={i}>{eventText(e, name, dc, boardCount, twoRuns)}</li>)
          )}
        </ul>

        <div className="flex flex-col items-center gap-1 rounded-lg bg-felt-dark/70 py-2">
          {rows.map(({ r, b, cards }) => (
            <div key={`${r}-${b}`} className="flex items-center gap-1.5">
              {(twoRuns || boardCount > 1) && (
                <span className="w-12 text-right text-[10px] text-muted">
                  {[twoRuns && `Run ${r + 1}`, boardCount > 1 && `B${b + 1}`].filter(Boolean).join(" · ")}
                </span>
              )}
              {Array.from({ length: 5 }, (_, i) =>
                cards[i] ? <PlayingCard key={i} card={cards[i]!} size="xs" /> : <CardSlot key={i} size="xs" />,
              )}
            </div>
          ))}
        </div>

        <ul className="flex flex-col divide-y divide-line/50">
          {frame.seats.map((s) => (
            <li key={s.seat} className={`flex items-center gap-2 py-1.5 ${s.folded ? "opacity-50" : ""}`}>
              <span className="w-24 truncate font-semibold">{s.nickname}</span>
              <span className="flex gap-0.5">
                {s.cards.map((c, i) => (
                  <PlayingCard key={i} card={c} size="xs" />
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
