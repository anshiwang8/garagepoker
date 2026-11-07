import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  handConfigFor,
  isRed,
  parseCard,
  redRiverApplies,
  validateConfig,
} from "../src/index.js";

describe("red river settings", () => {
  it("isRed is true for hearts and diamonds only", () => {
    expect(isRed(parseCard("Ah"))).toBe(true);
    expect(isRed(parseCard("2d"))).toBe(true);
    expect(isRed(parseCard("Ks"))).toBe(false);
    expect(isRed(parseCard("3c"))).toBe(false);
  });

  it("applies to every variant except Tic-Tac-Toe", () => {
    expect(redRiverApplies("NLH")).toBe(true);
    expect(redRiverApplies("PLO")).toBe(true);
    expect(redRiverApplies("SHORT")).toBe(true);
    expect(redRiverApplies("TICTACTOE")).toBe(false);
  });

  it("flows into the hand config, off for Tic-Tac-Toe", () => {
    expect(handConfigFor({ ...DEFAULT_SETTINGS, redRiver: true }).redRiver).toBe(true);
    expect(handConfigFor({ ...DEFAULT_SETTINGS, variant: "TICTACTOE", redRiver: true }).redRiver).toBe(false);
  });

  it("accepts Tic-Tac-Toe with it on, and defaults to off", () => {
    expect(validateConfig({ ...DEFAULT_SETTINGS, variant: "TICTACTOE", redRiver: true })).toEqual([]);
    expect(DEFAULT_SETTINGS.redRiver).toBe(false);
  });
});
