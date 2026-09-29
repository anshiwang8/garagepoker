"use client";

import Link from "next/link";
import { useServerNow, useTableSocket } from "@/lib/useTableSocket";
import { TableScreen } from "./TableScreen";

/**
 * The live table: keeps the latest view the server sent and renders it. It
 * never computes game state itself.
 */
export function TableClient({ tableId }: { tableId: string }) {
  const { view, connection, send, toasts, dismiss, clockOffset, commitments, replay, closeReplay } = useTableSocket(tableId);
  const now = useServerNow(clockOffset, !!view?.hand?.toAct || !!view?.hand?.ritOffer || !!view?.hand?.discard);

  if (!view) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
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
      </main>
    );
  }

  return (
    <TableScreen
      view={view}
      send={send}
      now={now}
      connection={connection}
      toasts={toasts}
      dismiss={dismiss}
      seenCommitment={view.lastHand ? commitments[view.lastHand.number] : undefined}
      replay={replay}
      closeReplay={closeReplay}
    />
  );
}
