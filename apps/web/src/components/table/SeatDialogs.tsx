"use client";

import type { ClientMessage, RequestView, TableView } from "@garagepoker/protocol";
import { useState } from "react";
import { chipsToInput, formatChips } from "@/lib/chips";
import { saveNickname, savedNickname } from "@/lib/token";
import { Button, ChipInput, Field, inputClass, Modal } from "../ui";

type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

/** Tap an empty seat: pick a name and buy-in, then wait for the owner. */
export function SeatRequestDialog({
  view,
  seat,
  send,
  onClose,
}: {
  view: TableView;
  seat: number;
  send: Send;
  onClose: () => void;
}) {
  const dc = view.settings.displayCents;
  const defaultBuyIn = view.settings.bigBlind * 100;
  const [nickname, setNickname] = useState(savedNickname);
  const [text, setText] = useState(chipsToInput(defaultBuyIn, dc));
  const [buyIn, setBuyIn] = useState<number | null>(defaultBuyIn);
  const [postBlind, setPostBlind] = useState(false);
  const started = view.handNumber > 0;
  const name = nickname.trim();
  const valid = name.length >= 1 && name.length <= 20 && !/[<>]/.test(name) && !!buyIn && buyIn > 0;

  return (
    <Modal title={`Sit in seat ${seat}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          saveNickname(name);
          send({ type: "requestSeat", seat, nickname: name, buyIn: buyIn!, postBlind: started && postBlind });
          onClose();
        }}
      >
        <Field label="Your name">
          <input
            className={inputClass}
            value={nickname}
            maxLength={20}
            autoFocus
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Nickname"
          />
        </Field>
        <Field
          label="Buy-in"
          hint={`Blinds ${formatChips(view.settings.smallBlind, dc)}/${formatChips(view.settings.bigBlind, dc)}`}
          error={buyIn === null ? "Enter an amount" : undefined}
        >
          <ChipInput
            centMode={dc}
            text={text}
            ariaLabel="Buy-in"
            onText={(t, cents) => {
              setText(t);
              setBuyIn(cents);
            }}
          />
        </Field>
        {started && (
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">When do you want to play?</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!postBlind} onChange={() => setPostBlind(false)} />
              Wait for the big blind
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={postBlind} onChange={() => setPostBlind(true)} />
              Post a big blind and play next hand
            </label>
          </fieldset>
        )}
        <p className="text-xs text-muted">
          {view.you.isOwner ? "You own this table, so you'll sit right away." : "The table owner approves every seat."}
        </p>
        <Button type="submit" variant="primary" className="py-3" disabled={!valid}>
          {view.you.isOwner ? "Sit down" : "Ask to sit"}
        </Button>
      </form>
    </Modal>
  );
}

export function RebuyDialog({ view, send, onClose }: { view: TableView; send: Send; onClose: () => void }) {
  const initial = view.settings.bigBlind * 100;
  const dc = view.settings.displayCents;
  const [text, setText] = useState(chipsToInput(initial, dc));
  const [amount, setAmount] = useState<number | null>(initial);
  return (
    <Modal title="Rebuy" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!amount) return;
          send({ type: "requestRebuy", amount });
          onClose();
        }}
      >
        <Field label="Amount" hint="Added after the current hand if you're in one." error={amount === null ? "Enter an amount" : undefined}>
          <ChipInput
            centMode={dc}
            text={text}
            autoFocus
            ariaLabel="Rebuy amount"
            onText={(t, c) => {
              setText(t);
              setAmount(c);
            }}
          />
        </Field>
        <Button type="submit" variant="primary" className="py-3" disabled={!amount}>
          {view.you.isOwner ? "Add chips" : "Ask the owner"}
        </Button>
      </form>
    </Modal>
  );
}

/** Owner popup for each pending seat or rebuy request, with the stack editable. */
export function ApprovalPopup({ view, send }: { view: TableView; send: Send }) {
  const requests = view.requests ?? [];
  const request = requests[0];
  if (!request) return null;
  // Keyed by request so the editable amount resets for each one.
  return <Approval key={request.id} request={request} total={requests.length} view={view} send={send} />;
}

function Approval({ request, total, view, send }: { request: RequestView; total: number; view: TableView; send: Send }) {
  const dc = view.settings.displayCents;
  const [text, setText] = useState(chipsToInput(request.amount, dc));
  const [amount, setAmount] = useState<number | null>(request.amount);
  const title = request.kind === "seat" ? "Seat request" : "Rebuy request";
  return (
    <Modal title={total > 1 ? `${title} (1 of ${total})` : title}>
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          <span className="font-semibold">{request.nickname}</span>{" "}
          {request.kind === "seat"
            ? `wants seat ${request.seat} with ${formatChips(request.amount, dc)}${request.postBlind ? " and will post a big blind" : ""}.`
            : `wants to add ${formatChips(request.amount, dc)}.`}
        </p>
        <Field label={request.kind === "seat" ? "Starting stack" : "Amount to add"} error={amount === null ? "Enter an amount" : undefined}>
          <ChipInput
            centMode={dc}
            text={text}
            ariaLabel="Approved amount"
            onText={(t, c) => {
              setText(t);
              setAmount(c);
            }}
          />
        </Field>
        <div className="flex gap-2">
          <Button variant="danger" className="flex-1 py-3" onClick={() => send({ type: "declineRequest", requestId: request.id })}>
            Decline
          </Button>
          <Button
            variant="primary"
            className="flex-[2] py-3"
            disabled={!amount}
            onClick={() => amount && send({ type: "approveRequest", requestId: request.id, stack: amount })}
          >
            Approve {amount ? formatChips(amount, dc) : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
