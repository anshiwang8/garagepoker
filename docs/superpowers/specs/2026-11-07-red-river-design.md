# Red River: design

Status: draft for approval (2026-11-07). Branch: `red-river` (local, not pushed).

## 1. What it is, and why

Red River is a home-game rule: **when the river is red (a heart or a diamond), another board card is dealt, with a betting round, and this repeats until a black card (club or spade) lands.** It adds swingy, social, "one more card!" moments, which is the kind of variety GaragePoker exists to give away for free (SPEC intro: "every game your group actually plays").

It's a **table modifier**: a single on/off toggle, like double board and bomb pots. It works with every game that has a 5-card row board: NLH, PLO, PLO5, PLO Hi/Lo, PLO5 Hi/Lo, Pineapple and Short deck. Tic-Tac-Toe Hold'em doesn't have a single river card, so the toggle doesn't apply to it.

## 2. Decisions the user made

1. **Betting after each extra card.** Every extra card starts its own betting round, just like a new street.
2. **No fixed cap.** Extra cards keep coming while the latest one is red, until a black card lands or the deck can't spare another card (§4.4). The deck has only 26 red cards (18 in short deck), so a streak always ends.
3. **A toggle on any game** (with a 5-card row board), not separate presets.

## 3. Goals, non-goals, anti-goals

**Goals**
- The rule is correct in every combination that's allowed today: double board, run it twice, bomb pots, Hi/Lo, Omaha's 2 + 3 rule, Pineapple, short deck, straddle, mixed games, rabbit hunt, all-in reveal, fairness proof, replay, hand-history export, session stats.
- With the toggle off, nothing changes. Every existing hand deals and replays card for card as it does today.
- Players can always see what's happening: which round they're on, and that more cards may come.

**Non-goals**
- A cap or an owner-set limit on extra cards (the user chose no cap).
- Other colour or suit rules (e.g. "black river", "red flop").
- Red River on the Tic-Tac-Toe grid.

**Anti-goals** (it would be a failure even if it technically works)
- A hand that fails or freezes mid-hand because the deck ran short. SPEC §3: never fail mid-hand.
- Run 2 of run it twice, or board 2, getting short-changed because the other one's extra cards ate its cards.
- A long board that overflows the felt or overlaps seats on a phone.
- Old hands replaying differently, or old stored tables failing to load.

## 4. Rules (the engine must get these right)

### 4.1 Dealing

- The river is dealt as today. After river betting closes, if the toggle is on and **any board's last card is red**, an **extra round** starts: each board whose last card is red gets one more card, and there's a betting round. Boards whose last card is black are finished and get nothing.
- This repeats while any board's last card is red (and the deck can spare a card, §4.4).
- Extra rounds are numbered 1, 2, 3, … and shown as **"Red river 1"**, "Red river 2" and so on.
- Red = diamonds or hearts (suits 1 and 2 in `cards.ts`). Black = clubs or spades (0 and 3).
- No burn cards, as everywhere else.

### 4.2 Betting in extra rounds

- Each extra round is a full betting round with the usual postflop rules: first live player left of the button acts first, min-raise resets to the big blind, pot-limit math, short all-in reopen rule, uncalled bets returned.
- If everyone folds to one player, the hand ends as normal (rabbit hunt can then show what would have come, §4.6).
- No Pineapple discards in extra rounds (players already hold 2 after the turn).

### 4.3 Hands and showdown

- **Best 5 / Hold'em-style (`any`):** best 5 cards from the hole cards plus the **whole** board, however long it is.
- **Omaha (`omaha`):** exactly 2 hole cards + exactly 3 board cards, chosen from the **whole** board. The same applies to the low in Hi/Lo.
- Hand labels (SPEC §2.6) are the best hand under those rules on the board so far.
- Pot splitting is unchanged (boards, halves, runs, ties, odd chips).

### 4.4 The deck runs short (no cap)

- Deck math (SPEC §3) is **unchanged**: it reserves 5 board cards per board per run, so every configuration allowed today is still allowed with the toggle on.
- An extra card comes only from cards **nobody else is owed**. Before dealing an extra card, the engine keeps back the base cards any not-yet-dealt board or run still needs (in practice: run 2's remaining base cards during a run-it-twice run-out).
- An extra round is all or nothing. If the deck can't spare one card for **every** board (and run) that still ends red, **no** board gets a card in that round, and red river stops for all of them. Their last cards stay red. This keeps double boards and both runs even, so the last card never goes to board 1 just because of dealing order. The log gets one note per hand: **"No cards left: red river stops."** The hand carries on to showdown normally.
- This only happens in crowded tables (e.g. 8-seat PLO5 has 7 cards left after the base board). With fewer than 9 seats in NLH or PLO it can't happen in practice.

### 4.5 Run it twice and all-in run-outs

- "Cards still to come" (SPEC §2.7) now also means "some board's last card is red". So run it twice can be offered when the last all-in happens on the river or in an extra round and a red card is showing.
- When the run-out happens, each run (and each board) carries on **on its own**: one run can end black on the river while the other draws three extra cards.
- **Dealing order in a run-out**, deterministic and the same for the fairness proof:
  1. Run 1's remaining base streets, board by board (as today).
  2. Run 2's remaining base streets, board by board (as today).
  3. Then extra cards in rounds: in each round, one card to each board that still ends red, in the order run 1 board 1, run 1 board 2, run 2 board 1, run 2 board 2. Repeat until none end red or the deck is out.
- With the toggle off, steps 1 and 2 are exactly today's order.
- Run it twice eligibility: the deck must still cover both runs' base cards (as today), plus at least one card per run for every board currently ending red.

### 4.6 Rabbit hunt

- SPEC §2.8 changes from "a hand ended before the river" to **"a hand ended before the board was finished"**: before the river, or during an extra round with a red card showing.
- That includes a fold during **river** betting when the river is red, before extra round 1 starts.
- The rabbit cards follow the same rule: the rest of the base streets, then extra cards while red, from the same deck in dealing order. Display only, as today.
- **Before the reveal, the felt must not leak the colour of unseen cards.** The number of face-down backs under the Reveal strip is **the missing base cards, plus 1 if the board's last visible card is red**. Both numbers are already public. The exact number of extra cards is sent only once someone hunts. The server computes the back count, not the client.

### 4.7 Mixed games

- With mixed games on, the toggle applies to every game in the rotation that has a row board, and is skipped for Tic-Tac-Toe hands.

## 5. What players see (UI)

- **Settings:** a "Red river" toggle in **Table options** (create-table and owner menu), with the line *"A red river deals another card, with betting, until a black one."* The Table options summary mentions it when it's on. When the game is Tic-Tac-Toe, the toggle is greyed out with the reason *"Tic-Tac-Toe has no single river card."*
- **Felt:**
  - A small **"RED RIVER"** badge in the felt centre, in the same place and style as the bomb-pot badge, while the toggle is on for this hand. During extra rounds it reads **"RED RIVER 2"** (the current round).
  - The board grows to fit the extra cards. It stays one row and the cards shrink to fit, down to a minimum legible size. Past that, it wraps into a second line. Every existing layout rule still holds (nothing overlaps the hero area, seats or pot, and there's no sideways scroll at 360, 390, 430 px and desktop).
  - Double board and run twice rows can be different lengths. Each row is drawn at its own length, and all rows use the same card size.
  - Extreme cases (e.g. 4 rows of 10+ cards on a 360 px phone) are vanishingly rare but must still draw. A row may wrap onto as many lines as it needs. If that still doesn't fit, cards shrink below the usual minimum. The layout invariants (fits, nothing overlapped) always win over card size.
- **Log, last-hand replay and hand-history export:** extra rounds appear as "Red river 1", "Red river 2", … with their deal lines and actions. The "No cards left" note appears in the log when it happens.
- **Learn mode (How to play):** when the toggle is on, a short paragraph explains the rule and that each extra card has its own betting.
- **Hand result line and Details** are unchanged.

## 6. Constraints (from CLAUDE.md and SPEC)

- Engine stays pure: no I/O, `Date.now` or `Math.random`. State stays JSON-serializable. Chips are integer cents.
- The server is authoritative and builds each seat's view. Board cards are public, so nothing new is secret.
- Validate the new setting with Zod on the server. Older stored tables load with `redRiver: false`.
- Every engine change comes with Vitest tests, plus fast-check properties for the invariants.
- `pnpm test` and `pnpm typecheck` pass before anything is called done, plus the Playwright browser tests for the felt.
- Don't push or deploy. This changes engine, protocol and server, so release order is `npx wrangler deploy` (apps/server) first, then the web app.
- SPEC.md is updated as part of the work (§7 of this doc lists what changes), since SPEC is the source of truth.

## 7. SPEC.md changes

- §1: a third table modifier, **Red river** (on/off, row boards only), and a "Red river" entry under Variant rules (§4.1–4.4 above).
- §2.7: "cards still to come" includes a red last card. Each run extends on its own.
- §2.8: rabbit hunt applies whenever the hand ended before the board was finished.
- §3: a note that red-river extra cards are never reserved. They come from cards left over, and a board stops if none are left.
- §5: the new setting row (default Off).
- §7: the board can be longer than 5 cards (it shrinks, then wraps), plus the red-river badge and the "Red river N" round names.

## 8. My calls (not the user's; easy to change)

- Extra rounds are named "Red river 1, 2, …".
- A board that can't get a card because the deck ran out simply stops, with a log note, rather than being re-dealt or voided.
- The run-out dealing order in §4.5 (base cards for both runs first, then extra cards round-robin), so run 2 can never be starved.
- There's no new Street name per round. Internally there's one new street, `"extra"`, plus a round counter (`extraRound`) on the hand state, log entries and replay deal events. This keeps `Street` a short fixed list.
- The badge and wrap behaviour in §5.
- The rule is skipped (not refused) for Tic-Tac-Toe hands inside a mixed rotation, and a Tic-Tac-Toe table with the toggle on (e.g. from a stored preset) just ignores it.
- An extra round is all or nothing when the deck runs short (§4.4).
- Rabbit-hunt backs: missing base cards + 1 when a red card is showing (§4.6).
- Wrapping onto any number of lines, and shrinking below the usual minimum in extreme cases (§5).
- With a bomb pot on as well, both badges show, side by side. During extra round 1 the badge reads "RED RIVER 1".
- Pineapple run it twice works on the river and in extra rounds (discards are finished by then).

## 9. Left to the builder

- Exact engine function names and where the "is this board finished?" check lives (one helper the server and web both use, rather than `length < boardSize`).
- The minimum card size before the board wraps, as long as the layout invariant tests pass.
- How the dev table previews cover red river (at least: a 7-card single board in an extra round, double board with uneven lengths, run twice with uneven lengths, and a 12-card stress board).
