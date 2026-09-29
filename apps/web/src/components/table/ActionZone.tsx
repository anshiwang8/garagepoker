"use client";

import { raisePresets, VARIANTS } from "@garagepoker/engine";
import type { ClientMessage, TableView } from "@garagepoker/protocol";
import { Minus, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { chipsToInput, formatChips, parseChips } from "@/lib/chips";
import { DiscardPicker } from "./DiscardPicker";
import { byRank, rankText } from "./PlayingCard";
import { RunItTwicePrompt } from "./RunItTwicePrompt";
import { showingResult, waitingText } from "./tableText";

type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

/**
 * The bottom action zone (SPEC §7): exactly one of a prompt, the action row,
 * the raise panel, the show-cards bar or a status pill.
 */
export function ActionZone({
  view,
  send,
  now,
  initialRaising = false,
}: {
  view: TableView;
  send: Send;
  now: number;
  /** Dev states only: open with the raise panel showing. */
  initialRaising?: boolean;
}) {
  const [raising, setRaising] = useState<{ hand: number; open: boolean }>({ hand: view.handNumber, open: initialRaising });
  const hand = view.hand;
  const legal = view.you.legal;
  const me = view.you.seat !== null ? view.seats[view.you.seat - 1] : null;

  if (view.you.request) {
    return (
      <Pill>
        Waiting for the owner to approve your {view.you.request.kind === "seat" ? "seat" : "rebuy"}…
        <button type="button" className="ml-2 font-semibold text-gold" onClick={() => send({ type: "cancelRequest" })}>
          Cancel
        </button>
      </Pill>
    );
  }
  if (hand?.discard && me) return <DiscardPicker view={view} send={send} now={now} />;
  if (hand?.ritOffer) return <RunItTwicePrompt view={view} send={send} now={now} />;

  if (hand && legal && me) {
    const open = raising.open && raising.hand === view.handNumber && legal.canRaise;
    const act = (action: Extract<ClientMessage, { type: "act" }>["action"]) => {
      setRaising({ hand: view.handNumber, open: false });
      send({ type: "act", hand: view.handNumber, action });
    };
    if (open) {
      return <RaisePanel view={view} onBack={() => setRaising({ hand: view.handNumber, open: false })} onRaise={(to) => act({ type: "raise", to })} />;
    }
    const dc = view.settings.displayCents;
    const callAllIn = legal.callAmount > 0 && legal.callAmount >= me.stack;
    return (
      <div className="ml-auto flex w-[80%] max-w-[34rem] gap-2" role="group" aria-label="Your turn">
        <ActButton tone="green" disabled={!legal.canRaise} onClick={() => setRaising({ hand: view.handNumber, open: true })}>
          {hand.currentBet === 0 ? "Bet" : "Raise"}
        </ActButton>
        {legal.canCheck ? (
          <ActButton tone="green" onClick={() => act({ type: "check" })}>
            Check
          </ActButton>
        ) : (
          <ActButton tone="green" onClick={() => act({ type: "call" })} sub={formatChips(legal.callAmount, dc)}>
            {callAllIn ? "Call all in" : "Call"}
          </ActButton>
        )}
        <ActButton tone="red" onClick={() => act({ type: "fold" })}>
          Fold
        </ActButton>
      </div>
    );
  }

  if (showingResult(view) && me && canShowCards(view)) return <ShowCardsBar view={view} send={send} />;
  if (view.status === "paused" && view.you.isOwner && !hand) {
    return (
      <div className="ml-auto flex w-[80%] max-w-[34rem]">
        <ActButton tone="gold" onClick={() => send({ type: "startGame" })}>
          {view.handNumber === 0 ? "Start game" : "Resume game"}
        </ActButton>
      </div>
    );
  }
  const text = hand
    ? waitingText(view)
    : showingResult(view)
      ? "Hand over"
      : view.status === "paused" && !view.you.isOwner
        ? view.handNumber === 0
          ? "Waiting for the owner to start"
          : "Paused by owner"
        : view.you.seat === null && view.status !== "ended" && !view.you.watchBlocked
          ? "Tap Sit to join the game"
          : null;
  return text ? <Pill>{text}</Pill> : null;
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center lg:justify-end">
      <div className="flex items-center rounded-full border border-white/12 bg-[#232323] px-4 py-2.5 text-sm text-white/85 shadow-lg" role="status">
        {children}
      </div>
    </div>
  );
}

const TONES = {
  green: "bg-transparent border-[#22c55e] text-[#4ade80] active:bg-[#22c55e] active:text-[#052e16]",
  red: "bg-transparent border-[#ef4444] text-[#f87171] active:bg-[#ef4444] active:text-white",
  gold: "bg-transparent border-gold text-gold active:bg-gold active:text-ink",
  grey: "bg-transparent border-white/25 text-white/80 active:bg-white/20",
  greenFilled: "border-[#22c55e] bg-[#22c55e] text-[#052e16] active:bg-[#16a34a]",
};

/** A big outlined action button; pressed, it fills. Disabled stays visible, dimmed. */
function ActButton({
  tone,
  sub,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone: keyof typeof TONES; sub?: string }) {
  return (
    <button
      type="button"
      className={`flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-lg border-[1.5px] px-1.5 font-semibold uppercase leading-tight tracking-wide transition-colors disabled:pointer-events-none disabled:opacity-30 ${TONES[tone]} ${className}`}
      {...props}
    >
      <span className="text-base">{children}</span>
      {sub && <span className="tabular text-[15px]">{sub}</span>}
    </button>
  );
}

/** "2BB", "7.5BB": the amount in big blinds, to one decimal (integer maths). */
function inBigBlinds(amount: number, bb: number): string {
  const tenths = Math.round((amount * 10) / bb);
  return `${Math.floor(tenths / 10)}${tenths % 10 ? `.${tenths % 10}` : ""}BB`;
}

function RaisePanel({ view, onBack, onRaise }: { view: TableView; onBack: () => void; onRaise: (to: number) => void }) {
  const legal = view.you.legal!;
  const hand = view.hand!;
  const { settings } = view;
  const dc = settings.displayCents;
  const me = view.seats[view.you.seat! - 1]!;
  const min = legal.minRaiseTo;
  const max = legal.maxRaiseTo;
  const allInTo = me.bet + me.stack;
  const potLimit = VARIANTS[settings.variant].betting === "PL";
  // SPEC §7: big-blind multiples preflop until someone raises; pot fractions otherwise.
  const unopened = hand.street === "preflop" && !view.seats.some((s) => s?.inHand && s.lastAction?.type === "raise");
  const presets = raisePresets({
    unopened,
    bigBlind: settings.bigBlind,
    pot: hand.pot,
    currentBet: hand.currentBet,
    callAmount: legal.callAmount,
    minRaiseTo: min,
    maxRaiseTo: max,
    allInTo,
    potLimit,
  });
  // The table's natural step: a big blind, or the small blind in cent mode.
  const step = dc && settings.smallBlind > 0 ? settings.smallBlind : settings.bigBlind;

  const [amount, setAmount] = useState(min);
  const [text, setText] = useState(chipsToInput(min, dc));
  const [typedBad, setTypedBad] = useState(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const choose = (to: number) => {
    const v = clamp(to);
    setAmount(v);
    setText(chipsToInput(v, dc));
    setTypedBad(false);
  };
  const error = typedBad
    ? "Enter an amount"
    : amount < min
      ? `The minimum is ${formatChips(min, dc)}`
      : amount > max
        ? potLimit && max < allInTo
          ? `The pot limit is ${formatChips(max, dc)}`
          : `You can bet at most ${formatChips(max, dc)}`
        : null;
  const verb = amount === allInTo ? "All in" : hand.currentBet === 0 ? "Bet" : "Raise";

  return (
    <div className="ml-auto flex w-full max-w-[35rem] gap-3" role="group" aria-label="Raise">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] text-white/55">Your bet</span>
          <span className={`relative flex h-14 items-center rounded-lg border bg-[#1c1c1c] px-3 ${error ? "border-[#ef4444]" : "border-white/12"}`}>
            <input
              inputMode={dc ? "decimal" : "numeric"}
              autoComplete="off"
              aria-label="Bet amount"
              aria-invalid={!!error}
              className="tabular w-full min-w-0 bg-transparent pr-12 text-[34px] font-bold leading-none text-white outline-none"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                const cents = parseChips(e.target.value, dc);
                setTypedBad(cents === null);
                if (cents !== null) setAmount(cents);
              }}
              onBlur={() => !typedBad && choose(amount)}
            />
            <span className="absolute right-1.5 top-1.5 rounded bg-gold px-1.5 py-0.5 text-[11px] font-bold leading-none text-ink">
              {inBigBlinds(amount, settings.bigBlind)}
            </span>
          </span>
        </label>
        {error && (
          <p className="-mt-1 text-xs text-[#f87171]" role="alert">
            {error}
          </p>
        )}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => choose(p.to)}
              className={`min-h-9 rounded-md border px-0.5 text-[10.5px] font-semibold uppercase leading-tight tracking-wide ${
                amount === p.to ? "border-gold bg-gold/15 text-gold" : "border-white/15 bg-[#232323] text-white/85"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <StepButton label="Less" onClick={() => choose(amount - step)} disabled={amount <= min}>
            <Minus size={18} />
          </StepButton>
          <input
            type="range"
            className="bet-slider min-w-0 flex-1"
            min={min}
            max={max}
            step={1}
            value={clamp(amount)}
            aria-label="Bet amount"
            onChange={(e) => choose(Number(e.target.value))}
          />
          <StepButton label="More" onClick={() => choose(amount + step)} disabled={amount >= max}>
            <Plus size={18} />
          </StepButton>
        </div>
      </div>
      <div className="flex w-[6.5rem] shrink-0 flex-col gap-2">
        <ActButton tone="grey" className="flex-none" onClick={onBack}>
          Back
        </ActButton>
        <ActButton tone="greenFilled" disabled={!!error} onClick={() => onRaise(amount)} sub={formatChips(amount, dc)}>
          {verb}
        </ActButton>
      </div>
    </div>
  );
}

function StepButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/15 bg-[#232323] text-white active:bg-white/20 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Suit colours that read on the dark action zone. */
const LIGHT_SUIT: Record<string, { symbol: string; color: string }> = {
  s: { symbol: "♠", color: "#f4f4f5" },
  h: { symbol: "♥", color: "#f87171" },
  d: { symbol: "♦", color: "#60a5fa" },
  c: { symbol: "♣", color: "#4ade80" },
};

const myShown = (view: TableView) => view.lastHand!.showed.filter((s) => s.seat === view.you.seat).flatMap((s) => s.cards);
/** You were dealt in and your hand wasn't shown down: you get the show-cards bar. */
const canShowCards = (view: TableView) => (view.you.showable?.length ?? 0) > 0 || myShown(view).length > 0;

/**
 * After a hand, until the next deal: show your cards to everyone. Each tap is
 * final (SPEC §7). Null when you have nothing to show.
 */
function ShowCardsBar({ view, send }: { view: TableView; send: Send }) {
  const last = view.lastHand!;
  const showable = view.you.showable ?? [];
  const shown = myShown(view);
  const cards = [...shown, ...showable].sort(byRank);
  const show = (cs: string[]) => send({ type: "showCards", hand: last.number, cards: cs });
  return (
    <div className="ml-auto flex w-full max-w-[34rem] gap-2" role="group" aria-label="Show your cards">
      <ActButton tone="green" className={cards.length > 2 ? "flex-[1.6]" : "flex-[1.4]"} disabled={showable.length === 0} onClick={() => show(showable)}>
        <span className={cards.length > 2 ? "" : "text-[15px]"}>{cards.length > 2 ? "Show all" : "Show all cards"}</span>
      </ActButton>
      {cards.map((c) => {
        const done = !showable.includes(c);
        const suit = LIGHT_SUIT[c[1]!]!;
        return (
          <ActButton key={c} tone="green" disabled={done} onClick={() => show([c])} aria-label={done ? `${c} shown` : `Show ${c}`}>
            {done ? (
              <span className="text-[13px]">Shown</span>
            ) : (
              <span className="text-lg normal-case" style={{ color: suit.color }}>
                {rankText(c)}
                {suit.symbol}
              </span>
            )}
          </ActButton>
        );
      })}
    </div>
  );
}
