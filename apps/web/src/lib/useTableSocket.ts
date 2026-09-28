"use client";

import type { ClientMessage, ServerMessage, TableView } from "@garagepoker/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { tableSocketUrl } from "./server";
import { getPlayerToken } from "./token";

export type Connection = "connecting" | "open" | "reconnecting" | "unreachable";

export interface Toast {
  id: number;
  message: string;
}

const PING_MS = 25_000;
/** Consecutive failures before an attempt that never opened, before we say "can't reach". */
const UNREACHABLE_AFTER = 3;

/**
 * Connects to a table and keeps the latest view the server sent. The view is
 * the only game state the page has: it never computes any itself.
 */
export function useTableSocket(tableId: string) {
  const [view, setView] = useState<TableView | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  /** serverNow - Date.now() at the last view, for countdowns. */
  const [clockOffset, setClockOffset] = useState(0);
  /** Commitments seen at the start of each hand, to verify against afterwards. */
  const [commitments, setCommitments] = useState<Record<number, string>>({});
  const toastId = useRef(0);

  const toast = useCallback((message: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4_000);
  }, []);

  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    const token = getPlayerToken();

    const connect = () => {
      const ws = new WebSocket(tableSocketUrl(tableId));
      wsRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        failures = 0;
        setConnection("open");
        ws.send(JSON.stringify({ type: "hello", token } satisfies ClientMessage));
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), PING_MS);
      };
      ws.onmessage = (e: MessageEvent<string>) => {
        if (e.data === "pong") return;
        let m: ServerMessage;
        try {
          m = JSON.parse(e.data) as ServerMessage;
        } catch {
          return;
        }
        if (m.type === "view") {
          setClockOffset(m.view.serverNow - Date.now());
          const hand = m.view.hand;
          if (hand?.commitment) {
            const { number, commitment } = hand;
            setCommitments((prev) => (prev[number] ? prev : { ...prev, [number]: commitment }));
          }
          setView((prev) => (prev && prev.rev > m.view.rev ? prev : m.view));
        } else {
          toast(m.message);
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (stopped) return;
        failures = opened ? 1 : failures + 1;
        setConnection(!opened && failures >= UNREACHABLE_AFTER ? "unreachable" : "reconnecting");
        retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(failures, 5)));
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      wsRef.current?.close(1000, "leaving");
    };
  }, [tableId, toast]);

  const send = useCallback(
    (m: Exclude<ClientMessage, { type: "hello" }>) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
      else toast("Not connected. Reconnecting…");
    },
    [toast],
  );

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return { view, connection, send, toasts, dismiss, clockOffset, commitments };
}

/** Re-renders every `ms` while `active`, returning the server-adjusted time. */
export function useServerNow(clockOffset: number, active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now + clockOffset;
}
