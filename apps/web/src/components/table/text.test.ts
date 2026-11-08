import { describe, expect, it } from "vitest";
import { DEV_STATES } from "@/dev/tableStates";
import { DEFAULT_SETTINGS } from "@garagepoker/engine";
import { extraRules, turnHint } from "./Learn";
import { resultSummary } from "./tableText";

const state = (id: string) => DEV_STATES.find((s) => s.id === id)!.view;

describe("Learn mode hints", () => {
  it("say what you can do from your own legal actions", () => {
    expect(turnHint(state("b"))).toBe("Call 0.10 to stay in, raise to between 0.40 and 20.00, or fold.");
    // PLO facing a bet: the pot limit is named.
    expect(turnHint(state("d"))).toBe("Call 40 to stay in, raise to between 80 and 240 (pot limit), or fold.");
    // Nothing when it isn't your turn.
    expect(turnHint(state("e"))).toBeNull();
  });
});

describe("result summary", () => {
  it("adds a 7-2 bounty when one was paid", () => {
    const v = state("h");
    expect(resultSummary(v, v.lastHand!)).toBe("anshi wins 8.40");
    expect(resultSummary(v, { ...v.lastHand!, bounty: { seat: 1, nickname: "anshi", amount: 40 } })).toBe(
      "anshi wins 8.40 · 7-2 bounty: anshi +0.40",
    );
  });
});

describe("Learn mode rules text", () => {
  it("explains red river when on", () => {
    const on = extraRules({ ...DEFAULT_SETTINGS, redRiver: true });
    expect(on.some((r) => r.includes("Red river") && r.includes("betting"))).toBe(true);
    expect(on.some((r) => r.includes("Hands use the whole board, however long."))).toBe(true);
  });
  it("says nothing about red river when off", () => {
    expect(extraRules({ ...DEFAULT_SETTINGS, redRiver: false }).some((r) => r.includes("Red river"))).toBe(false);
  });
  it("says nothing about red river for Tic-Tac-Toe", () => {
    expect(extraRules({ ...DEFAULT_SETTINGS, variant: "TICTACTOE", redRiver: true }).some((r) => r.includes("Red river"))).toBe(false);
  });
});
