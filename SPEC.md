# GaragePoker — Product & Technical Spec

PokerNow-style home-game tables with every variant and table feature free. No accounts, no real money, no long-term storage.

Positioning: *PokerNow-style tables, every game your group actually plays, no paywall.* PokerNow only offers Hold'em, Omaha and Omaha Hi/Lo, and charges for bomb pots and double board. GaragePoker gives those away.

---

## 1. Game model

Variants are built from six parameters. Every "mode" is a preset; a new variant should be a config row, not new code.

| Parameter | Values |
| --- | --- |
| Hole cards | 2, 4, 5 |
| Deck | 52, 36 (short deck, 6 to A) |
| Betting | No-limit, pot-limit |
| Hand rule | Best 5 of all cards; or exactly 2 hole + 3 board (Omaha) |
| Pot split | High only; high/low 8-or-better |
| Discards | None; 1 each preflop, flop, turn (Pineapple) |

Two **table modifiers** work with any variant:

- **Boards:** 1 or 2
- **Bomb pot:** off, every hand, or every N hands

"Double board bomb pot PLO" is PLO + 2 boards + bomb pot, not a separate mode.

### Presets

| Preset | Hole | Deck | Betting | Hand rule | Split | Discards |
| --- | --- | --- | --- | --- | --- | --- |
| NLH (default) | 2 | 52 | NL | Best 5 | Hi | None |
| PLO | 4 | 52 | PL | 2 + 3 | Hi | None |
| PLO5 | 5 | 52 | PL | 2 + 3 | Hi | None |
| PLO Hi/Lo | 4 | 52 | PL | 2 + 3, each half | Hi/Lo 8 | None |
| PLO5 Hi/Lo | 5 | 52 | PL | 2 + 3, each half | Hi/Lo 8 | None |
| Pineapple (5-card) | 5 | 52 | NL | Best 5 | Hi | Preflop, flop, turn |
| Short deck | 2 | 36 | NL | Best 5 | Hi | None |

### Variant rules

- **Pineapple (5-card):** each player is dealt 5 and discards 1 preflop, 1 after the flop and 1 after the turn, so they hold 2 on the river. Showdown is best 5 of 7. Everyone discards face down at the same time, before betting on that street. If the timer expires, the engine discards the player's lowest card.
- **Short deck:** 36 cards (6 through A). Flush beats full house. Three of a kind beats a straight (Triton rules). A-6-7-8-9 is the lowest straight.
- **Hi/Lo:** a low must be 8-or-better with 5 distinct ranks, ace plays low. In Omaha, both the high and the low use exactly 2 hole + 3 board, and can use different hole cards.
- **Bomb pots:** every player who isn't away antes (default 2 BB). There is no preflop betting; action starts on the flop. Away players are not included. UTG straddle is off during bomb pots.

---

## 2. Core rules (engine must get these right)

1. **Dealer button.** The button marks the dealer. SB and BB sit to its left. Heads-up, the button posts the SB and acts first preflop. A new player either waits for the BB or posts one to sit in immediately. The button moves one active seat per hand.
2. **Betting.** Actions each street: fold, check, call, raise (bet if no bet yet).
   - Once there is a bet, Check becomes "Call X", showing the amount needed.
   - Min-raise = the size of the last raise (not 2x the bet).
   - An all-in below a full raise does not reopen betting to players who already acted.
3. **Pot-limit.** The maximum raise is a pot-sized raise: call first, then raise the size of the pot after the call. In PL, the "All in" preset is capped at that maximum.
4. **Side pots.** Every all-in creates a side pot. Each pot is resolved independently.
5. **Splitting pots.**
   - Double board: each board takes half of each pot.
   - Hi/Lo: within a board, the high hand and the qualifying low hand each take half. If there is no qualifying low, the high hand takes all of it.
   - Both together give quartered pots.
   - Ties split evenly.
   - Odd chips go to the high hand, then to the first seat left of the button.
6. **Hand labels.** Show every player's current best hand at all times: "Top pair", "Straight", "Flush", and so on. In Omaha, the label must obey the exactly 2 + 3 rule. In Hi/Lo, show both halves, e.g. "Flush / 8-6 low".
7. **Run it twice.**
   - Only offered when every remaining player is all-in (or all but one) and no more action is possible.
   - Every player in the pot must accept; any decline or a 5-second timeout means it runs once.
   - Each run takes half of each pot.
   - Disabled wherever the deck math fails (section 3).
8. **Rabbit hunt.** When allowed, after a hand ends before the river, any player can reveal the cards that would have come. Display only; no effect on the pot.
9. **Showdown.** When "reveal hands when no more action is possible" is on, all live hands are shown face up as soon as action is closed, before the remaining board is dealt.
10. **Dealing.**
    - The deck is shuffled once per hand, server-side, before any card is dealt, using a CSPRNG with unbiased Fisher-Yates.
    - Cards are never sent to a client until that client is allowed to see them.
    - No burn cards: they stop card marking at a live table and do nothing with a server-side shuffle.

---

## 3. Deck math

Formula the engine enforces when the owner saves settings:

```
seats × hole cards + boards × 5 × runs ≤ deck size
```

`runs` = 2 when run it twice is enabled, otherwise 1. If a setting fails, grey out the offending option in the UI with the reason. Never fail mid-hand.

| Config (8 seats, no burns) | Deck | Cards needed | With run it twice |
| --- | --- | --- | --- |
| NLH | 52 | 21 | 26 |
| PLO | 52 | 37 | 42 |
| PLO5 | 52 | 45 | 50 |
| Pineapple | 52 | 45 | 50 |
| PLO, double board | 52 | 42 | 52 |
| PLO5, double board | 52 | 50 | **60 (not allowed)** |
| Short deck | 36 | 21 | 26 |
| Short deck, double board | 36 | 26 | 36 |

---

## 4. Tables, identity and ownership

- **No accounts.**
  - Each browser gets a random player token, stored in localStorage and a cookie. The token, not the nickname, owns the seat, so a page refresh keeps your seat.
  - Players pick a nickname when they sit.
- **Creating a table:** anyone can open a table and pick settings. The table URL uses an unguessable 10-character ID. Anyone with the link can request a seat or spectate.
- **Owner:** the creator's token is the owner. The owner can hand off ownership from the Players menu. If the owner has been offline for 5 minutes and an eligible player (seated, not away, connected) is present, ownership passes to the longest-seated eligible player. This is checked when someone connects or disconnects, when someone taps "I'm back" and when a hand ends, never on a timer.
- **Seats:** 2–9 seats (default 8). A player taps an empty seat and enters their name and buy-in amount.
- **Seat approval:** the owner gets a popup to approve or decline each seat request. In that popup they can edit the player's starting stack before they sit. Rebuy requests use the same popup.
- **Disconnects:** a disconnected player keeps their seat. Mid-hand, their timer runs and they auto-check or fold. If they're still disconnected when the hand ends, they're marked away for the next hand. Reconnecting doesn't clear away: the player taps "I'm back".
- **Away:** a player can toggle Away to sit out from the next hand. Away players are skipped: they're dealt no cards and post no blinds or bomb-pot antes.
- **Pause / end:** the owner has Pause and End buttons, which take effect after the current hand. Between hands, if fewer than 2 seated players are active (not away, with chips), the game pauses automatically and shows "Paused: waiting for players"; only the owner can press Start to resume. A new table also starts paused. The owner presses Start Game to begin or resume.
- **Kicking:** the owner can kick a player. Kicking takes effect after the current hand, and the player's stack is cashed out to the ledger.
- **Spectators:** anyone with the link can watch without a seat. They never see hole cards before showdown.
- **Lifetime:** tables live in memory only. A table with no connected players for 12 hours is deleted. When the owner ends a game, the final ledger and settle-up are shown and can be downloaded as CSV.

---

## 5. Table settings (owner menu)

The owner can change settings at any time, including during a hand. Changes apply from the next hand, never mid-hand; until then every player sees a "Changes apply next hand" notice.

| Setting | Default | Notes |
| --- | --- | --- |
| Variant | NLH | Dropdown of presets |
| SB / BB / ante | 10 / 20 / 0 | |
| Seats | 8 | 2–9, capped by deck math |
| Boards | 1 | 1 or 2 |
| Bomb pot | Off | Off / every hand / every N hands; ante in BB (default 2 BB); away players skip it |
| Cent mode | Off | Amounts are always stored as integers, never floats. Off: shown as whole numbers (1980); inputs take whole numbers. On: shown as amount / 100 with 2 decimals (1980 → 19.80) everywhere (stacks, pot, bets, blinds, antes, ledger, settle-up); inputs accept decimals and multiply by 100 (0.50 → 50) |
| UTG straddle (2 BB) | No | Off automatically during bomb pots |
| Run it twice | No | No / ask players / always; disabled where deck math fails |
| Rabbit hunt | No | |
| Decision time | 20 s | Plus a 60 s time bank per player, refilled 10 s every 10 hands |
| Auto-start next hand | Yes | 3 s pause to show results; 5 s while anyone can still show their cards (§7) |
| Reveal hands when no more action is possible | Yes | |
| Rebuys | Yes | Through the owner approval popup |
| Chat | Yes | |
| Spectators | Yes | |

### Players tab (owner menu)

- Lists every player, with their current stack.
- The owner can add to, remove from or set any player's stack. Every change is written to the ledger.
- Kick button.
- Transfer ownership.

---

## 6. Ledger and settle-up

A **Ledger** button at the bottom left opens a table for the current session only.

| Column | Meaning |
| --- | --- |
| Player | Nickname |
| Buy-in | Total chips brought in |
| Buy-out | Total chips taken out |
| Stack | Current chips at the table |
| Net | Buy-out + stack − buy-in |

Store one entry per event, so the ledger is an audit log, not just running totals:

| Event | Effect |
| --- | --- |
| Approved sit-in at X | Buy-in += X |
| Rebuy / owner adds X | Buy-in += X |
| Owner removes X | Buy-out += X |
| Owner sets stack to Y | The difference goes to buy-in (if up) or buy-out (if down) |
| Player leaves or is kicked | Buy-out += stack; stack = 0 |

**Invariant:** between hands, the sum of all players' nets must be 0. Assert this on the server after every hand; it catches pot-splitting bugs.

**Settle-up:** when the game ends, show the fewest payments that settle the ledger, e.g. "Sam pays Alex $32". Greedily match the largest debtor to the largest creditor, which needs at most n − 1 payments. Offer a CSV download. The app never handles real money; it only does the arithmetic.

---

## 7. UI

- Works in mobile and desktop browsers. The table lays out horizontally or vertically depending on the screen's aspect ratio; design mobile portrait first.
- **Layout:** top bar, the table, and a bottom toolbar (Ledger, Pause, Last hand, Rebuy, Leave, Away; on phones Last hand, Rebuy and Leave are in a "⋯ More" menu so the toolbar fits 390 px). There is no side panel: the table uses the full width, and your cards and hand label are at your seat. Seats are spread round the table so the bottom corners stay clear for your seat and the action float.
- There are no chip graphics, only numbers. The total pot is shown in the middle of the table, above the board.
- A dealer button marker rotates around the table.
- **Seats:** no box or panel behind a seat: its cards sit on the felt as two large overlapping cards (Omaha variants fan 4–5), face down for opponents, with name and stack as plain text (with a subtle shadow) next to or under them, and the current bet toward the centre. Only the seat whose turn it is gets a thin gold glow. Your own seat is bigger. On a phone, tableside cards are large enough to read; opponents' Omaha fans are a little smaller so a full table fits.
- **Hero area:** your seat (bottom centre) is reserved: no other seat, bet or button enters it. On narrow screens opponent seats shrink and move toward the rail rather than overlap anything.
- **Hand-strength tag:** a small coloured tag under the cards names the hand ("PAIR", "TWO PAIR", "FLUSH"; Hi/Lo shows both halves, e.g. "FLUSH" + "8-6 LOW"; double board shows a "B1" and a "B2" row, both always fully visible). Only the card's owner sees it, until showdown. On a phone, opponents' showdown tags use short names ("TRIPS", "QUADS") and leave out "NO LOW".
- **Dealer button:** shown above the seat that has it.
- **Action float:** floats over the bottom-right corner of the table, above the toolbar, and never covers your seat or the board.
  - Your turn: Fold (red), Check or "Call 20" (neutral), Raise/Bet (gold), as large bold buttons (at least 56 px tall on desktop, 48 px on phones, 16–18 px text), with your decision timer as a bar above them. Your seat pulses. No sound.
  - Otherwise a compact status pill: "Waiting for Bob…", "Your turn in 2" (players still to act before you), or "Hand over" with a Details link that opens the hand result (winners, Verify, Rabbit hunt). Nothing else takes space.
  - Run it twice, Pineapple discards and "waiting for approval" appear in the same spot.
  - Raise opens a panel directly above the buttons: presets, then a slider with the editable amount, then Confirm (and Cancel).
  - Presets: Preflop when nobody has raised yet: Min, 2 BB, 3 BB, All in. Preflop after a raise: Min, ⅓ pot, ½ pot, ¾ pot, Pot, All in. Postflop: ½ pot, ¾ pot, Pot, All in. A pot fraction raises to the current bet plus that share of the pot after calling.
  - In pot-limit games every preset is capped at the maximum pot-sized raise, and a capped All in is labelled "Pot (max)".
  - Presets below the min raise or above the player's stack are hidden; presets that land on the same amount are shown once.
- **Phones (portrait):** no background bars: the toolbar buttons and the action float's buttons or pill sit on the page background as separate rounded elements. The action float spans the full width at the bottom, above the toolbar, clear of the safe areas; the table shrinks to fit above it, so nothing overlaps the buttons or your seat. The raise panel opens as a bottom sheet over the table, just above the buttons. The owner's approval popup waits until you've acted.
- **Show cards after a hand:** from the end of a hand until the next deal, anyone who was dealt in and whose hand wasn't shown down (they folded, or won uncontested) can show it. At their own seat they tap "Show all", or tap cards to pick some (tap again to unpick) and show those. Showing is final. Shown cards appear face up at that seat, with a small "Shown" tag, for everyone including spectators, until the next deal, and are recorded in the last-hand replay and the fairness proof. The server only accepts cards the player held at the end of the hand (never a Pineapple discard) and never sends unshown cards to anyone else.
- **Run it twice:** a prompt appears when it's eligible and disappears after 5 s; no answer means it runs once.
- **Pineapple:** a discard picker appears on each discard street.
- Double board shows two stacked boards, each labeled with its share of the pot.
- **Away button** ("I'm back" when away), always visible to seated players. The owner's **Pause** button is always visible too; Pause takes effect after the current hand.
- **Copy link:** when no hand is running (a new table, paused, or waiting for players), a "Copy link" button in the centre of the felt copies the table URL and briefly shows "Copied".
- **Refresh:** reloading the page mid-game reconnects to the same table, seat and cards, with no re-join prompt.
- **Ledger button**, bottom left.
- **Chat panel**, if enabled.
- **Fairness:** at hand start, show a short deck hash. After the hand, a "Verify" link checks the revealed cards against it in the browser (per-card commitments: see §8).

---

## 8. Architecture

```
Browser (Next.js on Vercel)
   │  sends actions over WebSocket
   ▼
Table Durable Object (Cloudflare, one per table, in memory)
   1. Validate   — is it this seat's turn? is the amount legal?
   2. Engine     — pure reducer: state + action → new state
   3. Ledger     — append event, assert sum of nets = 0
   4. Redact     — build each seat's view (only their own hole cards)
   │  broadcasts each player's view
   ▼
Browsers render only what they receive
```

- The server is authoritative. Clients never compute game state.
- The engine is a pure reducer with no I/O, no `Date.now` and no `Math.random`; randomness and time are passed in. The action log doubles as hand history and makes hands replayable.
- **Provable fairness (per-card commitments):** at hand start, each deck position gets its own random salt and hash SHA-256(salt:index:card), and the server publishes SHA-256 of all those hashes. After the hand it reveals every position hash, plus the salt and card only for cards that became public (boards, shown hands, rabbit cards once hunted), so folded hands and discards stay secret.

## 9. Stack

| Layer | Pick |
| --- | --- |
| Language | TypeScript everywhere |
| Monorepo | pnpm workspaces: `apps/web`, `apps/server`, `packages/engine` |
| Frontend | Next.js (App Router) + Tailwind, deployed on Vercel |
| Realtime / state | Cloudflare Durable Objects with SQLite storage (required on the free plan), deployed with Wrangler |
| WebSockets | Durable Object WebSocket Hibernation API (`ctx.acceptWebSocket`), so idle tables aren't charged for run time |
| Message validation | Zod, on every client message, on the server |
| Shuffle | `crypto.getRandomValues` + unbiased Fisher-Yates |
| Hashing | Web Crypto SHA-256 |
| Hand evaluator | Custom (brute-force combinations handle Omaha 2+3, short deck and Hi/Lo cleanly) |
| Tests | Vitest + fast-check |

Deployed Worker: `garagepoker.anshiwang.workers.dev`. The Durable Object class is `TableRoom`, with binding `TABLE`.

---

## 10. Build phases

Each phase has a hard exit test. Don't start the next phase until it passes.

1. **Engine only (`packages/engine`).**
   - Cards, deck, shuffle, evaluator, NLH/PLO/PLO5 hand state machine, side pots, pot-limit math.
   - **Exit:**
     - Exhaustive 5-card evaluator test: 52-card deck category counts 1302540 / 1098240 / 123552 / 54912 / 10200 / 5108 / 3744 / 624 / 40.
     - Property test over 100k random hands: chips are conserved and no card is dealt twice.
     - Every Omaha label uses 2 + 3.
2. **Playable table.**
   - Durable Object, WebSocket protocol, seat request and owner approval with stack edit, owner menu, ledger, away, pause/end, mobile-first UI.
   - **Exit:** a full real session with friends with no manual fixes.
3. **The wedge (launch).**
   - Bomb pots, double board, PLO Hi/Lo, PLO5 Hi/Lo, settle-up + CSV.
   - **Exit:** a fixed test case where a double-board Hi/Lo hand with a side pot splits correctly.
4. **Depth.**
   - Run it twice, rabbit hunt, Pineapple, short deck, provable fairness UI, spectators, last-hand replay.

---

## 11. Out of scope

- Accounts, persistent history across sessions, and real-money handling.
- Tournaments.
- Native apps.
