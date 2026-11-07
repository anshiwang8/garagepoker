"use client";

import { type ClientMessage, type ReplayView, type ServerMessage, STALE_ACTION, type TableView } from "@garagepoker/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { tableSocketUrl } from "./server";
import { getPlayerToken } from "./token";

export type Connection = "connecting" | "open" | "reconnecting" | "unreachable";

/** Sends a message to the table (anything but hello, which the socket sends itself). */
export type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

export interface Toast {
  id: number;
  message: string;
  /** "error": something you tried was refused; "notice": information. */
  tone: "error" | "notice";
}

const PING_MS = 25_000;
/** No "pong" this long after a ping: the connection is dead (half-open), so reconnect. */
const PONG_TIMEOUT_MS = 10_000;
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
  /** The last replay the server sent: undefined before asking, null if there was no hand. */
  const [replay, setReplay] = useState<{ value: ReplayView | null; at: number } | undefined>(undefined);
  const toastId = useRef(0);

  const toast = useCallback((message: string, tone: Toast["tone"] = "error") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4_000);
  }, []);

  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let pongDue: ReturnType<typeof setTimeout> | undefined;
    const token = getPlayerToken();

    /** Sends a keep-alive; if no pong comes back in time, the socket is dead: drop it and reconnect. */
    const checkAlive = (ws: WebSocket) => {
      if (ws.readyState !== WebSocket.OPEN || pongDue) return;
      ws.send("ping");
      pongDue = setTimeout(() => {
        pongDue = undefined;
        if (wsRef.current === ws) dropAndReconnect(ws);
      }, PONG_TIMEOUT_MS);
    };

    /** Abandons a socket without waiting for its close handshake (which may never come). */
    const dropAndReconnect = (ws: WebSocket) => {
      ws.onclose = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // Already closed.
      }
      onClosed(true);
    };

    const onClosed = (opened: boolean) => {
      clearInterval(ping);
      clearTimeout(pongDue);
      pongDue = undefined;
      if (stopped) return;
      failures = opened ? 1 : failures + 1;
      setConnection(!opened && failures >= UNREACHABLE_AFTER ? "unreachable" : "reconnecting");
      clearTimeout(retry);
      retry = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(failures, 5)));
    };

    const connect = () => {
      const ws = new WebSocket(tableSocketUrl(tableId));
      wsRef.current = ws;
      let opened = false;

      ws.onopen = () => {
        opened = true;
        failures = 0;
        setConnection("open");
        ws.send(JSON.stringify({ type: "hello", token } satisfies ClientMessage));
        ping = setInterval(() => checkAlive(ws), PING_MS);
      };
      ws.onmessage = (e: MessageEvent<string>) => {
        if (e.data === "pong") {
          clearTimeout(pongDue);
          pongDue = undefined;
          return;
        }
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
        } else if (m.type === "replay") {
          if (m.replay) setReplay({ value: m.replay, at: Date.now() });
          else toast("There's no finished hand to replay yet.", "notice");
        } else if (m.message !== STALE_ACTION) {
          // (A stale action is a double tap the server ignored: nothing to tell the player.)
          toast(m.message);
        }
      };
      // Only the current socket reconnects: an abandoned one closing late mustn't start a second.
      ws.onclose = () => wsRef.current === ws && onClosed(opened);
    };
    connect();

    // Back online, or back to the tab (phones freeze background tabs): reconnect
    // now rather than at the end of a backoff, or check an open socket is alive.
    const wake = () => {
      if (stopped || document.visibilityState === "hidden") return;
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) return checkAlive(ws);
      if (ws?.readyState === WebSocket.CONNECTING) return;
      if (ws) ws.onclose = null;
      clearTimeout(retry);
      connect();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      clearTimeout(pongDue);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      wsRef.current?.close(1000, "leaving");
    };
  }, [tableId, toast]);

  const send = useCallback(
    (m: Exclude<ClientMessage, { type: "hello" }>) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
      else toast("Not connected. Reconnecting…", "notice");
    },
    [toast],
  );

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const closeReplay = useCallback(() => setReplay(undefined), []);

  return { view, connection, send, toasts, dismiss, clockOffset, commitments, replay: replay?.value ?? null, closeReplay };
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
