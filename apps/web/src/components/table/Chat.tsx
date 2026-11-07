"use client";

import type { TableView } from "@garagepoker/protocol";
import { SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Send } from "@/lib/useTableSocket";
import { inputClass } from "../ui";

const MAX_CHARS = 200;

/** Why you can't chat right now, or null if you can. */
export function chatBlockedReason(view: TableView): string | null {
  if (view.you.blocked) return "The owner removed you from this table.";
  if (view.you.codeRequired) return "Enter the join code to chat.";
  if (!view.settings.chat) return "The owner turned chat off.";
  if (view.you.watchBlocked) return "Take a seat to chat.";
  return null;
}

/** Messages not yours newer than `readId`. */
export function unreadCount(view: TableView, readId: number): number {
  return (view.chat ?? []).filter((c) => c.id > readId && !c.mine).length;
}

/**
 * Table chat (SPEC §5): the last 40 messages and a box to send one. Plain
 * text, 200 characters, one message a second. Session only: it goes when
 * the table does.
 */
export function ChatPanel({ view, send, autoFocus = false }: { view: TableView; send: Send; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const messages = view.chat ?? [];
  const lastId = messages.length ? messages[messages.length - 1]!.id : 0;
  const blocked = chatBlockedReason(view);

  // Keep the newest message in view as they arrive.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const submit = () => {
    const clean = text.trim();
    if (!clean || blocked) return;
    send({ type: "chat", text: clean.slice(0, MAX_CHARS) });
    setText("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <ol ref={list} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1 text-sm" aria-live="polite" aria-label="Chat messages">
        {messages.length === 0 && <li className="text-muted">No messages yet.</li>}
        {messages.map((m) => (
          <li key={m.id} className="break-words leading-snug">
            <span className={`font-semibold ${m.mine ? "text-gold" : m.seat === null ? "text-muted" : "text-text"}`}>{m.name}</span>
            <span className="text-muted">: </span>
            {m.text}
          </li>
        ))}
      </ol>
      {blocked ? (
        <p className="text-xs text-muted">{blocked}</p>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            className={`${inputClass} min-h-11`}
            value={text}
            maxLength={MAX_CHARS}
            autoFocus={autoFocus}
            placeholder="Message the table"
            aria-label="Chat message"
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
          />
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label="Send message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gold text-ink disabled:opacity-40"
          >
            <SendHorizontal size={18} aria-hidden />
          </button>
        </form>
      )}
    </div>
  );
}
