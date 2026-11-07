"use client";

import { useSyncExternalStore } from "react";

/**
 * Per-browser look-and-feel preferences (SPEC §7): GaragePoker-branded
 * options only. Kept in localStorage; applied as data attributes on <html>
 * that swap CSS variables (globals.css).
 */
export interface Prefs {
  felt: "green" | "blue" | "burgundy" | "charcoal";
  back: "red" | "navy" | "black";
  /** Four-colour deck (default) or classic two colours. */
  deck: "four" | "two";
  /** Bigger rank and suit in the card corners. */
  cardSize: "standard" | "large";
  /** "reduced" turns off animations even if the system doesn't ask. */
  motion: "system" | "reduced";
  /** Learn mode: a line of help above your actions. */
  learn: boolean;
}

export const DEFAULT_PREFS: Prefs = { felt: "green", back: "red", deck: "four", cardSize: "standard", motion: "system", learn: false };

/** (Also read by PREFS_SCRIPT in prefsScript.ts.) */
const KEY = "gp.prefs";
const CHANGED = "gp-prefs-changed";

const OPTIONS: { [K in keyof Prefs]: readonly Prefs[K][] } = {
  felt: ["green", "blue", "burgundy", "charcoal"],
  back: ["red", "navy", "black"],
  deck: ["four", "two"],
  cardSize: ["standard", "large"],
  motion: ["system", "reduced"],
  learn: [false, true],
};

function parse(raw: string | null): Prefs {
  try {
    const x = JSON.parse(raw ?? "{}") as Partial<Record<keyof Prefs, unknown>>;
    const out = { ...DEFAULT_PREFS };
    for (const k of Object.keys(OPTIONS) as (keyof Prefs)[]) {
      if ((OPTIONS[k] as readonly unknown[]).includes(x[k])) (out as Record<string, unknown>)[k] = x[k];
    }
    return out;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** Puts the preferences on <html> as data attributes. */
export function applyPrefs(p: Prefs): void {
  const el = document.documentElement;
  el.dataset.felt = p.felt;
  el.dataset.back = p.back;
  el.dataset.deck = p.deck;
  el.dataset.cards = p.cardSize;
  el.dataset.motion = p.motion;
}

export function setPrefs(change: Partial<Prefs>): void {
  const next = { ...parse(readRaw()), ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode: applies now, isn't remembered.
  }
  applyPrefs(next);
  window.dispatchEvent(new Event(CHANGED));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
};

/** The current preferences, kept up to date (defaults while rendering on the server). */
export function usePrefs(): Prefs {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  return parse(raw);
}
