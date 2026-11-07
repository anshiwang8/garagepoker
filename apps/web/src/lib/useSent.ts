"use client";

import { useEffect, useState } from "react";

/** How long a tap counts as "sent" if the table doesn't move on (e.g. the server refused it). */
const SENT_TIMEOUT_MS = 3_000;

/**
 * Guards a control against double taps. `key` describes the table state the
 * tap was meant for (e.g. hand number and log length). After `mark()`, the
 * control reports `sent` until that key changes (the server moved on) or
 * 3 s pass, so a second tap can't send the same thing again.
 */
export function useSent(key: string): [sent: boolean, mark: () => void] {
  const [sentFor, setSentFor] = useState<string | null>(null);
  useEffect(() => {
    if (sentFor === null) return;
    const t = setTimeout(() => setSentFor(null), SENT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [sentFor]);
  return [sentFor === key, () => setSentFor(key)];
}
