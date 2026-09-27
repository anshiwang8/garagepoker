import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  type HandState,
  legalActions,
  makeDeck,
  type PlayerAction,
  shuffle,
  startHand,
  VARIANTS,
} from "../src/index.js";
import { seededRandom } from "./helpers.js";

const handArb = fc.record({
  seats: fc.shuffledSubarray([1, 2, 3, 4, 5, 6, 7, 8, 9], { minLength: 2 }),
  variant: fc.constantFrom(VARIANTS.NLH, VARIANTS.PLO, VARIANTS.PLO5),
  bigBlind: fc.integer({ min: 2, max: 100 }),
  sbPercent: fc.integer({ min: 0, max: 100 }),
  antePercent: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 100 })),
  straddle: fc.boolean(),
  // Mix of short and deep stacks, in big blinds, so all-ins and side pots are common.
  stacksInBB: fc.array(fc.oneof(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 6, max: 300 })), {
    minLength: 9,
    maxLength: 9,
  }),
  oddChips: fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 9, maxLength: 9 }),
  postBlind: fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
  buttonPick: fc.nat(),
  seed: fc.integer(),
});

type HandParams = typeof handArb extends fc.Arbitrary<infer T> ? T : never;

function uniform(random: ReturnType<typeof seededRandom>): number {
  const buf = new Uint32Array(1);
  random(buf);
  return buf[0]! / 2 ** 32;
}

/** Picks a random legal action for the player to act. */
function randomAction(s: HandState, r: () => number): PlayerAction {
  const legal = legalActions(s)!;
  const seat = legal.seat;
  const x = r();
  if (x < (legal.canCheck ? 0.02 : 0.2)) return { type: "fold", seat };
  if (legal.canRaise && x > 0.7) {
    const y = r();
    const p = s.players.find((q) => q.seat === seat)!;
    let to: number;
    if (y < 0.3) to = legal.minRaiseTo;
    else if (y < 0.5) to = legal.maxRaiseTo;
    else if (y < 0.6) to = p.bet + p.stack; // all-in, possibly short or over a PL cap
    else to = legal.minRaiseTo + Math.floor(r() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
    if (to <= legal.maxRaiseTo) return { type: "raise", seat, to };
  }
  return legal.canCheck ? { type: "check", seat } : { type: "call", seat };
}

function playHand(params: HandParams): void {
  const random = seededRandom(params.seed);
  const r = () => uniform(random);
  const bb = params.bigBlind;
  const config = {
    variant: params.variant,
    bigBlind: bb,
    smallBlind: Math.floor((bb * params.sbPercent) / 100),
    ante: Math.floor((bb * params.antePercent) / 100),
    straddle: params.straddle,
  };
  const players = params.seats.map((seat, i) => ({
    seat,
    stack: params.stacksInBB[i]! * bb + params.oddChips[i]!,
    postBlind: params.postBlind[i]!,
  }));
  const total = players.reduce((sum, p) => sum + p.stack, 0);
  const button = params.seats[params.buttonPick % params.seats.length]!;
  const deck = shuffle(makeDeck(config.variant.deckSize), random);

  let s = startHand({ config, players, button, deck });
  let steps = 0;
  const conserved = (st: HandState) =>
    st.players.reduce((sum, p) => sum + p.stack + p.committed, 0) === total;

  // Plain checks in the hot loop; expect() is slow over millions of actions.
  while (s.toAct !== null) {
    if (!conserved(s)) throw new Error(`chips not conserved after ${steps} actions`);
    s = applyAction(s, randomAction(s, r));
    if (++steps >= 500) throw new Error("hand did not terminate");
  }

  // Chips conserved: every chip that went in came back out to someone.
  const result = s.result!;
  expect(s.players.reduce((sum, p) => sum + p.stack, 0)).toBe(total);
  const committed = s.players.reduce((sum, p) => sum + p.committed, 0);
  expect(result.pots.reduce((sum, p) => sum + p.amount, 0)).toBe(committed);
  expect(result.payouts.reduce((sum, p) => sum + p.amount, 0)).toBe(committed);
  for (const p of s.players) {
    expect(Number.isSafeInteger(p.stack) && p.stack >= 0).toBe(true);
  }

  // Only live, eligible players win.
  for (const pot of result.pots) {
    for (const w of pot.winners) {
      expect(pot.eligible).toContain(w.seat);
      expect(s.players.find((p) => p.seat === w.seat)!.folded).toBe(false);
    }
  }

  // No card dealt twice.
  const dealt = [...s.players.flatMap((p) => p.hole), ...s.board];
  expect(new Set(dealt).size).toBe(dealt.length);
  expect(dealt.length).toBe(players.length * config.variant.holeCards + s.board.length);
  for (const p of s.players) expect(p.hole).toHaveLength(config.variant.holeCards);

  // Showdown: full board; Omaha hands use exactly 2 hole + 3 board.
  if (result.showdown.length > 0) {
    expect(s.board).toHaveLength(5);
    if (config.variant.handRule === "omaha") {
      for (const { hole, value } of result.showdown) {
        expect(value.cards.filter((c) => hole.includes(c))).toHaveLength(2);
        expect(value.cards.filter((c) => s.board.includes(c))).toHaveLength(3);
      }
    }
  }
}

describe("hand state machine properties", () => {
  it("over 100k random hands: chips are conserved and no card is dealt twice", () => {
    fc.assert(fc.property(handArb, playHand), { numRuns: 100_000 });
  }, 600_000);
});
