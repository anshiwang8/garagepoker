"use client";

import { shortHash, type LogEntryView, type TableView } from "@garagepoker/protocol";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { copyText, Modal } from "../ui";
import { actionText } from "./Seat";
import { showingResult } from "./tableText";

export type OptionsItem = "ledger" | "replay" | "log" | "rebuy" | "settings" | "players";

/** The Options sheet (SPEC §7): everything that isn't on the table itself. */
export function OptionsSheet({ view, onPick, onClose }: { view: TableView; onPick: (item: OptionsItem) => void; onClose: () => void }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const me = view.you.seat !== null ? view.seats[view.you.seat - 1] : null;
  const live = view.status !== "ended";
  const requests = view.requests?.length ?? 0;
  const facts = [
    view.handNumber > 0 && `Hand ${view.handNumber}`,
    view.hand?.commitment && `deck ${shortHash(view.hand.commitment)}`,
    view.spectators > 0 && `${view.spectators} watching`,
  ].filter(Boolean);

  return (
    <Modal title="Options" onClose={onClose}>
      <div className="-mx-2 flex flex-col">
        <Row onClick={() => onPick("ledger")}>Ledger</Row>
        {view.handNumber > 0 && !view.you.watchBlocked && <Row onClick={() => onPick("replay")}>Last hand</Row>}
        {!view.you.watchBlocked && <Row onClick={() => onPick("log")}>Log</Row>}
        {me && live && view.settings.rebuys && <Row onClick={() => onPick("rebuy")}>Rebuy</Row>}
        {view.you.isOwner && live && <Row onClick={() => onPick("settings")}>Table settings</Row>}
        {view.you.isOwner && live && (
          <Row onClick={() => onPick("players")} note={requests > 0 ? `${requests} waiting` : undefined}>
            Players
          </Row>
        )}
        <Row
          onClick={async () => {
            setCopied((await copyText(window.location.href)) ? "copied" : "failed");
            setTimeout(() => setCopied("idle"), 1500);
          }}
          note={copied === "copied" ? "Copied" : copied === "failed" ? "Couldn't copy: use the address bar" : undefined}
        >
          Copy table link
        </Row>
      </div>
      {facts.length > 0 && <p className="mt-3 text-center font-mono text-[11px] text-muted">{facts.join(" · ")}</p>}
    </Modal>
  );
}

function Row({ onClick, note, children }: { onClick: () => void; note?: string; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-12 items-center gap-2 rounded-lg px-2 text-left text-base hover:bg-panel-2">
      <span className="flex-1">{children}</span>
      {note && <span className="text-sm text-gold">{note}</span>}
      <ChevronRight size={18} className="text-muted" aria-hidden />
    </button>
  );
}

const STREETS: Record<string, string> = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River", complete: "" };

/** This hand's actions (or the last hand's, until the next deal), one per line with a line per street. */
export function handLog(view: TableView): { number: number; log: LogEntryView[] } | null {
  if (view.hand) return { number: view.handNumber, log: view.hand.log };
  if (showingResult(view)) return { number: view.lastHand.number, log: view.lastHand.log };
  return null;
}

export function LogLines({ view, compact = false }: { view: TableView; compact?: boolean }) {
  const current = handLog(view);
  const end = useRef<HTMLLIElement>(null);
  const count = current?.log.length ?? 0;
  useEffect(() => {
    if (compact) end.current?.scrollIntoView({ block: "nearest" });
  }, [compact, count]);
  if (!current || current.log.length === 0) return <p className="text-sm text-muted">No actions yet.</p>;
  const dc = view.settings.displayCents;
  const name = (seat: number) => view.seats[seat - 1]?.nickname ?? `Seat ${seat}`;
  const items: ReactNode[] = [];
  let street = "";
  current.log.forEach((e, i) => {
    if (e.street !== street && STREETS[e.street]) {
      street = e.street;
      items.push(
        <li key={`s${i}`} className={`font-semibold uppercase tracking-wide text-muted ${compact ? "text-[10px]" : "pt-2 text-xs"}`}>
          {STREETS[e.street]}
        </li>,
      );
    }
    items.push(
      <li key={i} className="tabular">
        <span className="font-semibold">{name(e.seat)}</span>: {actionText({ type: e.type, amount: e.amount, to: e.to }, dc)}
        {e.allIn ? " (all in)" : ""}
      </li>,
    );
  });
  return (
    <ol className={compact ? "text-xs leading-snug" : "flex flex-col gap-0.5 text-sm"} aria-label={`Hand ${current.number} log`}>
      {items}
      <li ref={end} aria-hidden />
    </ol>
  );
}

export function LogDialog({ view, onClose }: { view: TableView; onClose: () => void }) {
  const current = handLog(view);
  return (
    <Modal title={current ? `Hand ${current.number} log` : "Log"} onClose={onClose}>
      <LogLines view={view} />
    </Modal>
  );
}
