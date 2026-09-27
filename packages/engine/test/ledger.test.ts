import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assertLedgerBalanced,
  cardsNeeded,
  DEFAULT_SETTINGS,
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
