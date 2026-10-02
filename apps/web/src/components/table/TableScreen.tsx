"use client";

import type { ClientMessage, ReplayView, TableView } from "@garagepoker/protocol";
import { useState } from "react";
import type { Connection, Toast } from "@/lib/useTableSocket";
import { Modal } from "../ui";
import { ActionZone } from "./ActionZone";
import { Felt } from "./Felt";
import { HandResult } from "./HandResult";
import { LedgerDialog } from "./LedgerDialog";
import { LogDialog, LogLines, type OptionsItem, OptionsSheet } from "./OptionsSheet";
import { OwnerMenu } from "./OwnerMenu";
import { ReplayDialog } from "./ReplayDialog";
import { ApprovalPopup, RebuyDialog, SeatRequestDialog } from "./SeatDialogs";
import { countdownFor } from "./tableText";
import { TopBar } from "./TopBar";

export type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

type Dialog =
  | { kind: "seat"; seat: number }
  | { kind: "options" }
  | { kind: "details" }
  | { kind: Exclude<OptionsItem, "replay"> }
  | null;

/**
 * The table page (SPEC §7): the top icon bar, the felt, and the bottom action
 * zone. Renders only the view it's given; every button sends a message.
 */
export function TableScreen({
  view,
  send,
  now,
  connection = "open",
  toasts = [],
  dismiss = () => {},
  seenCommitment,
  replay = null,
  closeReplay = () => {},
  initialRaising,
}: {
  view: TableView;
  send: Send;
  /** Server time, for countdowns. */
  now: number;
  connection?: Connection;
  toasts?: Toast[];
  dismiss?: (id: number) => void;
  seenCommitment?: string;
  replay?: ReplayView | null;
  closeReplay?: () => void;
  /** Dev states only. */
  initialRaising?: boolean;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const countdown = countdownFor(view, now);
  const canSit = view.you.seat === null && !view.you.request && view.status !== "ended";

  return (
    <div className="table-page table-room flex flex-col overflow-hidden">
      <TopBar view={view} send={send} onOptions={() => setDialog({ kind: "options" })} />

      {/* Felt: fills the height between the bars and shrinks when the raise panel opens. */}
      <main className="relative min-h-0 flex-1" aria-label="Table">
        <Felt
          view={view}
          countdown={countdown}
          canSit={canSit}
          onSit={(seat) => setDialog({ kind: "seat", seat })}
          onRabbit={() => view.lastHand && send({ type: "rabbitHunt", hand: view.lastHand.number })}
          onDetails={() => setDialog({ kind: "details" })}
        />
        {connection !== "open" && (
          <div className="pointer-events-none absolute inset-x-0 top-1 flex justify-center">
            <span className="rounded-full bg-[#dc2626]/90 px-3 py-0.5 text-xs font-semibold text-white">Reconnecting…</span>
          </div>
        )}
      </main>

      {/* Bottom action zone: the log on the left on desktop, actions on the right. */}
      <section
        className="flex shrink-0 items-end gap-4 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-h-[6.25rem] lg:px-6"
        aria-label="Actions"
      >
        <div className="hidden h-[5.5rem] w-80 shrink-0 overflow-y-auto rounded-lg border border-white/10 bg-[#1c1c1c] px-3 py-2 lg:block" aria-label="Log">
          <div className="sticky -top-2 -mt-2 bg-[#1c1c1c] pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Log</div>
          <LogLines view={view} compact />
        </div>
        <div className="min-w-0 flex-1">
          <ActionZone key={view.handNumber} view={view} send={send} now={now} initialRaising={initialRaising} />
        </div>
      </section>

      {dialog?.kind === "options" && (
        <OptionsSheet
          view={view}
          onClose={close}
          onPick={(item) => {
            if (item === "replay") {
              close();
              send({ type: "getReplay" });
            } else setDialog({ kind: item });
          }}
        />
      )}
      {dialog?.kind === "seat" && <SeatRequestDialog view={view} seat={dialog.seat} send={send} onClose={close} />}
      {dialog?.kind === "rebuy" && <RebuyDialog view={view} send={send} onClose={close} />}
      {dialog?.kind === "ledger" && <LedgerDialog view={view} onClose={close} />}
      {dialog?.kind === "log" && <LogDialog view={view} onClose={close} />}
      {(dialog?.kind === "settings" || dialog?.kind === "players") && view.you.isOwner && (
        <OwnerMenu view={view} send={send} onClose={close} tab={dialog.kind} />
      )}
      {dialog?.kind === "details" && view.lastHand && (
        <Modal title={`Hand ${view.lastHand.number} result`} onClose={close}>
          <HandResult view={view} send={send} seenCommitment={seenCommitment} />
        </Modal>
      )}
      {/* Never over the action row: requests wait until you've acted. */}
      {view.you.isOwner && dialog?.kind !== "players" && !view.you.legal && <ApprovalPopup view={view} send={send} />}
      {view.status === "ended" && !dialog && !replay && <LedgerDialog view={view} />}
      {replay && <ReplayDialog key={replay.hand} replay={replay} displayCents={view.settings.displayCents} onClose={closeReplay} />}

      {/* Toasts: server errors and notices */}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(4.5rem+env(safe-area-inset-top))] z-50 flex flex-col items-center gap-2 px-3">
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
