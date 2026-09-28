"use client";

import { type FairnessCheck, lastHandPublicCards, shortHash, type TableView, verifyFairness } from "@garagepoker/protocol";
import { useState } from "react";
import { sha256Hex } from "@/lib/sha256";
import { Button, Modal } from "../ui";

type Result = { ok: boolean; checks: FairnessCheck[] } | { error: string };

/**
 * "Verify": recomputes the last hand's hashes in this browser with Web Crypto
 * and checks them against the commitment this browser saw at hand start.
 */
export function VerifyButton({ view, seenCommitment }: { view: TableView; seenCommitment: string | undefined }) {
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);
  const last = view.lastHand;
  if (!last?.fairness) return null;
  const proof = last.fairness;

  const run = async () => {
    setOpen(true);
    setResult(null);
    try {
      setResult(await verifyFairness(proof, lastHandPublicCards(last), sha256Hex, seenCommitment));
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Couldn't run the check in this browser" });
    }
  };

  return (
    <>
      <button type="button" onClick={run} className="underline decoration-dotted underline-offset-2 hover:text-text">
        Verify
      </button>
      {open && (
        <Modal title={`Verify hand ${last.number}`} onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted">
              Before dealing, the server committed to every card in the deck (hash{" "}
              <code className="text-text">{shortHash(proof.commitment)}</code>). Now it reveals the cards that were
              shown. Folded hands and discards stay secret.
            </p>
            {!seenCommitment && (
              <p className="text-xs text-muted">
                This browser didn&apos;t see this hand start, so it can only check the proof against itself.
              </p>
            )}
            {!result ? (
              <p className="text-muted">Checking…</p>
            ) : "error" in result ? (
              <p className="text-danger">{result.error}</p>
            ) : (
              <>
                <p className={`text-base font-semibold ${result.ok ? "text-ok" : "text-danger"}`}>
                  {result.ok ? "✓ Pass: no shown card changed after the deal" : "✗ Fail: this hand doesn't match its commitment"}
                </p>
                <ul className="flex flex-col gap-1">
                  {result.checks.map((c) => (
                    <li key={c.label} className="flex gap-2">
                      <span className={c.ok ? "text-ok" : "text-danger"}>{c.ok ? "✓" : "✗"}</span>
                      <span>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Revealed cards ({proof.revealed.length})</summary>
              <ul className="mt-1 max-h-40 overflow-y-auto font-mono">
                {proof.revealed.map((r) => (
                  <li key={r.index}>
                    #{r.index} {r.card} · salt {r.salt.slice(0, 8)}…
                  </li>
                ))}
              </ul>
            </details>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
