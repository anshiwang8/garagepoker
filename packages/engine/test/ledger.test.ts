import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertLedgerBalanced,
  cardsNeeded,
  DEFAULT_SETTINGS,
  handConfigFor,
  isBombPotHand,
  type LedgerEvent,
  ledgerEvent,
  ledgerRows,
  validateConfig,
} from "../src/index.js";

const base = { at: 0, hand: 0, nickname: "x" };

describe("ledger events", () => {
  it("applies the SPEC §6 effects", () => {
    const e = (kind: Parameters<typeof ledgerEvent>[0], stackBefore: number, amount?: number) => {
      const ev = ledgerEvent(kind, { ...base, playerId: "p", stackBefore, amount });
      return [ev.buyIn, ev.buyOut, ev.stackAfter];
    };
    expect(e("sitIn", 0, 500)).toEqual([500, 0, 500]);
    expect(e("rebuy", 100, 500)).toEqual([500, 0, 600]);
    expect(e("add", 100, 50)).toEqual([50, 0, 150]);
    expect(e("remove", 100, 30)).toEqual([0, 30, 70]);
    expect(e("set", 100, 250)).toEqual([150, 0, 250]);
    expect(e("set", 100, 40)).toEqual([0, 60, 40]);
    expect(e("leave", 100)).toEqual([0, 100, 0]);
    expect(e("kick", 75)).toEqual([0, 75, 0]);
  });

  it("rejects invalid amounts", () => {
    const bad = (kind: Parameters<typeof ledgerEvent>[0], stackBefore: number, amount?: number) =>
      () => ledgerEvent(kind, { ...base, playerId: "p", stackBefore, amount });
    expect(bad("remove", 100, 101)).toThrow();
    expect(bad("add", 100, 0)).toThrow();
    expect(bad("add", 100, 1.5)).toThrow();
    expect(bad("set", 100, -1)).toThrow();
  });

  it("builds rows with net = buy-out + stack - buy-in", () => {
    const events = [
      ledgerEvent("sitIn", { ...base, playerId: "a", nickname: "Alex", stackBefore: 0, amount: 1000 }),
      ledgerEvent("sitIn", { ...base, playerId: "b", nickname: "Sam", stackBefore: 0, amount: 1000 }),
      ledgerEvent("leave", { ...base, playerId: "b", nickname: "Sam", stackBefore: 400 }),
    ];
    const rows = ledgerRows(events, { a: 1600 });
    expect(rows).toEqual([
      { playerId: "a", nickname: "Alex", buyIn: 1000, buyOut: 0, stack: 1600, net: 600 },
      { playerId: "b", nickname: "Sam", buyIn: 1000, buyOut: 400, stack: 0, net: -600 },
    ]);
    expect(() => assertLedgerBalanced(rows)).not.toThrow();
    expect(() => assertLedgerBalanced(ledgerRows(events, { a: 1601 }))).toThrow(/sum to 1/);
    expect(() => ledgerRows(events, { a: 1600, c: 5 })).toThrow(/no ledger entry/);
  });

  // A model table: owner operations are ledgered; hands move chips between stacks.
  const op = fc.oneof(
    fc.record({ t: fc.constant("sitIn" as const), p: fc.nat(5), x: fc.integer({ min: 1, max: 10_000 }) }),
    fc.record({ t: fc.constant("add" as const), p: fc.nat(5), x: fc.integer({ min: 1, max: 10_000 }) }),
    fc.record({ t: fc.constant("remove" as const), p: fc.nat(5), x: fc.nat(10_000) }),
    fc.record({ t: fc.constant("set" as const), p: fc.nat(5), x: fc.nat(10_000) }),
    fc.record({ t: fc.constant("leave" as const), p: fc.nat(5), x: fc.constant(0) }),
    fc.record({ t: fc.constant("hand" as const), p: fc.nat(5), x: fc.nat(10_000), q: fc.nat(5) }),
  );

  it("sum of nets is 0 after any sequence of ledgered changes and hands", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        const events: LedgerEvent[] = [];
        const stacks: Record<string, number> = {};
        for (const o of ops) {
          const id = `p${o.p}`;
          const seated = id in stacks;
          const input = { ...base, playerId: id, stackBefore: stacks[id] ?? 0 };
          if (o.t === "sitIn" && !seated) {
            const e = ledgerEvent("sitIn", { ...input, amount: o.x });
            events.push(e);
            stacks[id] = e.stackAfter;
          } else if (seated && o.t === "hand") {
            // Chips change hands: conserved, never ledgered.
            const other = `p${"q" in o ? o.q : 0}`;
            if (other in stacks && other !== id) {
              const moved = Math.min(o.x, stacks[id]!);
              stacks[id]! -= moved;
              stacks[other]! += moved;
            }
          } else if (seated && o.t !== "sitIn" && o.t !== "hand") {
            if (o.t === "remove" && (o.x === 0 || o.x > stacks[id]!)) continue;
            const e = ledgerEvent(o.t, { ...input, amount: o.x });
            events.push(e);
            if (o.t === "leave") delete stacks[id];
            else stacks[id] = e.stackAfter;
          }
          assertLedgerBalanced(ledgerRows(events, stacks));
        }
      }),
      { numRuns: 2000 },
    );
  });
});

describe("validateConfig", () => {
  it("accepts the defaults", () => {
    expect(validateConfig(DEFAULT_SETTINGS)).toEqual([]);
  });

  it("enforces deck math: seats × hole + 5 ≤ deck", () => {
    expect(cardsNeeded(8, 5)).toBe(45);
    expect(validateConfig({ ...DEFAULT_SETTINGS, variant: "PLO5", seats: 9 })).toEqual([]);
    expect(cardsNeeded(9, 5, 2, 2)).toBe(65);
  });

  it("applies deck math with double board (SPEC §3 table)", () => {
    const check = (patch: object) => validateConfig({ ...DEFAULT_SETTINGS, ...patch });
    // PLO, 8 seats, double board: 8 × 4 + 2 × 5 = 42 ≤ 52.
    expect(check({ variant: "PLO", seats: 8, boards: 2 })).toEqual([]);
    // PLO5, 8 seats, double board: 8 × 5 + 2 × 5 = 50 ≤ 52.
    expect(check({ variant: "PLO5HL", seats: 8, boards: 2 })).toEqual([]);
    // PLO5, 9 seats, double board: 9 × 5 + 10 = 55 > 52, and every setting involved is named.
    const [issue] = check({ variant: "PLO5", seats: 9, boards: 2 });
    expect(issue).toEqual({
      field: "seats",
      message: "9 seats with 2 boards need 55 cards; the deck has 52",
      related: ["seats", "variant", "boards"],
    });
  });

  it("counts two runs in the deck math when run it twice is on (SPEC §3 table)", () => {
    const check = (patch: object) => validateConfig({ ...DEFAULT_SETTINGS, ...patch });
    // PLO5, 8 seats, double board, run it twice: 8 × 5 + 2 × 5 × 2 = 60 > 52.
    const [issue] = check({ variant: "PLO5", seats: 8, boards: 2, runItTwice: "ask" });
    expect(issue).toEqual({
      field: "seats",
      message: "8 seats with 2 boards and run it twice need 60 cards; the deck has 52",
      related: ["seats", "variant", "boards", "runItTwice"],
    });
    // PLO, 8 seats, double board, run it twice: 32 + 20 = 52: allowed.
    expect(check({ variant: "PLO", seats: 8, boards: 2, runItTwice: "always" })).toEqual([]);
    // NLH, 8 seats, run it twice: 16 + 10 = 26.
    expect(check({ runItTwice: "ask", rabbitHunt: true })).toEqual([]);
    // Without run it twice, the same PLO5 double board table is fine (50 cards),
    // and the issue doesn't mention run it twice.
    expect(check({ variant: "PLO5", seats: 8, boards: 2 })).toEqual([]);
    expect(check({ runItTwice: "sometimes" }).map((i) => i.field)).toEqual(["runItTwice"]);
    expect(check({ rabbitHunt: "yes" }).map((i) => i.field)).toEqual(["rabbitHunt"]);
    expect(handConfigFor({ ...DEFAULT_SETTINGS, runItTwice: "ask" }).runItTwice).toBe("ask");
  });

  it("validates bomb pot settings and picks bomb-pot hands", () => {
    const fields = (patch: object) => validateConfig({ ...DEFAULT_SETTINGS, ...patch }).map((i) => i.field);
    expect(fields({ bombPotMode: "sometimes" })).toEqual(["bombPotMode"]);
    expect(fields({ bombPotEvery: 1 })).toEqual(["bombPotEvery"]);
    expect(fields({ bombPotAnteBB: 0 })).toEqual(["bombPotAnteBB"]);
    expect(fields({ bombPotAnteBB: 11 })).toEqual(["bombPotAnteBB"]);
    expect(fields({ boards: 3 })).toEqual(["boards"]);

    const every3 = { ...DEFAULT_SETTINGS, bombPotMode: "everyN" as const, bombPotEvery: 3 };
    expect([1, 2, 3, 4, 5, 6].map((h) => isBombPotHand(every3, h))).toEqual([false, false, true, false, false, true]);
    expect(isBombPotHand({ ...DEFAULT_SETTINGS, bombPotMode: "everyHand" }, 7)).toBe(true);
    expect(isBombPotHand(DEFAULT_SETTINGS, 5)).toBe(false);
    // The ante is in big blinds: 2 BB at 10/20 = 40.
    expect(handConfigFor({ ...DEFAULT_SETTINGS, boards: 2 }, true)).toMatchObject({ boards: 2, bombPot: { ante: 40 } });
    expect(handConfigFor(DEFAULT_SETTINGS).bombPot).toBeNull();
  });

  it("reports each bad field", () => {
    const fields = (patch: object) =>
      validateConfig({ ...DEFAULT_SETTINGS, ...patch }).map((i) => i.field);
    expect(fields({ seats: 10 })).toEqual(["seats"]);
    expect(fields({ seats: 1 })).toEqual(["seats"]);
    expect(fields({ bigBlind: 0 })).toContain("bigBlind");
    expect(fields({ smallBlind: 3000 })).toEqual(["smallBlind"]);
    expect(fields({ ante: -1 })).toEqual(["ante"]);
    expect(fields({ bigBlind: 20.5 })).toContain("bigBlind");
    expect(fields({ variant: "Razz" })).toEqual(["variant"]);
    expect(fields({ decisionTimeSec: 0 })).toEqual(["decisionTimeSec"]);
    expect(fields({ timeBankSec: -5 })).toEqual(["timeBankSec"]);
  });
});
