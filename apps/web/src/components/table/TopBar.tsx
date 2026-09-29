"use client";

import type { ClientMessage, TableView } from "@garagepoker/protocol";
import { LogOut, Menu, Pause, PersonStanding, Play, Square, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

type Send = (m: Exclude<ClientMessage, { type: "hello" }>) => void;

const SOUND_KEY = "gp.sound";

const soundListeners = new Set<() => void>();
/** Used when storage is blocked (private mode): the choice lasts until reload. */
let soundFallback = true;
function readSound(): boolean {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === null ? soundFallback : v !== "off";
  } catch {
    return soundFallback;
  }
}

/** Sound on/off, remembered in this browser. There are no sounds yet: it only shows the choice. */
function useSoundPref(): [boolean, () => void] {
  const on = useSyncExternalStore(
    (l) => {
      soundListeners.add(l);
      return () => soundListeners.delete(l);
    },
    readSound,
    () => true,
  );
  const toggle = () => {
    soundFallback = !on;
    try {
      localStorage.setItem(SOUND_KEY, on ? "off" : "on");
    } catch {
      // Not remembered, but still toggles.
    }
    soundListeners.forEach((l) => l());
  };
  return [on, toggle];
}

/** Two taps: the first arms it (for 3 s), the second confirms. */
function useTwoTap(onConfirm: () => void): [boolean, () => void, () => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const tap = () => {
    if (armed) onConfirm();
    setArmed(!armed);
  };
  return [armed, tap, () => setArmed(false)];
}

/** An icon with a small uppercase label under it. */
function LabeledIcon({
  icon,
  label,
  onClick,
  tone = "default",
  badge = false,
  pressed,
  onBlur,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone?: "default" | "gold" | "danger";
  badge?: boolean;
  pressed?: boolean;
  onBlur?: () => void;
}) {
  const color = tone === "gold" ? "text-gold" : tone === "danger" ? "text-[#f87171]" : "text-white/85";
  return (
    <button
      type="button"
      onClick={onClick}
      onBlur={onBlur}
      aria-pressed={pressed}
      className={`relative flex h-14 min-w-14 flex-col items-center justify-center gap-1 rounded-lg px-1 hover:bg-white/5 ${color}`}
    >
      {icon}
      <span className={`whitespace-nowrap text-[10px] font-semibold uppercase leading-none tracking-wide ${tone === "default" ? "text-white/55" : ""}`}>{label}</span>
      {badge && <span className="absolute right-2 top-1.5 h-2.5 w-2.5 rounded-full bg-[#ef4444]" aria-label="Pending requests" />}
    </button>
  );
}

function SquareIcon({
  label,
  onClick,
  tone = "default",
  onBlur,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "default" | "gold" | "danger";
  onBlur?: () => void;
  children: ReactNode;
}) {
  const color =
    tone === "gold" ? "border-gold/70 text-gold" : tone === "danger" ? "border-[#ef4444] bg-[#ef4444]/15 text-[#f87171]" : "border-white/20 text-white/85";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onBlur={onBlur}
      className={`flex h-10 min-w-10 items-center justify-center gap-1 rounded-md border px-2 text-xs font-semibold uppercase hover:bg-white/5 ${color}`}
    >
      {children}
    </button>
  );
}

export function TopBar({ view, send, onOptions }: { view: TableView; send: Send; onOptions: () => void }) {
  const me = view.you.seat !== null ? view.seats[view.you.seat - 1] : null;
  const live = view.status !== "ended";
  const [sound, toggleSound] = useSoundPref();
  const [leaveArmed, leaveTap, leaveDisarm] = useTwoTap(() => send({ type: "leaveSeat" }));
  const [endArmed, endTap, endDisarm] = useTwoTap(() => send({ type: "endGame" }));
  const owner = view.you.isOwner && live;

  return (
    <header className="flex shrink-0 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]" style={{ minHeight: 64 }}>
      <nav className="flex items-center" aria-label="Table">
        <LabeledIcon icon={<Menu size={22} />} label="Options" onClick={onOptions} badge={(view.requests?.length ?? 0) > 0} />
        {me && live && (
          <LabeledIcon
            icon={<LogOut size={22} />}
            label={leaveArmed ? "Tap again" : "Leave seat"}
            tone={leaveArmed ? "danger" : "default"}
            onClick={leaveTap}
            onBlur={leaveDisarm}
          />
        )}
        {me && live && (
          <LabeledIcon
            icon={<PersonStanding size={22} />}
            label={me.away ? "I'm back" : "Away"}
            tone={me.away ? "gold" : "default"}
            pressed={me.away}
            onClick={() => send({ type: "setAway", away: !me.away })}
          />
        )}
      </nav>
      <div className="hidden min-w-0 flex-1 justify-center overflow-hidden min-[400px]:flex">
        <Link href="/" className="text-lg font-black tracking-tight text-white/90" aria-label="GaragePoker home">
          G<span className="text-gold">P</span>
        </Link>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <SquareIcon label={sound ? "Sound on" : "Sound off"} onClick={toggleSound}>
          {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </SquareIcon>
        {owner &&
          (view.status === "paused" ? (
            <SquareIcon label={view.handNumber === 0 ? "Start game" : "Resume"} tone="gold" onClick={() => send({ type: "startGame" })}>
              <Play size={18} />
            </SquareIcon>
          ) : view.pauseRequested ? (
            <SquareIcon label="Pausing after this hand (tap to keep playing)" tone="gold" onClick={() => send({ type: "startGame" })}>
              <Pause size={18} />
            </SquareIcon>
          ) : (
            <SquareIcon label="Pause after this hand" onClick={() => send({ type: "pauseGame" })}>
              <Pause size={18} />
            </SquareIcon>
          ))}
        {owner && (
          <SquareIcon
            label={view.endRequested ? "Ending after this hand" : endArmed ? "Tap again to end the game" : "End game"}
            tone={endArmed || view.endRequested ? "danger" : "default"}
            onClick={view.endRequested ? () => {} : endTap}
            onBlur={endDisarm}
          >
            <Square size={16} />
            {endArmed && <span>End?</span>}
          </SquareIcon>
        )}
      </div>
    </header>
  );
}
