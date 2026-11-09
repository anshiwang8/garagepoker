# Reverse Pineapple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Reverse Pineapple" preset: 2 hole cards preflop, plus 1 more to each live player on the flop, the turn and the river, then best 5 of all 10 cards at showdown.

**Architecture:** A new optional `Variant.laterHole` says how many hole cards each live player gets on the flop, turn and river. One engine street-dealing path deals those hole cards before the street's board cards, and normal play, run-outs and rabbit hunt all use it. The server and protocol pick up the new preset automatically, through `VARIANTS` and `VARIANT_NAMES`. The web needs names, Learn text, a deal animation for late hole cards, and previews.

**Tech Stack:** TypeScript, Vitest + fast-check (engine and server), Next.js + Tailwind, Playwright (`pnpm --filter web e2e`).

**Spec:** `docs/superpowers/specs/2026-11-08-reverse-pineapple-design.md`

## Global Constraints

- Engine stays pure: no I/O, `Date.now`, `Math.random` or `console` in logic. State stays JSON-serializable. Chips are integer cents.
- Never send a client a card it isn't allowed to see. Each player's new hole card goes to that player only; everyone else gets `null` for it.
- With `laterHole` missing (every other variant, and old saved hands), dealing is card for card as today.
- Preset key `REVERSE_PINEAPPLE`. Copy, exactly:
  - full name "Reverse Pineapple"
  - settings detail "Start with 2; get 1 more each street"
  - short name "Rev. Pineapple"
  - Learn lines "You start with 2 cards and get 1 more face down on the flop, the turn and the river, so you hold 5 at showdown." and "Best 5 cards from all of yours and the board: use any number of your cards, even none."
- `pnpm test` and `pnpm typecheck` pass after every task. Commit after each task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No new dependencies. Don't push or deploy.

## Review Focus

1. **A fold before the turn or river.** The folded player gets no more cards, and the next live player's card comes straight after the previous one in the deck (Task 1 test `folded players get no later hole cards`).
2. **An all-in on the flop, run-out to showdown.** Every live player ends with 5 hole cards, and every card is unique (Task 1 test `all-in run-out deals the remaining hole cards`, plus the property test).
3. **Run it twice with "always", all-in preflop.** It must run once; with an all-in on the river it may run twice (Task 1 test `run it twice only once all hole cards are out`).
4. **A bomb pot.** Each player holds 3 cards before the first action (Task 1 test `bomb pot deals the flop hole card at once`).
5. **An opponent's late card on the wire.** The view gives your new card to you, and `null` for it to everyone else (Task 2 test `late hole cards reach only their owner`).

---

### Task 1: Engine: `laterHole`, the preset and street dealing

**Files:**
- Modify: `packages/engine/src/hand.ts`. Covers the `Variant` type, `VARIANTS`, `startHand`, `validateHandConfig`, `canRunTwice`, `dealNextStreet`, `runOutAndFinish`, `rabbitCards`, and the street-dealing helper `dealStreets`.
- Modify: `packages/engine/src/index.ts`, but only if `holeCardsOnStreet` isn't already exported through `export *`.
- Create: `packages/engine/test/reversepineapple.test.ts`
- Modify: `packages/engine/test/hand.property.test.ts`. Add `REVERSE_PINEAPPLE` to the variant arbitrary used by the "no card dealt twice" and "chips conserved" properties, with Red River both on and off.

**Interfaces:**
- Produces:
  - `Variant.laterHole?: readonly [number, number, number]`: flop, turn, river.
  - `VARIANTS.REVERSE_PINEAPPLE = { holeCards: 5, deckSize: 52, betting: "NL", handRule: "any", split: "high", discard: false, board: ROW_BOARD, laterHole: [1, 1, 1] }`
  - `export function holeCardsOnStreet(variant: Variant, street: Street): number`. Returns `holeCards - sum(laterHole)` for `"preflop"`, the matching `laterHole` entry for flop, turn and river, and 0 otherwise. It treats a missing `laterHole` as `[0, 0, 0]`.
- `VariantName` and `VARIANT_NAMES` pick up the new key automatically. TypeScript will flag every `Record<VariantName, …>` in the web; Task 3 fills those in. Until then, put temporary entries in the 3 web records (`VARIANT_LABELS`, `VARIANT_SHORT`, `VARIANT_RULES`) using the exact copy from Global Constraints, so typecheck passes.

Deck layout to test against: 3 players, seats 1, 2 and 3, button on seat 1. The deal starts left of the button, so the order is seat 2, seat 3, seat 1.
- **Preflop:** deck[0–1] go to seat 2, [2–3] to seat 3, [4–5] to seat 1.
- **Flop:** hole cards [6] to seat 2, [7] to seat 3, [8] to seat 1; board [9–11].
- **Turn:** hole cards [12–14]; board [15].
- **River:** hole cards [16–18]; board [19].

- [ ] **Step 1: Write the failing tests** in `reversepineapple.test.ts`. Use `makeDeck(52)` in order, so `deck[i]` is predictable, and the `NL` config with `variant: VARIANTS.REVERSE_PINEAPPLE`. Use the 3-player layout above.
  - `deals 2 preflop and 1 per street in seat order`:
    - after `startHand`, every player has 2 hole cards. Seat 2 holds `[deck[0], deck[1]]` and seat 1 holds `[deck[4], deck[5]]`.
    - After the preflop is checked or called through, seat 2's hole is `[deck[0], deck[1], deck[6]]`, and the board is `deck.slice(9, 12)`.
    - Checked through to the river: each hole has 5 cards; seat 1's last card is `deck[18]`; the board is `[...deck.slice(9, 12), deck[15], deck[19]]`.
  - `folded players get no later hole cards`: seat 3 folds preflop. On the flop, seat 2 gets `deck[6]` and seat 1 gets `deck[7]`; the board is `deck.slice(8, 11)`. Seat 3 still holds 2 cards.
  - `showdown uses any number of hole cards`:
    - A stacked deck where the board is a royal flush and both players' cards are worse: the pot splits evenly ("none").
    - A deck where one player's 5 hole cards alone make a flush that beats a board straight ("five").
    - Assert with `result.pots[0].winners`.
  - `all-in run-out deals the remaining hole cards`: heads-up, both all in on the flop. Each player ends with 5 hole cards, the board has 5, all 15 cards are distinct, and `deckIndex === 15`.
  - `run it twice only once all hole cards are out`, with `runItTwice: "always"`:
    - all in preflop: `secondRun === null`, the hand is complete, and everyone holds 5.
    - all in on the river with a black river: nothing is left to come, so no second run, as in other variants.
    - all in on the turn: `secondRun === null`.
    - Red River on, the river is red, and all in during river betting: `secondRun !== null`, and both runs end black or stop.
  - `bomb pot deals the flop hole card at once`: `bombPot: { ante: 20 }`. After `startHand` every player holds 3 cards and the board has 3.
  - `rabbit hunt continues in play order`: 3 players; seat 2 and seat 3 fold on the flop. `rabbitCards(final)[0]` equals `[deck[13], deck[15]]`. The turn deals seat 1's hole card at `deck[12]`, then the turn card at `deck[13]`; the river deals seat 1's card at `deck[14]`, then the river at `deck[15]`. Seat 1's hole stays 3 cards in the real state.
  - `validation`: `startHand` throws an `EngineError` for each of:
    - `laterHole: [1, 1, 3]` with `holeCards: 5` (sum not below `holeCards`)
    - `laterHole: [1, 1, 1]` with `discard: true`
    - `laterHole: [-1, 1, 1]`
  - `other variants deal as before`: `holeCardsOnStreet(VARIANTS.NLH, "preflop") === 2` and `holeCardsOnStreet(VARIANTS.NLH, "flop") === 0`. A full NLH hand on `makeDeck(52)` gives the same holes and board as before: seat 2 holds `[deck[0], deck[1]]` and the board is `deck.slice(6, 11)`.
- [ ] **Step 2: Run** `pnpm --filter @garagepoker/engine test reversepineapple`. Expected: FAIL (`REVERSE_PINEAPPLE` doesn't exist yet).
- [ ] **Step 3: Implement.**
  - `startHand` deals `holeCardsOnStreet(v, "preflop")` cards to each seat.
  - Deck validation keeps `n * holeCards + boards * boardSize`.
  - `validateHandConfig` adds the three rules from the validation test.
  - Make one helper deal a base street, so play, run-outs and rabbit hunt can't drift apart. It deals `holeCardsOnStreet` cards to each unfolded player, starting left of the button, then the street's board cards. `dealNextStreet`, `runOutAndFinish` (run 1's base streets) and `rabbitCards` (on the scratch copy) all use it.
  - Run 2's base streets add board cards only: run 2 is only allowed once the hole cards are complete.
  - `canRunTwice` returns false while any street that deals late hole cards is still to come. With `laterHole: [1, 1, 1]` that means the street is preflop, flop or turn, and the check sits beside the existing Pineapple guard.
  - Red River rounds deal no hole cards.
- [ ] **Step 4: Run** `pnpm --filter @garagepoker/engine test` and `pnpm typecheck`. Expected: all pass, including the existing 170 engine tests unchanged.
- [ ] **Step 5: Commit** as `engine: Reverse Pineapple (hole cards dealt on later streets)`.

### Task 2: Server checks and SPEC

**Files:**
- Test: `apps/server/test/reversepineapple.test.ts`. Use the server's existing `seededHand` / table helpers in `apps/server/test/helpers.ts`.
- Modify: `SPEC.md` (§1, §2.7, §3, §7), and `docs/improvements-progress.md` (add a Reverse Pineapple row).
- Modify server code only if a test exposes a gap. Expected: none. `view.ts` maps each hole card through the viewer check, and `replay.ts` reads each frame's own holes.

**Interfaces:** consumes `VARIANTS.REVERSE_PINEAPPLE` and `holeCardsOnStreet` from Task 1.

- [ ] **Step 1: Write the tests.**
  - `late hole cards reach only their owner`. A 3-seat Reverse Pineapple table, after the flop is dealt:
    - the hero's view has `seats[hero].cards` with 3 strings;
    - another player's view has 3 entries, all `null`, for the hero's seat;
    - a spectator sees 3 `null`s.
  - `settings accept Reverse Pineapple in mixed games`:
    - `validateConfig` passes for 9 seats on 1 board;
    - it reports a deck-math issue for 9 seats with 2 boards;
    - the Zod settings schema accepts `variant: "REVERSE_PINEAPPLE"` and `mixedGames: ["NLH", "REVERSE_PINEAPPLE"]`.
  - `replay frames show the hand growing`. After a hand that reached the river, the viewer's replay frames for preflop, flop, turn and river show 2, 3, 4 and 5 cards of their own.
  - `the 7-2 bounty doesn't apply`: `sevenDeuceApplies("REVERSE_PINEAPPLE") === false`.
- [ ] **Step 2: Run** `pnpm --filter server test reversepineapple`. Fix any gap it finds in `view.ts` or `replay.ts`. Expected: PASS.
- [ ] **Step 3: Update SPEC.md.**
  - §1: add a parameter row "Hole cards later" with the values "None; 1 each on the flop, turn and river (Reverse Pineapple)". Add the preset row "Reverse Pineapple | 2 + 1 + 1 + 1 | 52 | Row | NL | Best 5 | Hi | None". Add a "Variant rules" bullet summarising spec §2: dealing order, folded players, run it twice, rabbit hunt, Red River.
  - §2.7: "In Reverse Pineapple, run it twice is offered only once every hole card is out (the river or a red river round)."
  - §3: add a deck-table row "Reverse Pineapple | 52 | 45 | 50".
  - §7: "In Reverse Pineapple your hand grows by one card on each of the flop, turn and river; each new card slides in like the deal."
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** as `server, spec: Reverse Pineapple checks and SPEC`.

### Task 3: Web: names, Learn, late-card animation, previews

**Files:**
- Modify:
  - `apps/web/src/components/SettingsForm.tsx` (`VARIANT_LABELS`)
  - `apps/web/src/components/table/tableText.ts` (`VARIANT_SHORT`)
  - `apps/web/src/components/table/Learn.tsx` (`VARIANT_RULES`)
  - the card-deal animation in `Felt.tsx` / `Seat.tsx` / `PlayingCard.tsx`, wherever `dealerFor` drives the fly-in
- Modify: `apps/web/src/dev/tableStates.ts`, adding previews:
  - Reverse Pineapple on the flop (hero holds 3)
  - on the river (hero 5, opponents showing 5 backs)
  - a showdown where the winner used 0 hole cards
- Modify: `apps/web/e2e/table.spec.ts`. The previews must pass the existing layout checks at all 4 sizes, plus one check that the hero hand on the river preview shows 5 cards.

**Interfaces:** consumes `VARIANTS.REVERSE_PINEAPPLE`, `VariantName`, and the protocol `SeatView.cards`, which grows during a hand.

- [ ] **Step 1: Copy.** Replace Task 1's temporary entries with the exact copy from Global Constraints. The settings detail is "Start with 2; get 1 more each street".
- [ ] **Step 2: Late-card animation.** When a seat's card count grows during a hand (same hand number, more cards than the last render), only the new card animates in, with the same fly-in from the middle of the felt as the opening deal. Cards already shown don't re-animate. With reduced motion, there's no animation, as today. A reload mid-hand shows the cards without animating them, like the opening deal on reload.
- [ ] **Step 3: Previews and e2e.** Add the previews, then run `pnpm --filter web e2e`. Start `cd apps/web && pnpm dev` first if Playwright's own server hangs. Expected: every check passes at all 4 sizes, including the new ones.
- [ ] **Step 4: Run** `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** as `web: Reverse Pineapple names, Learn text, late-card deal, previews`.
