import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type NetEntry, settleUp } from "../src/index.js";

const nets = (...values: number[]): NetEntry[] =>
  values.map((net, i) => ({ playerId: `p${i}`, nickname: `P${i}`, net }));
const short = (entries: NetEntry[]) => settleUp(entries).map((p) => `${p.fromName}->${p.toName}:${p.amount}`);

describe("settleUp", () => {
  it("matches the largest debtor to the largest creditor", () => {
    // P0 +5000, P1 -3000, P2 -2000: both debtors pay P0.
    expect(settleUp(nets(5000, -3000, -2000))).toEqual([
      { from: "p1", fromName: "P1", to: "p0", toName: "P0", amount: 3000 },
      { from: "p2", fromName: "P2", to: "p0", toName: "P0", amount: 2000 },
    ]);
    // +100, +20, -70, -50: P2 (-70) pays P0 (+100) 70; then P3 (-50) pays
    // P0 its remaining 30 and P1 20. Three payments for four players.
    expect(short(nets(100, 20, -70, -50))).toEqual(["P2->P0:70", "P3->P0:30", "P3->P1:20"]);
  });

  it("breaks ties by ledger order", () => {
    expect(short(nets(30, 30, -30, -30))).toEqual(["P2->P0:30", "P3->P1:30"]);
    expect(short(nets(-30, -30, 30, 30))).toEqual(["P0->P2:30", "P1->P3:30"]);
  });

  it("leaves players with a zero net out", () => {
    const payments = settleUp(nets(0, 40, 0, -40, 0));
    expect(payments).toEqual([{ from: "p3", fromName: "P3", to: "p1", toName: "P1", amount: 40 }]);
    expect(settleUp(nets(0, 0, 0))).toEqual([]);
  });

  it("handles one player (nothing to settle) and rejects an unbalanced ledger", () => {
    expect(settleUp(nets(0))).toEqual([]);
    expect(settleUp([])).toEqual([]);
    expect(() => settleUp(nets(500))).toThrow(/sum to 500/);
    expect(() => settleUp(nets(10, -9))).toThrow(/sum to 1/);
    expect(() => settleUp(nets(1.5, -1.5))).toThrow(/bad net/);
  });

  it("always settles everyone exactly, in at most n - 1 payments", () => {
    const balancedNets = fc
      .array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 1, maxLength: 12 })
      .map((xs) => {
        // Make them sum to 0 by adjusting the last player. (0 - sum, not -sum:
        // -0 isn't a real ledger net, and Object.is(-0, 0) is false.)
        const sum = xs.reduce((a, b) => a + b, 0);
        return [...xs, 0 - sum];
      });
    fc.assert(
      fc.property(balancedNets, (values) => {
        const entries = nets(...values);
        const payments = settleUp(entries);
        const balance = new Map(entries.map((e) => [e.playerId, e.net]));
        for (const p of payments) {
          expect(Number.isSafeInteger(p.amount) && p.amount > 0).toBe(true);
          expect(p.from).not.toBe(p.to);
          // Only people who owe pay, and only people who are owed receive.
          expect(entries.find((e) => e.playerId === p.from)!.net).toBeLessThan(0);
          expect(entries.find((e) => e.playerId === p.to)!.net).toBeGreaterThan(0);
          balance.set(p.from, balance.get(p.from)! + p.amount);
          balance.set(p.to, balance.get(p.to)! - p.amount);
        }
        // After paying, everyone is square, so payments sum to zero across all players.
        for (const b of balance.values()) expect(b).toBe(0);
        const nonZero = entries.filter((e) => e.net !== 0).length;
        expect(payments.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      }),
      { numRuns: 3000 },
    );
  });
});
