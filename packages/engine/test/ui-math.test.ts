import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount, type RaisePresetInput, raisePresets } from "../src/index.js";

describe("cent mode formatting and parsing", () => {
  it("shows whole numbers with cent mode off and /100 with 2 decimals when on", () => {
    expect(formatAmount(1980, false)).toBe("1980");
    expect(formatAmount(1980, true)).toBe("19.80");
    expect(formatAmount(50, true)).toBe("0.50");
    expect(formatAmount(5, true)).toBe("0.05");
    expect(formatAmount(0, true)).toBe("0.00");
    expect(formatAmount(-1980, true)).toBe("-19.80");
    expect(formatAmount(-5, true)).toBe("-0.05");
    expect(formatAmount(-1980, false)).toBe("-1980");
    expect(() => formatAmount(19.8, false)).toThrow(/integer/);
  });

  it("parses whole numbers when off, and up to 2 decimals × 100 when on", () => {
    expect(parseAmount("1980", false)).toBe(1980);
    expect(parseAmount("1,980", false)).toBe(1980);
    expect(parseAmount(" 20 ", false)).toBe(20);
    expect(parseAmount("0.50", false)).toBeNull(); // no decimals with cent mode off
    expect(parseAmount("0.50", true)).toBe(50);
    expect(parseAmount("0.5", true)).toBe(50);
    expect(parseAmount("19.8", true)).toBe(1980);
    expect(parseAmount("19", true)).toBe(1900);
    expect(parseAmount("19.", true)).toBe(1900);
    expect(parseAmount("0.05", true)).toBe(5);
    for (const bad of ["", "-5", "1.234", "abc", "1e3", ".5"]) {
      expect(parseAmount(bad, true)).toBeNull();
      expect(parseAmount(bad, false)).toBeNull();
    }
  });

  it("round-trips every amount in both modes, exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), fc.boolean(), (amount, centMode) => {
        expect(parseAmount(formatAmount(amount, centMode), centMode)).toBe(amount);
      }),
      { numRuns: 5000 },
    );
  });
});

describe("raise presets", () => {
  const base: RaisePresetInput = {
    unopened: false,
    bigBlind: 20,
    pot: 0,
    currentBet: 0,
    callAmount: 0,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    allInTo: 0,
    potLimit: false,
  };
  const labels = (i: Partial<RaisePresetInput>) => raisePresets({ ...base, ...i }).map((p) => `${p.label} ${p.to}`);

  it("unopened preflop: Min raise, 2 BB, 3 BB, All in (2 BB is the min raise, so it's shown once)", () => {
    // UTG facing the blinds (10/20, pot 30): min raise to 40.
    expect(labels({ unopened: true, pot: 30, currentBet: 20, callAmount: 20, minRaiseTo: 40, maxRaiseTo: 1000, allInTo: 1000 })).toEqual([
      "Min raise 40",
      "3 BB 60",
      "All in 1000",
    ]);
    // With a straddle (current bet 40, min raise to 80), 2 BB and 3 BB are below the min.
    expect(labels({ unopened: true, pot: 70, currentBet: 40, callAmount: 40, minRaiseTo: 80, maxRaiseTo: 1000, allInTo: 1000 })).toEqual([
      "Min raise 80",
      "All in 1000",
    ]);
  });

  it("preflop facing a raise: Min raise, ½ pot, ¾ pot, Pot, All in (pot after calling)", () => {
    // Blinds 10/20, UTG raised to 60; the button faces 60: pot 90, call 60 → 150 after calling.
    expect(labels({ pot: 90, currentBet: 60, callAmount: 60, minRaiseTo: 100, maxRaiseTo: 2000, allInTo: 2000 })).toEqual([
      "Min raise 100", // 60 + 40 (the last raise)
      "½ pot 135", // 60 + 75
      "¾ pot 172", // 60 + floor(112.5)
      "Pot 210", // 60 + 150
      "All in 2000",
    ]);
  });

  it("postflop: Min raise, ½ pot, ¾ pot, Pot, All in", () => {
    // No bet yet: the min bet is the big blind.
    expect(labels({ pot: 120, minRaiseTo: 20, maxRaiseTo: 500, allInTo: 500 })).toEqual([
      "Min raise 20",
      "½ pot 60",
      "¾ pot 90",
      "Pot 120",
      "All in 500",
    ]);
    // Facing a bet of 60 into 90 (pot 150 after calling).
    expect(labels({ pot: 150, currentBet: 60, callAmount: 60, minRaiseTo: 120, maxRaiseTo: 2000, allInTo: 2000 })).toEqual([
      "Min raise 120",
      "½ pot 165", // 60 + 210 / 2
      "¾ pot 217", // 60 + floor(157.5)
      "Pot 270",
      "All in 2000",
    ]);
    // Pot-limit postflop: Pot and All in land on the same amount, shown once as Pot (max).
    expect(labels({ pot: 120, minRaiseTo: 20, maxRaiseTo: 120, allInTo: 500, potLimit: true })).toEqual([
      "Min raise 20",
      "½ pot 60",
      "¾ pot 90",
      "Pot (max) 120",
    ]);
  });

  it("pot-limit: everything is capped at the pot-sized raise, labelled Pot (max)", () => {
    // Same spot as "facing a raise" in PLO: max raise is to 210.
    expect(labels({ pot: 90, currentBet: 60, callAmount: 60, minRaiseTo: 100, maxRaiseTo: 210, allInTo: 2000, potLimit: true })).toEqual([
      "Min raise 100",
      "½ pot 135",
      "¾ pot 172",
      "Pot (max) 210",
    ]);
    // Unopened PLO preflop, pot 30: max raise to 70, so 3 BB (60) stays and All in is capped.
    expect(labels({ unopened: true, pot: 30, currentBet: 20, callAmount: 20, minRaiseTo: 40, maxRaiseTo: 70, allInTo: 5000, potLimit: true })).toEqual([
      "Min raise 40",
      "3 BB 60",
      "Pot (max) 70",
    ]);
    // A short stack in PL whose all-in is below the pot limit: plain "All in".
    expect(labels({ pot: 90, currentBet: 60, callAmount: 60, minRaiseTo: 100, maxRaiseTo: 150, allInTo: 150, potLimit: true })).toEqual([
      "Min raise 100",
      "½ pot 135",
      "All in 150",
    ]);
  });

  it("short stack: presets above the stack are hidden; below the min raise only All in is left", () => {
    // Stack covers 130: the pot fractions are gone.
    expect(labels({ pot: 90, currentBet: 60, callAmount: 60, minRaiseTo: 100, maxRaiseTo: 130, allInTo: 130 })).toEqual([
      "Min raise 100",
      "All in 130",
    ]);
    // All-in for less than a min raise (the server's min is then the all-in amount).
    expect(labels({ pot: 90, currentBet: 60, callAmount: 60, minRaiseTo: 80, maxRaiseTo: 80, allInTo: 80 })).toEqual(["All in 80"]);
  });

  it("never offers a preset outside [min raise, stack], and never twice", () => {
    fc.assert(
      fc.property(
        fc.record({
          unopened: fc.boolean(),
          bigBlind: fc.integer({ min: 1, max: 1000 }),
          pot: fc.integer({ min: 0, max: 1e6 }),
          currentBet: fc.integer({ min: 0, max: 1e5 }),
          callAmount: fc.integer({ min: 0, max: 1e5 }),
          raise: fc.integer({ min: 1, max: 1e5 }),
          extra: fc.integer({ min: 0, max: 1e6 }),
          cap: fc.integer({ min: 0, max: 1e6 }),
          potLimit: fc.boolean(),
        }),
        (r) => {
          const allInTo = r.currentBet + r.raise + r.extra;
          const minRaiseTo = Math.min(r.currentBet + r.raise, allInTo);
          const maxRaiseTo = r.potLimit ? Math.max(minRaiseTo, Math.min(allInTo, minRaiseTo + r.cap)) : allInTo;
          const presets = raisePresets({ ...r, minRaiseTo, maxRaiseTo, allInTo });
          expect(presets.length).toBeGreaterThan(0);
          const amounts = presets.map((p) => p.to);
          expect(new Set(amounts).size).toBe(amounts.length);
          for (const to of amounts) {
            expect(Number.isSafeInteger(to)).toBe(true);
            expect(to).toBeGreaterThanOrEqual(minRaiseTo);
            expect(to).toBeLessThanOrEqual(r.potLimit ? maxRaiseTo : allInTo);
          }
        },
      ),
      { numRuns: 3000 },
    );
  });
});
