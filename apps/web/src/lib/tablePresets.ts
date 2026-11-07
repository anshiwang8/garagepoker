import { DEFAULT_SETTINGS, type TableSettings, validateConfig } from "@garagepoker/engine";

/** A named starting point for a new table. */
export interface TablePreset {
  id: string;
  name: string;
  detail: string;
  settings: TableSettings;
}

const preset = (id: string, name: string, detail: string, over: Partial<TableSettings>): TablePreset => ({
  id,
  name,
  detail,
  settings: { ...DEFAULT_SETTINGS, ...over },
});

/** Quick starts: every one is a valid configuration (checked by the engine at create time too). */
export const BUILT_IN_PRESETS: TablePreset[] = [
  preset("casual", "Casual Hold'em", "Relaxed timers, rabbit hunt, run it twice on request", {
    variant: "NLH",
    decisionTimeSec: 30,
    timeBankSec: 60,
    runItTwice: "ask",
    rabbitHunt: true,
  }),
  preset("competitive", "Competitive Hold'em", "Brisk timers, no rabbit hunt", {
    variant: "NLH",
    decisionTimeSec: 20,
    timeBankSec: 30,
    runItTwice: "no",
    rabbitHunt: false,
  }),
  preset("omaha", "Omaha Night", "Pot-limit Omaha, run it twice on request", {
    variant: "PLO",
    decisionTimeSec: 30,
    timeBankSec: 60,
    runItTwice: "ask",
    rabbitHunt: true,
  }),
];

const STORAGE_KEY = "gp.presets";
const MAX_SAVED = 12;

/**
 * Presets you saved, from this browser only (no accounts: nothing is stored
 * on the server). Anything unreadable or no longer valid is skipped.
 */
export function loadSavedPresets(): TablePreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x): TablePreset[] => {
      if (!x || typeof x !== "object") return [];
      const { id, name, settings } = x as Partial<TablePreset>;
      if (typeof id !== "string" || typeof name !== "string" || !settings || typeof settings !== "object") return [];
      const merged = { ...DEFAULT_SETTINGS, ...settings };
      if (validateConfig(merged).length > 0) return [];
      return [{ id, name: name.slice(0, 40), detail: "Saved on this device", settings: merged }];
    });
  } catch {
    return [];
  }
}

function store(presets: TablePreset[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(presets.slice(0, MAX_SAVED).map(({ id, name, settings }) => ({ id, name, settings }))),
    );
  } catch {
    // Private mode or storage full: saving presets just doesn't stick.
  }
}

/** Saves (or replaces, by name) a preset; newest first. Returns the new list. */
export function savePreset(name: string, settings: TableSettings): TablePreset[] {
  const clean = name.trim().slice(0, 40) || "My game";
  const rest = loadSavedPresets().filter((p) => p.name.toLowerCase() !== clean.toLowerCase());
  // Unique even for two presets saved in the same millisecond.
  const id = `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const next = [{ id, name: clean, detail: "Saved on this device", settings }, ...rest];
  store(next);
  return next.slice(0, MAX_SAVED);
}

export function deletePreset(id: string): TablePreset[] {
  const next = loadSavedPresets().filter((p) => p.id !== id);
  store(next);
  return next;
}
