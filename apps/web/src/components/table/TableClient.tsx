"use client";

import type { TableView } from "@garagepoker/protocol";
import Link from "next/link";
import { useState } from "react";
import { formatChips } from "@/lib/chips";
import { useServerNow, useTableSocket } from "@/lib/useTableSocket";
import { VARIANT_LABELS } from "../SettingsForm";
import { Button, ConfirmButton } from "../ui";
import { ActionBar } from "./ActionBar";
import { HandResult } from "./HandResult";
import { LedgerDialog } from "./LedgerDialog";
import { OwnerMenu } from "./OwnerMenu";
import { PlayingCard } from "./PlayingCard";
import { ApprovalPopup, RebuyDialog, SeatRequestDialog } from "./SeatDialogs";
import type { Countdown } from "./Seat";
import { TableFelt } from "./TableFelt";

type Dialog = { kind: "seat"; seat: number } | { kind: "rebuy" } | { kind: "ledger" } | { kind: "owner" } | null;

/**
 * The table page. Renders only the latest view the server sent; every button
 * sends a message and waits for the next view.
 */
export function TableClient({ tableId }: { tableId: string }) {
  const { view, connection, send, toasts, dismiss, clockOffset } = useTableSocket(tableId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const now = useServerNow(clockOffset, !!view?.hand?.toAct);

  if (!view) {
    return (
      <Centered>
        {connection === "unreachable" ? (
          <>
            <p className="text-lg font-semibold">Can&apos;t reach this table</p>
            <p className="text-sm text-muted">Check the link. The table may have closed. Still trying…</p>
            <Link href="/" className="text-gold underline">
              Start a new table
            </Link>
          </>
        ) : (
          <p className="text-muted">Connecting…</p>
        )}
      </Centered>
    );
  }

  const countdown = countdownFor(view, now);
  const mySeat = view.you.seat !== null ? view.seats[view.you.seat - 1] : null;
  const canSit = view.you.seat === null && !view.you.request && view.status !== "ended";
  const close = () => setDialog(null);

  return (
    <div className="table-layout overflow-hidden">
      {/* Top bar */}
      <header className="area-top flex items-center gap-2 border-b border-line bg-panel/70 px-3 py-2">
        <Link href="/" className="font-bold tracking-tight">
          G<span className="text-gold">P</span>
        </Link>
        <div className="min-w-0 flex-1 truncate text-xs text-muted">
          {VARIANT_LABELS[view.settings.variant].name} · {formatChips(view.settings.smallBlind, view.settings.displayCents)}/
          {formatChips(view.settings.bigBlind, view.settings.displayCents)}
          {view.settings.ante > 0 && ` · ante ${formatChips(view.settings.ante, view.settings.displayCents)}`}
          {view.settings.boards === 2 && " · 2 boards"}
          {view.handNumber > 0 && ` · hand ${view.handNumber}`}
        </div>
        {connection !== "open" && <span className="rounded bg-danger/20 px-2 py-0.5 text-xs text-danger">Reconnecting…</span>}
        {view.you.isOwner && (
          <Button onClick={() => setDialog({ kind: "owner" })} className="relative">
            Owner
            {(view.requests?.length ?? 0) > 0 && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger" aria-label="Pending requests" />
            )}
          </Button>
        )}
      </header>

      {/* Felt */}
      <div className="area-felt flex min-h-0 flex-col">
        <TableFelt
          view={view}
          countdown={countdown}
          canSit={canSit}
          onSit={(seat) => setDialog({ kind: "seat", seat })}
          statusText={statusText(view, canSit)}
        />
      </div>

      {/* Your hand and actions */}
      <section className="area-hand flex flex-col justify-end gap-3 border-t border-line bg-panel/70 p-3 wide:border-l wide:border-t-0">
        {view.you.request && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
            <span>Waiting for the owner to approve your {view.you.request.kind === "seat" ? "seat" : "rebuy"}…</span>
            <Button variant="ghost" onClick={() => send({ type: "cancelRequest" })}>
              Cancel
            </Button>
          </div>
        )}
        {view.you.isOwner && view.status === "paused" && (
          <Button variant="primary" className="py-3 text-base" onClick={() => send({ type: "startGame" })}>
            {view.handNumber === 0 ? "Start game" : "Resume game"}
          </Button>
        )}
        {mySeat?.inHand && mySeat.cards && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <div className="flex gap-1.5">
              {mySeat.cards.map((c, i) => (
                <PlayingCard key={i} card={c} size={mySeat.cards!.length > 2 ? "md" : "lg"} dim={mySeat.folded} />
              ))}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="text-xs uppercase tracking-wide text-muted">{mySeat.folded ? "Folded" : "Your hand"}</span>
              {!mySeat.folded &&
                view.you.labels?.map((label, b) => (
                  <span key={b} className="font-semibold leading-snug">
                    {view.you.labels!.length > 1 && <span className="mr-1 text-xs font-normal text-muted">Board {b + 1}</span>}
                    {label}
                  </span>
                ))}
            </div>
          </div>
        )}
        {!view.hand && view.lastHand && view.lastHand.number === view.handNumber && <HandResult view={view} />}
        <ActionBar view={view} send={send} countdown={view.hand?.toAct === view.you.seat ? countdown : null} />
      </section>

      {/* Utility row: Ledger bottom-left, Away always visible */}
      <footer className="area-util flex items-center gap-2 border-t border-line bg-panel/70 px-3 pt-2 safe-bottom">
        <Button onClick={() => setDialog({ kind: "ledger" })}>Ledger</Button>
        <div className="flex-1" />
        {mySeat && view.settings.rebuys && view.status !== "ended" && (
          <Button variant="ghost" onClick={() => setDialog({ kind: "rebuy" })}>
            Rebuy
          </Button>
        )}
        {mySeat && view.status !== "ended" && (
          <ConfirmButton label="Leave" confirm="Leave seat?" variant="secondary" onConfirm={() => send({ type: "leaveSeat" })} />
        )}
        <Button
          variant={mySeat?.away ? "primary" : "secondary"}
          disabled={!mySeat || view.status === "ended"}
          title={mySeat ? undefined : "Take a seat first"}
          onClick={() => mySeat && send({ type: "setAway", away: !mySeat.away })}
          aria-pressed={!!mySeat?.away}
        >
          {mySeat?.away ? "I'm back" : "Away"}
        </Button>
      </footer>

      {/* Dialogs */}
      {dialog?.kind === "seat" && <SeatRequestDialog view={view} seat={dialog.seat} send={send} onClose={close} />}
      {dialog?.kind === "rebuy" && <RebuyDialog view={view} send={send} onClose={close} />}
      {dialog?.kind === "ledger" && <LedgerDialog view={view} onClose={close} />}
      {dialog?.kind === "owner" && view.you.isOwner && <OwnerMenu view={view} send={send} onClose={close} />}
      {view.you.isOwner && dialog?.kind !== "owner" && <ApprovalPopup view={view} send={send} />}
      {view.status === "ended" && !dialog && <LedgerDialog view={view} />}

      {/* Toasts: server errors and notices */}
      <div className="pointer-events-none fixed inset-x-0 top-12 z-50 flex flex-col items-center gap-2 px-3">
        {view.you.notice && (
          <div className="pointer-events-auto rounded-xl border border-gold/40 bg-panel px-4 py-2 text-sm shadow-xl">{view.you.notice}</div>
        )}
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className="pointer-events-auto rounded-xl border border-danger/50 bg-panel px-4 py-2 text-sm text-text shadow-xl"
          >
            {t.message}
          </button>
        ))}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">{children}</main>;
}

function countdownFor(view: TableView, now: number): Countdown | null {
  const hand = view.hand;
  if (!hand?.toAct || hand.decisionDeadline === null || hand.bankDeadline === null) return null;
  const decisionMs = view.settings.decisionTimeSec * 1000;
  const left = hand.decisionDeadline - now;
  if (left > 0) return { fraction: left / decisionMs, seconds: Math.ceil(left / 1000), inBank: false };
  const bankLeft = Math.max(0, hand.bankDeadline - now);
  const bankTotal = Math.max(1, hand.bankDeadline - hand.decisionDeadline);
  return { fraction: bankLeft / bankTotal, seconds: Math.ceil(bankLeft / 1000), inBank: true };
}

function statusText(view: TableView, canSit: boolean): string | null {
  if (view.hand) return null;
  if (view.status === "ended") return "The game has ended.";
  const lastShown = view.lastHand && view.lastHand.number === view.handNumber;
  if (view.you.request) return "Waiting for the owner to approve you.";
  if (view.status === "paused") {
    if (view.handNumber === 0) {
      if (view.you.isOwner) return canSit ? "Take a seat, share the link, then press Start." : "Share the link, then press Start.";
      return canSit ? "Tap an empty seat to sit down." : "Waiting for the owner to start.";
    }
    return lastShown ? null : "Paused";
  }
  if (lastShown) return null;
  const seated = view.seats.filter((s) => s && !s.away && s.stack > 0).length;
  if (seated < 2) return canSit ? "Tap an empty seat to sit down." : "Waiting for more players…";
  return null;
}
