"use client";

import type { TableSettings } from "@garagepoker/engine";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { createTable, TABLE_ID } from "@/lib/server";
import { BUILT_IN_PRESETS, deletePreset, loadSavedPresets, savePreset, type TablePreset } from "@/lib/tablePresets";
import { getPlayerToken } from "@/lib/token";
import { SettingsForm } from "./SettingsForm";
import { Button, inputClass } from "./ui";

const PRESETS_CHANGED = "gp-presets-changed";
const subscribePresets = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(PRESETS_CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PRESETS_CHANGED, onChange);
  };
};
const readPresetsRaw = () => {
  try {
    return localStorage.getItem("gp.presets") ?? "";
  } catch {
    return "";
  }
};

/** Your saved presets, from this browser; empty while rendering on the server. */
function useSavedPresets(): TablePreset[] {
  const raw = useSyncExternalStore(subscribePresets, readPresetsRaw, () => "");
  // (raw only drives re-reading; loadSavedPresets validates every entry.)
  return useMemo(() => (raw ? loadSavedPresets() : []), [raw]);
}

const CUSTOM = "custom";

/**
 * Create a private table: pick a quick start (or your own saved preset),
 * adjust the essentials, create. Advanced settings are folded away, with a
 * summary of each; "Custom" opens them all.
 */
export function CreateTable() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useSavedPresets();
  const presets = [...BUILT_IN_PRESETS, ...saved];
  const [picked, setPicked] = useState<{ id: string; base: string }>({ id: BUILT_IN_PRESETS[0]!.id, base: BUILT_IN_PRESETS[0]!.id });
  const base = presets.find((p) => p.id === picked.base) ?? BUILT_IN_PRESETS[0]!;

  const create = async (settings: TableSettings) => {
    setBusy(true);
    setError(null);
    try {
      const id = await createTable(getPlayerToken(), settings);
      router.push(`/t/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the table");
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Quick start</legend>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <PresetChip
              key={p.id}
              preset={p}
              active={picked.id === p.id}
              onPick={() => setPicked({ id: p.id, base: p.id })}
              onDelete={
                p.id.startsWith("saved-")
                  ? () => {
                      deletePreset(p.id);
                      notifyPresets();
                    }
                  : undefined
              }
            />
          ))}
          <button
            type="button"
            aria-pressed={picked.id === CUSTOM}
            onClick={() => setPicked((x) => ({ id: CUSTOM, base: x.base }))}
            className={`min-h-11 rounded-full border px-4 text-sm ${picked.id === CUSTOM ? "border-gold bg-gold/15 font-semibold" : "border-line bg-ink"}`}
          >
            Custom
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">{picked.id === CUSTOM ? "Every setting, starting from " + base.name + "." : base.detail}</p>
      </fieldset>

      <SettingsForm
        // A new quick start resets the form; Custom keeps what you've set and opens every section.
        key={picked.base}
        initial={base.settings}
        sectionsOpen={picked.id === CUSTOM}
        submitLabel="Create private table"
        onSubmit={create}
        busy={busy}
        extraActions={(settings, invalid) => <SavePreset settings={settings} disabled={invalid} />}
        footer={
          error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger-text">{error}</p>
        }
      />
    </div>
  );
}

/** Tells useSavedPresets the list changed (the storage event only fires in other tabs). */
const notifyPresets = () => window.dispatchEvent(new Event(PRESETS_CHANGED));

function PresetChip({ preset, active, onPick, onDelete }: { preset: TablePreset; active: boolean; onPick: () => void; onDelete?: () => void }) {
  return (
    <span className={`flex items-center rounded-full border ${active ? "border-gold bg-gold/15" : "border-line bg-ink"}`}>
      <button type="button" aria-pressed={active} onClick={onPick} className={`min-h-11 px-4 text-sm ${active ? "font-semibold" : ""}`}>
        {preset.name}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete preset ${preset.name}`}
          className="-ml-2 flex h-11 w-9 items-center justify-center text-muted hover:text-text"
        >
          ✕
        </button>
      )}
    </span>
  );
}

/** "Save these settings as a preset": kept in this browser for next time. */
function SavePreset({ settings, disabled }: { settings: TableSettings; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [done, setDone] = useState<string | null>(null);
  if (!editing) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setEditing(true);
            setDone(null);
          }}
          className="min-h-11 px-2 text-gold underline-offset-2 hover:underline disabled:opacity-40"
        >
          Save these settings as a preset
        </button>
        {done && <span className="text-muted" role="status">Saved “{done}”</span>}
      </div>
    );
  }
  const save = () => {
    const clean = name.trim() || "My game";
    savePreset(clean, settings);
    notifyPresets();
    setEditing(false);
    setName("");
    setDone(clean);
  };
  return (
    <div className="flex gap-2">
      <input
        className={inputClass}
        autoFocus
        maxLength={40}
        placeholder="Preset name, e.g. Friday PLO"
        aria-label="Preset name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button onClick={save} className="min-h-11">
        Save
      </Button>
      <Button variant="ghost" onClick={() => setEditing(false)} className="min-h-11">
        Cancel
      </Button>
    </div>
  );
}

/** Paste a table link or its 10-character code. */
export function JoinTable() {
  const router = useRouter();
  const [text, setText] = useState("");
  // Last path segment. (Not .at(-1): Array.prototype.at needs iOS 15.4+.)
  const parts = text.trim().split("/").filter(Boolean);
  const id = parts[parts.length - 1] ?? "";
  const valid = TABLE_ID.test(id);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/t/${id}`);
      }}
    >
      <input
        className={inputClass}
        placeholder="Table link or code"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Table link or code"
      />
      <Button type="submit" disabled={!valid}>
        Join
      </Button>
    </form>
  );
}

