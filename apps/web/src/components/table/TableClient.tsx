"use client";

import { shortHash, type TableView } from "@garagepoker/protocol";
import Link from "next/link";
import { useState } from "react";
import { formatChips } from "@/lib/chips";
import { useServerNow, useTableSocket } from "@/lib/useTableSocket";
import { VARIANT_LABELS } from "../SettingsForm";
import { Button, ConfirmButton } from "../ui";
import { ActionBar } from "./ActionBar";
import { ReplayDialog } from "./ReplayDialog";
import { DiscardPicker } from "./DiscardPicker";
import { RunItTwicePrompt } from "./RunItTwicePrompt";
import { LedgerDialog } from "./LedgerDialog";
import { OwnerMenu } from "./OwnerMenu";
import { ApprovalPopup, RebuyDialog, SeatRequestDialog } from "./SeatDialogs";
import type { Countdown } from "./Seat";
import { TableFelt } from "./TableFelt";

type Dialog = { kind: "seat"; seat: number } | { kind: "rebuy" } | { kind: "ledger" } | { kind: "owner" } | null;

/**
 * The table page. Renders only the latest view the server sent; every button
 * sends a message and waits for the next view.
 */
export function TableClient({ tableId }: { tableId: string }) {
  const { view, connection, send, toasts, dismiss, clockOffset, commitments, replay, closeReplay } = useTableSocket(tableId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const now = useServerNow(clockOffset, !!view?.hand?.toAct || !!view?.hand?.ritOffer || !!view?.hand?.discard);

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
  const showReplay = view.handNumber > 0 && !view.you.watchBlocked;
  const canRebuy = !!mySeat && view.settings.rebuys && view.status !== "ended";
  const canLeave = !!mySeat && view.status !== "ended";

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
        {view.hand?.commitment && (
          <span className="shrink-0 font-mono text-[10px] text-muted" title="Deck commitment for this hand; verify it after the hand">
            deck {shortHash(view.hand.commitment)}
          </span>
        )}
        {view.spectators > 0 && (
          <span className="text-xs text-muted" title="People watching without a seat">
            {view.spectators} watching
          </span>
        )}
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

      {/* Action float (SPEC §7): full width above the toolbar on phones; over the
          table's bottom-right corner in landscape. Collapses when there's nothing to show. */}
      <section className="area-hand action-float relative flex flex-col gap-2 empty:hidden" aria-label="Actions">
        {view.you.request && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-gold/40 bg-panel px-3 py-2 text-sm shadow-lg">
            <span>Waiting for the owner to approve your {view.you.request.kind === "seat" ? "seat" : "rebuy"}…</span>
            <Button variant="ghost" onClick={() => send({ type: "cancelRequest" })}>
              Cancel
            </Button>
          </div>
        )}
        <div className="empty:hidden wide:rounded-2xl wide:border wide:border-line wide:bg-panel/95 wide:p-3 wide:shadow-2xl">
          <DiscardPicker view={view} send={send} now={now} />
        </div>
        <div className="empty:hidden wide:rounded-xl wide:bg-panel/95 wide:shadow-2xl">
          <RunItTwicePrompt view={view} send={send} now={now} />
        </div>
        <ActionBar
          key={view.handNumber}
          view={view}
          send={send}
          countdown={view.hand?.toAct === view.you.seat ? countdown : null}
          seenCommitment={view.lastHand ? commitments[view.lastHand.number] : undefined}
        />
      </section>

      {/* Toolbar: Ledger bottom-left, Away always visible. On phones there's no bar
          behind it, and Last hand / Rebuy / Leave go in the "More" menu so it fits 390 px. */}
      <footer className="area-util flex items-center gap-1.5 px-3 pt-1 safe-bottom wide:gap-2 wide:border-t wide:border-line wide:bg-panel/70 wide:pt-2">
        <Button onClick={() => setDialog({ kind: "ledger" })}>Ledger</Button>
        {view.you.isOwner && view.status !== "ended" && <PauseButton view={view} send={send} />}
        {showReplay && (
          <span className="hidden wide:contents">
            <Button variant="ghost" onClick={() => send({ type: "getReplay" })}>
              Last hand
            </Button>
          </span>
        )}
        <div className="flex-1" />
        {canRebuy && (
          <span className="hidden wide:contents">
            <Button variant="ghost" onClick={() => setDialog({ kind: "rebuy" })}>
              Rebuy
            </Button>
          </span>
        )}
        {canLeave && (
          <span className="hidden wide:contents">
            <ConfirmButton label="Leave" confirm="Leave seat?" variant="secondary" onConfirm={() => send({ type: "leaveSeat" })} />
          </span>
        )}
        {(showReplay || canRebuy || canLeave) && (
          <MoreMenu>
            {showReplay && <MenuItem onClick={() => send({ type: "getReplay" })}>Last hand</MenuItem>}
            {canRebuy && <MenuItem onClick={() => setDialog({ kind: "rebuy" })}>Rebuy</MenuItem>}
            {canLeave && (
              <div data-keep-open>
                <ConfirmButton label="Leave seat" confirm="Tap again to leave" variant="secondary" onConfirm={() => send({ type: "leaveSeat" })} />
              </div>
            )}
          </MoreMenu>
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
      {/* Never over the action bar: requests wait until you've acted. */}
      {view.you.isOwner && dialog?.kind !== "owner" && !view.you.legal && <ApprovalPopup view={view} send={send} />}
      {view.status === "ended" && !dialog && !replay && <LedgerDialog view={view} />}
      {replay && <ReplayDialog key={replay.hand} replay={replay} displayCents={view.settings.displayCents} onClose={closeReplay} />}

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

/** The owner's Pause / Resume, always on screen (SPEC §7). Pause waits for the hand to end. */
function PauseButton({ view, send }: { view: TableView; send: ReturnType<typeof useTableSocket>["send"] }) {
  if (view.status === "paused") {
    return (
      <Button variant="primary" onClick={() => send({ type: "startGame" })}>
        {view.handNumber === 0 ? "Start" : "Resume"}
      </Button>
    );
  }
  if (view.pauseRequested) {
    return (
      <Button onClick={() => send({ type: "startGame" })} title="Tap to keep playing">
        Pausing after hand
      </Button>
    );
  }
  return <Button onClick={() => send({ type: "pauseGame" })}>Pause</Button>;
}

/** Phones only: the toolbar's less-used actions, in a menu that opens upward. */
function MoreMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative wide:hidden">
      <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        ⋯ More
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute bottom-full right-0 z-50 mb-2 flex min-w-40 flex-col gap-1 rounded-xl border border-line bg-panel p-1.5 shadow-2xl [&_button]:w-full [&_button]:justify-start"
            onClick={(e) => {
              // Close after an action, except the first tap of Leave (it asks to confirm).
              if ((e.target as HTMLElement).closest("[data-keep-open]")) return;
              setOpen(false);
            }}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="ghost" role="menuitem" onClick={onClick}>
      {children}
    </Button>
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
  if (view.you.watchBlocked) return "Spectating is off at this table. Take a seat to watch.";
  if (view.hand) return null;
  if (view.status === "ended") return "The game has ended.";
  const lastShown = view.lastHand && view.lastHand.number === view.handNumber;
  if (view.you.request) return "Waiting for the owner to approve you.";
  if (view.status === "paused" && view.pausedReason === "waitingForPlayers") {
    return view.you.isOwner
      ? "Paused: waiting for players. Press Start when 2 players are back."
      : "Paused: waiting for players.";
  }
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
