# Reverse Pineapple: design

Status: written 2026-11-08 from the user's request; they asked for the plan and then the build, without a review stop. Branch: `reverse-pineapple`, off `red-river` (PR #1, not merged yet), because Red River changed the same dealing code.

## 1. What it is

The user's words: "each player starts with 2 cards, on the flop each player gets a card, on the turn each player gets a card, on the river each player gets a final card and then the showdown is holdem style where a player may use one, two, three, four, five, or none of their hole cards."

So it's Pineapple run backwards. You start with 2 and build up to 5 by the river, instead of starting with 5 and discarding down to 2. Showdown is best 5 of all 10 cards: 5 hole + 5 board, any mix.

## 2. Rules

- **Preset:** "Reverse Pineapple". No-limit, 52 cards, row board, best 5 (`handRule: "any"`), high only, no discards. *(NL is my call; the user didn't say.)*
- **Dealing:** 2 hole cards preflop. When the flop, the turn and the river are dealt, every player still in the hand gets 1 more hole card, face down. All-in players count; folded players don't.
- **Deal order on those streets:** the hole cards first, one per live player starting left of the button, then that street's board cards (board 1, then board 2). It's fixed, so replay and the fairness proof stay deterministic. *(My call.)*
- **Showdown and hand labels:** best 5 of hole cards plus board, however many of each, on whatever has been dealt so far. This is the existing `"any"` rule, so ranking, splitting and odd chips are unchanged.
- **Deck math (SPEC §3):** unchanged. A player is counted as 5 hole cards (the most they can hold), so the limits match Pineapple and PLO5: up to 9 seats on one board, 8 with double board or run it twice. Cards set aside for players who fold are never dealt. They stay in the deck as spare cards, which Red River can then use.
- **Bomb pots:** there's no preflop betting, and the flop is dealt at once, so each player gets their 3rd card with it.
- **Run it twice:** offered only once every hole card is out, meaning when the last all-in happens on the river or in a Red River round. Before that, each run would hand players different hole cards. That's the same rule Pineapple has for its discards. An all-in before the river runs once, dealing the remaining hole cards and board cards in the normal order.
- **Rabbit hunt:** it deals the rest of the hand in play order on a scratch copy, including the hole card the remaining player would have got each street. It shows only the board cards. The back count shown before the reveal uses the existing formula.
- **Red River:** extra rounds deal board cards only. The river card is the last hole card.
- **Reveal when all in (SPEC §2.9):** allowed. Cards already dealt are shown, and later hole cards appear as the run-out deals them.
- **7-2 bounty:** doesn't apply, since it only works in 2-card games and you end with 5.
- **Show cards after a hand:** any card the player held at the end. A player who folded on the flop holds 3.
- **Mixed games:** can be part of a rotation.

## 3. What players see

- **Settings:** "Reverse Pineapple", with the detail line "Start with 2; get 1 more each street".
- **Felt:** your hand grows from 2 to 5 cards, and each new card slides in like the opening deal. Opponents' card backs grow the same way. The hero fan and opponent fans are already sized for 5 cards (PLO5 and Pineapple).
- **Learn mode:** "You start with 2 cards and get 1 more face down on the flop, the turn and the river, so you hold 5 at showdown." "Best 5 cards from all of yours and the board: use any number of your cards, even none."
- **Short name (info line):** "Rev. Pineapple".
- **Log, replay and export:** the replay frames already show each frame's hole cards, so your hand grows there too. No new log lines.

## 4. Engine shape

- `Variant` gains an optional `laterHole?: readonly [number, number, number]`: hole cards dealt to each live player on the flop, the turn and the river. `holeCards` stays the most a player can hold (5), so deck math and layout don't change. Preflop deals `holeCards - sum(laterHole)`. Missing means `[0, 0, 0]`, so older saved hands and every other variant behave exactly as today.
- Validation: the counts are integers ≥ 0, their sum is less than `holeCards`, and they can't be combined with `discard` or the `lines` rule.
- One street-dealing path deals the hole cards and then the board. It's used by normal play, all-in run-outs and rabbit hunt.

## 5. Constraints

The same as Red River: the engine stays pure and chips stay integer cents, and the server only sends each player their own cards. Every engine change comes with Vitest and fast-check tests, including the property that no card is dealt twice. `pnpm test`, `pnpm typecheck` and the browser tests must pass. Don't push or deploy. SPEC.md is updated (§1 parameter and preset, §2.7 run it twice note, §3 deck table row, §7 felt note).
