"use client";

import type { Payment } from "@garagepoker/engine";
import type { TableView } from "@garagepoker/protocol";
import { formatChips } from "@/lib/chips";
import { downloadText, ledgerCsv } from "@/lib/csv";
import { Button, Modal } from "../ui";

/** "Sam pays Alex $32" (or "$32.00" with display cents on). */
export function paymentText(p: Payment, displayCents: boolean): string {
  return `${p.fromName} pays ${p.toName} $${formatChips(p.amount, displayCents)}`;
}

export function LedgerDialog({ view, onClose }: { view: TableView; onClose?: () => void }) {
  const dc = view.settings.displayCents;
  const rows = view.ledger;
  const f = (n: number) => formatChips(n, dc);
  return (
    <Modal title={view.status === "ended" ? "Final ledger" : "Ledger"} onClose={onClose} wide>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No buy-ins yet.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full text-sm tabular">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-2 font-medium">Player</th>
                <th className="py-2 px-2 text-right font-medium">Buy-in</th>
                <th className="py-2 px-2 text-right font-medium">Buy-out</th>
                <th className="py-2 px-2 text-right font-medium">Stack</th>
                <th className="py-2 pl-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.playerId} className="border-b border-line/50">
                  <td className="max-w-[8rem] truncate py-2 pr-2">{r.nickname}</td>
                  <td className="py-2 px-2 text-right">{f(r.buyIn)}</td>
                  <td className="py-2 px-2 text-right">{f(r.buyOut)}</td>
                  <td className="py-2 px-2 text-right">{f(r.stack)}</td>
                  <td className={`py-2 pl-2 text-right font-semibold ${r.net > 0 ? "text-ok" : r.net < 0 ? "text-danger" : ""}`}>
                    {r.net > 0 ? "+" : ""}
                    {f(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Net = buy-out + stack − buy-in. This session only; nothing is stored.</p>

      {view.settlement && (
        <section className="mt-5 flex flex-col gap-2" aria-label="Settle up">
          <h3 className="text-sm font-semibold">Settle up</h3>
          {view.settlement.length === 0 ? (
            <p className="text-sm text-muted">Everyone is square. No payments needed.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {view.settlement.map((p, i) => (
                <li key={i} className="rounded-lg border border-line bg-ink px-3 py-2 text-sm">
                  {paymentText(p, dc)}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">The app never handles real money; it only does the arithmetic.</p>
          <Button
            className="self-start"
            onClick={() => downloadText(`garagepoker-${view.tableId}-ledger.csv`, ledgerCsv(rows, view.settlement, dc))}
          >
            Download CSV
          </Button>
        </section>
      )}
    </Modal>
  );
}
