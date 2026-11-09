import { validateConfig } from "@garagepoker/engine";
import { beforeEach, describe, expect, it } from "vitest";
import { BUILT_IN_PRESETS, deletePreset, loadSavedPresets, savePreset } from "./tablePresets";

/** A localStorage stand-in for Node. */
beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe("table presets", () => {
  it("every quick start is a valid table", () => {
    for (const p of BUILT_IN_PRESETS) expect(validateConfig(p.settings), p.name).toEqual([]);
  });

  it("saves, replaces by name, lists newest first and deletes", () => {
    savePreset("Friday PLO", { ...BUILT_IN_PRESETS[2]!.settings });
    savePreset("Casual", { ...BUILT_IN_PRESETS[0]!.settings });
    savePreset("friday plo", { ...BUILT_IN_PRESETS[2]!.settings, bigBlind: 40, smallBlind: 20 });
    const saved = loadSavedPresets();
    expect(saved.map((p) => p.name)).toEqual(["friday plo", "Casual"]);
    expect(saved[0]!.settings.bigBlind).toBe(40);
    deletePreset(saved[0]!.id);
    expect(loadSavedPresets().map((p) => p.name)).toEqual(["Casual"]);
  });

  it("skips anything unreadable or invalid in storage", () => {
    localStorage.setItem(
      "gp.presets",
      JSON.stringify([
        { id: "saved-a", name: "ok", settings: { variant: "PLO" } },
        { id: "saved-b", name: "bad blinds", settings: { smallBlind: 50, bigBlind: 20 } },
        { id: 7, name: "no id" },
        "junk",
      ]),
    );
    expect(loadSavedPresets().map((p) => p.name)).toEqual(["ok"]);
    localStorage.setItem("gp.presets", "{not json");
    expect(loadSavedPresets()).toEqual([]);
  });

  it("a saved preset without redRiver loads with it off", () => {
    const { redRiver: _drop, ...old } = BUILT_IN_PRESETS[0]!.settings;
    localStorage.setItem("gp.presets", JSON.stringify([{ id: "old", name: "Old", settings: old }]));
    const saved = loadSavedPresets();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.settings.redRiver).toBe(false);
  });
});
