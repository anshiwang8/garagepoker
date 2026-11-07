"use client";

import type { ClientMessage, ReplayView, TableView } from "@garagepoker/protocol";
import { MessageSquare, PanelRightClose } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { Connection, Toast } from "@/lib/useTableSocket";
import { Button, inputClass, Modal } from "../ui";
import { ActionZone } from "./ActionZone";
import { ChatPanel, unreadCount } from "./Chat";
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
  /** The final ledger opens by itself when the game ends; once closed it stays in Options. */
  const [finalLedgerClosed, setFinalLedgerClosed] = useState(false);
  const countdown = countdownFor(view, now);
  const canSit = view.you.seat === null && !view.you.request && view.status !== "ended";

  // Desktop: a collapsible sidebar for chat and the log (remembered per browser).
  const wide = useMediaQuery("(min-width: 1024px)");
  const [sidebarOpen, setSidebarOpen] = useState(() => readSidebarPref());
  const [tab, setTab] = useState<SideTab>("chat");
  const toggleSidebar = (open: boolean) => {
    markRead();
    setSidebarOpen(open);
    writeSidebarPref(open);
  };

  // Unread chat: counted while the chat isn't on screen; reading happens when it opens or closes.
  const lastChatId = view.chat?.length ? view.chat[view.chat.length - 1]!.id : 0;
  const [readId, setReadId] = useState(lastChatId);
  const markRead = () => setReadId(lastChatId);
  const chatVisible = (wide && sidebarOpen && tab === "chat") || dialog?.kind === "chat";
  const unread = view.chat && !chatVisible ? unreadCount(view, readId) : 0;
  const close = () => {
    if (dialog?.kind === "chat") markRead();
    setDialog(null);
  };

  return (
    <div className="table-page table-room flex flex-col overflow-hidden">
      <TopBar view={view} send={send} onOptions={() => setDialog({ kind: "options" })} unread={unread > 0 && !wide} />

      <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
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
            <span className="rounded-full bg-alert/90 px-3 py-0.5 text-xs font-semibold text-white">Reconnecting…</span>
          </div>
        )}
      </main>

      {/* Bottom action zone. */}
      <section
        className="flex shrink-0 items-end gap-4 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-h-[6.25rem] lg:px-6"
        aria-label="Actions"
      >
        <div className="min-w-0 flex-1">
          <ActionZone key={view.handNumber} view={view} send={send} now={now} initialRaising={initialRaising} />
        </div>
      </section>
      </div>

      {/* Desktop sidebar: chat and this hand's log; collapses to a tab on the right edge. */}
      {wide && sidebarOpen && (
        <aside className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-chrome/95 xl:w-96" aria-label="Chat and log">
          <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5" role="tablist">
            {SIDE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  if (tab === "chat") markRead();
                  setTab(t.id);
                }}
                className={`min-h-11 rounded-md px-3 text-sm font-semibold ${tab === t.id ? "bg-white/10 text-text" : "text-muted hover:text-text"}`}
              >
                {t.label}
                {t.id === "chat" && tab !== "chat" && unreadCount(view, readId) > 0 && (
                  <span className="ml-1.5 rounded-full bg-gold px-1.5 text-xs text-ink">{unreadCount(view, readId)}</span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => toggleSidebar(false)}
              aria-label="Hide sidebar"
              className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-text"
            >
              <PanelRightClose size={18} aria-hidden />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-3" role="tabpanel">
            {tab === "chat" ? (
              view.chat ? (
                <ChatPanel view={view} send={send} />
              ) : (
                <p className="text-sm text-muted">{view.settings.chat ? "Chat isn't available to you here." : "The owner turned chat off."}</p>
              )
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <LogLines view={view} compact />
              </div>
            )}
          </div>
        </aside>
      )}
      </div>
      {wide && !sidebarOpen && (
        <button
          type="button"
          onClick={() => toggleSidebar(true)}
          aria-label={unread > 0 ? `Show chat (${unread} new)` : "Show chat and log"}
          className="fixed right-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-lg border border-r-0 border-white/15 bg-chrome-2 px-2 py-3 text-xs font-semibold text-white/80 hover:text-white"
        >
          <MessageSquare size={18} aria-hidden />
          {unread > 0 ? <span className="rounded-full bg-gold px-1.5 text-ink">{unread}</span> : "Chat"}
        </button>
      )}

      {dialog?.kind === "options" && (
        <OptionsSheet
          view={view}
          unread={unread}
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
      {dialog?.kind === "chat" && (
        <Modal title="Chat" onClose={close}>
          <div className="flex h-[min(60dvh,28rem)] flex-col">
            <ChatPanel view={view} send={send} autoFocus={!wide} />
          </div>
        </Modal>
      )}
      {view.you.codeRequired && !view.you.blocked && <JoinCodeDialog send={send} />}
      {view.you.blocked && (
        <Modal title="Removed from this table">
          <p className="text-sm text-muted">The owner removed you from this table. You can&apos;t take a seat, chat or watch here.</p>
          <Link href="/" className="mt-4 inline-flex min-h-11 items-center font-semibold text-gold">
            Back to GaragePoker
          </Link>
        </Modal>
      )}
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
      {view.status === "ended" && !dialog && !replay && !finalLedgerClosed && (
        <LedgerDialog view={view} onClose={() => setFinalLedgerClosed(true)} />
      )}
      {replay && <ReplayDialog key={replay.hand} replay={replay} displayCents={view.settings.displayCents} onClose={closeReplay} />}

      {/* Toasts: server errors and notices, announced to screen readers. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-[calc(4.5rem+env(safe-area-inset-top))] z-50 flex flex-col items-center gap-2 px-3"
        role="status"
        aria-live="polite"
      >
        {view.you.notice && (
          <div className="pointer-events-auto rounded-xl border border-gold/40 bg-panel px-4 py-2 text-sm shadow-xl">{view.you.notice}</div>
        )}
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto min-h-11 rounded-xl border bg-panel px-4 py-2 text-sm text-text shadow-xl ${
              t.tone === "error" ? "border-danger/60" : "border-line"
            }`}
          >
            {t.tone === "error" && <span className="sr-only">Error: </span>}
            {t.message}
          </button>
        ))}
      </div>
    </div>
  );
}

type SideTab = "chat" | "log";
const SIDE_TABS: { id: SideTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "log", label: "Log" },
];

const SIDEBAR_KEY = "gp.sidebar";
function readSidebarPref(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "closed";
  } catch {
    return true;
  }
}
function writeSidebarPref(open: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? "open" : "closed");
  } catch {
    // Private mode: it just isn't remembered.
  }
}

/** The table has a join code: ask for it before showing anything. */
function JoinCodeDialog({ send }: { send: Send }) {
  const [code, setCode] = useState("");
  return (
    <Modal title="This table needs a code">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) send({ type: "enterJoinCode", code: code.trim() });
        }}
      >
        <p className="text-sm text-muted">Ask the person who sent you the link for the table&apos;s join code.</p>
        <input
          className={`${inputClass} min-h-11`}
          value={code}
          autoFocus
          maxLength={12}
          autoCapitalize="none"
          autoComplete="off"
          aria-label="Join code"
          placeholder="Join code"
          onChange={(e) => setCode(e.target.value)}
        />
        <Button type="submit" variant="primary" className="min-h-11" disabled={!code.trim()}>
          Enter
        </Button>
      </form>
    </Modal>
  );
}
