"use client";

import type { ClientMessage, SeatView, TableView } from "@garagepoker/protocol";
import { useState } from "react";
import { chipsToInput, formatChips } from "@/lib/chips";
import { SettingsForm } from "../SettingsForm";
import { Button, ChipInput, ConfirmButton, Modal } from "../ui";

type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;
export type OwnerTab = "settings" | "players";

export function OwnerMenu({ view, send, onClose, tab: initialTab }: { view: TableView; send: Send; onClose: () => void; tab: OwnerTab }) {
  const [tab, setTab] = useState<OwnerTab>(initialTab);
  return (
    <Modal title="Owner menu" onClose={onClose} wide>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-ink p-1" role="tablist">
        {(["settings", "players"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg py-2 text-sm ${tab === t ? "bg-panel-2 font-semibold" : "text-muted"}`}
          >
            {t === "settings" ? "Table settings" : "Players"}
          </button>
        ))}
      </div>
      {tab === "settings" && <SettingsTab view={view} send={send} />}
      {tab === "players" && <PlayersTab view={view} send={send} />}
    </Modal>
  );
}

function SettingsTab({ view, send }: { view: TableView; send: Send }) {
  const highest = view.seats.reduce((max, s, i) => (s ? i + 1 : max), 0);
  return (
    <div className="flex flex-col gap-3">
      {view.pendingSettings && (
        <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm">New settings are saved and apply from the next hand.</p>
      )}
      <SettingsForm
        key={view.pendingSettings ? "pending" : "current"}
        initial={view.pendingSettings ?? view.settings}
        highestOccupiedSeat={highest}
        submitLabel={view.hand ? "Save for next hand" : "Save settings"}
        onSubmit={(settings) => send({ type: "updateSettings", settings })}
      />
    </div>
  );
}

function PlayersTab({ view, send }: { view: TableView; send: Send }) {
  const seated = view.seats.filter((s): s is SeatView => s !== null);
  if (seated.length === 0) return <p className="text-sm text-muted">Nobody is seated yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">Every change is written to the ledger. Changes to players in a hand apply when it ends.</p>
      {seated.map((s) => (
        <PlayerRow key={s.playerId} seat={s} view={view} send={send} />
      ))}
    </div>
  );
}

function PlayerRow({ seat, view, send }: { seat: SeatView; view: TableView; send: Send }) {
  const dc = view.settings.displayCents;
  const [text, setText] = useState(chipsToInput(view.settings.bigBlind * 100, dc));
  const [amount, setAmount] = useState<number | null>(view.settings.bigBlind * 100);
  const isMe = seat.playerId === view.you.playerId;
  const adjust = (op: "add" | "remove" | "set") => amount !== null && send({ type: "adjustStack", playerId: seat.playerId, op, amount });

  return (
    <div className="rounded-xl border border-line bg-ink p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold">
          {seat.isOwner && "★ "}
          {seat.nickname} <span className="text-xs font-normal text-muted">seat {seat.seat}</span>
        </span>
        <span className="tabular font-bold text-gold">{formatChips(seat.stack, dc)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ChipInput
          centMode={dc}
          className="w-24"
          text={text}
          ariaLabel={`Amount for ${seat.nickname}`}
          onText={(t, c) => {
            setText(t);
            setAmount(c);
          }}
        />
        <Button disabled={!amount} onClick={() => adjust("add")}>
          Add
        </Button>
        <Button disabled={!amount} onClick={() => adjust("remove")}>
          Remove
        </Button>
        <Button disabled={amount === null} onClick={() => adjust("set")}>
          Set
        </Button>
      </div>
      {!isMe && (
        <div className="mt-2 flex flex-wrap gap-2">
          <ConfirmButton
            label={seat.leaving ? "Leaving after hand" : "Kick"}
            confirm={`Kick ${seat.nickname}?`}
            onConfirm={() => send({ type: "kick", playerId: seat.playerId })}
          />
          <ConfirmButton
            label="Make owner"
            confirm="Tap again to hand over"
            variant="secondary"
            onConfirm={() => send({ type: "transferOwnership", playerId: seat.playerId })}
          />
        </div>
      )}
    </div>
  );
}
