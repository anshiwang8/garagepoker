# GaragePoker

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

A real-time multiplayer poker web app for home games, with every common variant and table option available for free.

**Live:** https://garagepoker-flax.vercel.app/

This project was built as an introduction to real-time systems, game-state design and full-stack deployment. It has a pure TypeScript poker engine, a Cloudflare Durable Object per table that runs the game, and a Next.js frontend that works on phones and desktops.

A player creates a table, picks the game and shares the link. Friends join with a nickname, with no account, and the table owner approves each seat. Chips are play money. At the end of the game, the app works out who owes whom; the actual payments happen outside the app.

The project currently supports seven variants:

- No-Limit Hold'em
- Pot-Limit Omaha
- 5-Card PLO
- PLO Hi/Lo (8-or-better)
- 5-Card PLO Hi/Lo
- 5-Card Pineapple
- Short Deck (36 cards)

These table options work with any variant: bomb pots, double board, run it twice, rabbit hunt, UTG straddle, a decision timer with time bank, spectators, a hand ledger with settle-up, and a provably fair shuffle.

## Table of Contents

- [Background](#background)
- [Architecture](#architecture)
- [Game Engine](#game-engine)
- [Server](#server)
- [Frontend](#frontend)
- [Testing](#testing)
- [Install](#install)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Lessons Learned](#lessons-learned)
- [Known Issues](#known-issues)
- [Contributing](#contributing)
- [License](#license)

## Background

The goal of this project was to build a free alternative to existing online home-game sites. Those sites typically offer only Hold'em, Omaha and Omaha Hi/Lo, and charge for features like bomb pots and double board.

Running a poker table in a browser raises three separate problems:

1. **Correctness:** the rules engine must handle betting limits, side pots, split pots and hand ranking exactly, with no rounding errors.
2. **Real-time state:** every player must see the same table, updated instantly, while only seeing the cards they're allowed to see.
3. **Fairness:** players must be able to trust that the deck isn't changed during a hand.

The project is built around those three problems. The full product and rules specification is in [`SPEC.md`](SPEC.md).

## Architecture

The server makes every decision. Browsers send actions and display whatever view the server sends back; they never compute game state themselves.

```
Browser (Next.js on Vercel)
  ↓  action over WebSocket, e.g. { type: "raise", amount: 120 }
Cloudflare Worker
  ↓  routes the request to the table's Durable Object
TableRoom Durable Object (one per table)
  ↓
1. Validate the message (Zod schema)
  ↓
2. Validate the move (is it this seat's turn? is the amount legal?)
  ↓
3. Game engine: (state, action) → new state
  ↓
4. Ledger: append event, check that all nets sum to 0
  ↓
5. Save the state and schedule the next timer (alarm)
  ↓
6. Build a separate view for every connected player
  ↓
Each browser receives only its own view
```

The code is split into a monorepo (pnpm workspaces):

| Package | Role |
| --- | --- |
| `packages/engine` | Pure TypeScript game logic. No network, no clock, no randomness of its own. |
| `packages/protocol` | Zod schemas for every message between browser and server, shared by both sides. |
| `apps/server` | Cloudflare Worker + `TableRoom` Durable Object. |
| `apps/web` | Next.js (App Router) + Tailwind frontend. |

Keeping the engine pure was the most important design decision. Randomness and time are passed in as arguments, so the same inputs always produce the same outputs. That makes every hand replayable and lets the engine be tested exhaustively without a server.

## Game Engine

### Variants as parameters

Rather than hard-coding each game, a variant is a combination of six parameters:

| Parameter | Values |
| --- | --- |
| Hole cards | 2, 4, 5 |
| Deck | 52, or 36 (short deck, 6 to A) |
| Betting | No-limit, pot-limit |
| Hand rule | Best 5 of all cards, or exactly 2 hole + 3 board (Omaha) |
| Pot split | High only, or high/low 8-or-better |
| Discards | None, or 1 each preflop, flop and turn (Pineapple) |

Two table modifiers work on top of any variant: number of boards (1 or 2) and bomb pots. "Double board bomb pot PLO" isn't a separate game: it's PLO with 2 boards and bomb pots turned on. Adding a new variant means adding one row of configuration, not new logic.

### Cards and shuffling

A card is an integer from 0 to 51: `rank = card >> 2`, `suit = card & 3`. Integers are cheap to copy and compare, and easy to send over the network.

The deck is shuffled with Fisher-Yates using `crypto.getRandomValues`. Random numbers are drawn by rejection sampling, which discards any draw that would make some cards slightly more likely than others (the bias you'd get from a simple modulo).

### Hand evaluator

The evaluator checks every legal 5-card combination and keeps the best one:

- **Hold'em / Pineapple / Short Deck:** best 5 of 7 cards → 21 combinations
- **Omaha (4 cards):** exactly 2 of 4 hole × 3 of 5 board → 6 × 10 = 60 combinations
- **5-Card PLO:** 10 × 10 = 100 combinations

Brute force is fast enough at this scale, and it makes Omaha's "exactly two hole cards" rule simple to enforce. That rule is the most common bug in hobby Omaha implementations: four hearts in your hand plus one on the board is **not** a flush.

Short deck uses its own ranking table (Triton rules): a flush beats a full house, three of a kind beats a straight, and A-6-7-8-9 is the lowest straight.

Hi/Lo games also evaluate an 8-or-better low hand. The high and low halves can use different hole cards.

### Betting and pots

The engine handles:

- the dealer button, blinds and heads-up blind order
- antes, UTG straddle and bomb-pot antes
- no-limit and pot-limit raise sizes
- minimum raises (the size of the last raise, not double the bet)
- all-ins that are smaller than a full raise, which don't reopen betting for players who already acted
- side pots for every all-in

A single pot can be split several ways at once:

```
pot
  ↓  split into side pots by all-in amounts
  ↓  each side pot split between board 1 and board 2
  ↓  each board split into high half and low half (Hi/Lo)
  ↓  each half split between tied hands
```

A double-board Hi/Lo hand with a side pot can therefore produce up to 8 separate payouts. Odd chips go to the high hand, then to the first seat left of the button.

### Deck math

Not every combination of settings fits in a deck. The engine checks this before saving settings:

```
seats × hole cards + boards × 5 × runs ≤ deck size
```

For example, 5-Card PLO on two boards at 8 seats needs 40 + 10 = 50 cards, which fits. Turning on run it twice would need 60, so that option is disabled with an explanation. No burn cards are used: they prevent card marking at a live table, but do nothing when the server shuffles.

### Money

All chip amounts are stored as integers. "Display cents" mode only changes how they're shown (1980 → 19.80). Floating-point arithmetic is never used on amounts.

## Server

### Durable Objects

Each table is one Cloudflare Durable Object. A Durable Object is a single instance with its own storage, which processes one request at a time. That gives each table:

- **No race conditions:** two players acting at the same moment are processed one after the other.
- **In-memory state** that is also saved to SQLite storage, so it survives restarts.
- **WebSockets with hibernation:** the object can sleep while players stay connected, so idle tables cost almost nothing.

### Per-player views

After every change, the server builds a separate view for each connected player. A view includes only that player's own hole cards, plus cards that have legitimately been shown (showdown, "show cards" after a hand, or rabbit hunt). Opponents' cards are never sent to a browser that shouldn't see them, so they can't be found by inspecting network traffic.

### Timers and alarms

A table has to act when nobody clicks anything:

| Timer | Action |
| --- | --- |
| Decision timer | Auto-fold when a player runs out of time and time bank |
| Next hand | Deal the next hand 3 s after a hand ends (5 s if someone can still show cards) |
| Owner hand-off | Pass ownership on if the owner has been offline for 5 minutes |
| Idle delete | Delete a table after 12 hours with nobody connected |

A hibernating Durable Object can't use `setTimeout`, because a sleeping object's timers never fire. Instead, after every change the table works out which timer is due soonest and sets a single **alarm**. Cloudflare wakes the object at that time.

### Ledger

Every chip movement that isn't part of a hand is recorded as an event:

| Event | Effect |
| --- | --- |
| Approved sit-in at X | Buy-in += X |
| Rebuy / owner adds X | Buy-in += X |
| Owner removes X | Buy-out += X |
| Player leaves | Buy-out += stack |

`Net = buy-out + stack − buy-in`. Between hands, the sum of every player's net must be exactly zero. The server checks this after every hand, so any bug that creates or destroys chips is caught immediately instead of showing up as wrong totals at the end of a game.

When the game ends, settle-up finds the fewest payments that settle everyone. It repeatedly matches the biggest loser with the biggest winner, which needs at most n − 1 payments.

### Provable fairness

At the start of each hand, the server publishes:

```
SHA-256(salt + ":" + deck order)
```

After the hand, it reveals the salt and the deck. Any player can recompute the hash in the browser and confirm the deck wasn't changed during the hand.

### Security

- Every incoming message is validated with Zod before it reaches the engine.
- Only the production site and `localhost` may create tables or open table connections (origin allowlist).
- Table creation is rate-limited per IP address.
- Players are identified by a random token stored in the browser, not by nickname, so a page refresh keeps your seat.

## Frontend

The frontend is designed for phones in portrait first, then scales up to desktop.

- **Table:** a tall felt on phones and a wide table on desktop. The viewer is always seated at the bottom center.
- **Seats:** cards sit on the rail with a small name plate underneath. The active player's plate lights up, with a shrinking timer bar.
- **Actions:** large Raise / Check-Call / Fold buttons at the bottom right. Keyboard shortcuts work on desktop: K check, C call, R raise, F fold.
- **Raise panel:** a bet box showing the size in big blinds, preset buttons, a slider with fine-step buttons, and Back / Raise.
- **End of hand:** your net result for the hand, a "Show all cards" button or individual card buttons, and a rabbit hunt reveal.
- **Dev states:** a development-only page, `/dev/table-states`, renders every table state from mocked data, so the layout can be checked without playing real hands.

## Testing

```
pnpm test
```

The test suites cover:

- **Exhaustive evaluator check:** all 2,598,960 five-card hands are evaluated, and the count of each hand type is compared against the known totals (e.g. 1,302,540 high-card hands and 40 straight flushes). The 36-card short deck is checked the same way.
- **Property test:** 100,000 randomly generated hands across variants, boards, bomb pots and run it twice, checking that chips are always conserved and no card is ever dealt twice.
- **Fixed scenarios:** hand-calculated pot splits for double-board Hi/Lo bomb pots with side pots.
- **Server tests:** simulated players run full hands through a real Durable Object, checking that no player ever receives another player's hidden cards, and that every scheduled alarm is in the future.

## Install

Requirements:

- Node.js 22 or newer
- pnpm 10 or newer
- A Cloudflare account (to deploy the server)
- A Vercel account (to deploy the frontend)

```sh
git clone https://github.com/anshiwang8/garagepoker.git
cd garagepoker
pnpm install
```

The main technologies are:

- TypeScript
- Next.js and React
- Tailwind CSS
- Cloudflare Workers and Durable Objects
- Zod
- Vitest and fast-check

## Usage

### Run locally

Run the server and frontend in two terminals:

```sh
# Terminal 1: game server on http://localhost:8787
cd apps/server
pnpm dev
```

```sh
# Terminal 2: frontend on http://localhost:3000
cp apps/web/.env.example apps/web/.env.local
cd apps/web
pnpm dev
```

Open http://localhost:3000 and create a table.

To play as several people on one computer, use separate browser identities: a normal window, a private window and a different browser. Tabs in the same browser share one player token, so they count as one player.

### Deploy the server

```sh
cd apps/server
npx wrangler login
npx wrangler deploy
```

Run `wrangler deploy` after any change to `apps/server`, `packages/engine` or `packages/protocol`. Pushing to GitHub doesn't update the server.

### Deploy the frontend

Import the repository into Vercel:

| Setting | Value |
| --- | --- |
| Root Directory | `apps/web` |
| Include files outside the root directory | On |
| Framework Preset | Next.js |
| `NEXT_PUBLIC_SERVER_URL` | The Worker URL, e.g. `https://garagepoker.<subdomain>.workers.dev` |

Vercel redeploys on every push. After changing `NEXT_PUBLIC_SERVER_URL`, redeploy, because the value is built into the site.

### Configuration

| Variable | Location | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SERVER_URL` | `apps/web/.env.local`, Vercel | Base URL of the Worker. Production builds fail if it's missing. |
| `ALLOWED_ORIGINS` | `apps/server/wrangler.jsonc` | Comma-separated sites allowed to use the server. |

## Project Structure

```
garagepoker/
│
├── SPEC.md                    product and rules specification
├── CLAUDE.md                  project rules for AI-assisted development
│
├── packages/
│   ├── engine/
│   │   ├── src/
│   │   │   ├── cards.ts       card encoding and parsing
│   │   │   ├── deck.ts        deck building and shuffling
│   │   │   ├── evaluator.ts   hand ranking (high, low, short deck)
│   │   │   ├── hand.ts        hand state machine and variants
│   │   │   ├── pots.ts        side pots and pot splitting
│   │   │   ├── ledger.ts      buy-in / buy-out events
│   │   │   ├── settle.ts      settle-up payments
│   │   │   ├── settings.ts    table settings and deck math
│   │   │   └── ...
│   │   └── test/
│   │
│   └── protocol/
│       └── src/index.ts       client ↔ server message schemas
│
└── apps/
    ├── server/
    │   ├── src/
    │   │   ├── index.ts       Worker routes and TableRoom Durable Object
    │   │   ├── table.ts       table rules: seats, owner, timers
    │   │   ├── view.ts        per-player redacted views
    │   │   └── rateLimit.ts   table-creation rate limiter
    │   ├── test/
    │   └── wrangler.jsonc
    │
    └── web/
        └── src/
            ├── app/
            │   ├── page.tsx              create / join a table
            │   ├── t/[id]/               table page
            │   └── dev/table-states/     mocked UI states (dev only)
            ├── components/
            └── lib/
```

## Lessons Learned

Most of what this project taught came from things that broke after deployment, not while writing the code.

### An alarm loop used the whole free tier

Within a day of deployment, the Cloudflare account hit its free-tier limit of 100,000 Durable Object requests, with only a few testers. The logs showed one table's alarm firing over and over with nobody playing.

The cause was the owner hand-off timer. When the owner had been offline for 5 minutes and no other player was connected to take over, nothing changed. The table then rescheduled its alarm for "5 minutes after the owner went offline", a time already in the past, so Cloudflare woke it again immediately. Every abandoned table looped like this for 12 hours until it was deleted.

The fix had three parts:

1. A timer is only scheduled if it can actually act when it fires. Hand-off now happens when an eligible player connects, not on a repeating timer.
2. As a safety net, any alarm scheduled in the past is pushed 5 seconds into the future and logged as a warning.
3. Every server test now checks that the next alarm is in the future after every event. Reintroducing the old bug makes three tests fail.

The lesson: in a system that schedules its own wake-ups, "do nothing and reschedule" must never produce a time that has already passed.

### Production was quietly using localhost

The deployed site worked on a laptop but failed on phones with "Load failed". The browser's network tab showed requests going to `http://localhost:8787`.

The frontend fell back to `localhost` when `NEXT_PUBLIC_SERVER_URL` was missing, and the variable had never been set in Vercel. On the development laptop, a local server happened to be running, so production was silently talking to it. A phone has no local server, so every request failed.

The fix was to make the production build fail if the variable is missing. A missing setting is now a build error instead of a bug that only appears on someone else's device.

### Two deploy targets drift apart

After the frontend redeployed, creating a table returned "Invalid request". The frontend (auto-deployed by Vercel on every push) was sending the newest settings format, but the server (deployed manually with `wrangler deploy`) was still running older code that rejected the new fields. Shared message schemas only help if both sides are deployed together.

### iPhone browsers are all Safari underneath

The layout worked in desktop Chrome's phone emulator but not on a real iPhone. Every iOS browser, including Chrome, must use Apple's WebKit engine, so desktop emulation can't reproduce iPhone-specific problems.

Fixes included:

- lowering the JavaScript build targets so syntax is converted for older Safari versions
- replacing newer methods such as `Array.prototype.at`
- adding an on-screen error banner (written in old-style JavaScript so it runs even if the main code fails to load), so errors can be read on a phone with no developer tools

### Monorepo build tools disagree on imports

The engine's TypeScript files imported each other as `./cards.js`, a normal TypeScript convention. Vitest and Wrangler understood it, but Next.js's bundler (Turbopack) didn't. The fix was extensionless imports. Vercel also needed its Root Directory set to `apps/web`, with access to files outside it, so the build could find the shared packages.

### Phones drop connections constantly

Mobile browsers close WebSockets when the screen locks or the user switches apps. Treating every disconnect as "player left" would bench mobile players all the time. Instead, a disconnected player keeps their seat and times out normally during a hand, and is marked away only if they're still gone when the hand ends.

### Verify the tests, not just the results

AI-generated tests can pass while proving nothing: a pot-split test with wrongly calculated "expected" amounts would pass just as happily as a correct one. Exhaustive checks against known totals, property tests on invariants (chips conserved, no duplicate cards) and hand-checked fixed scenarios proved more trustworthy than many small example tests.

## Known Issues

### No accounts or history

Tables exist only while in use and are deleted after 12 hours with nobody connected. There's no login, saved hand history or cross-session statistics.

### `workers.dev` may be blocked on some networks

Some school, workplace and DNS-filtered networks block `*.workers.dev` addresses. Moving the server to a custom domain would avoid this.

### Rate limiting uses Durable Objects

The table-creation rate limiter is itself a Durable Object, so each table creation costs an extra Durable Object request. Cloudflare's built-in rate-limiting binding would avoid that.

### Real-world testing

Most testing so far has been small sessions. Behavior with full 8–9 player tables on unreliable mobile connections needs more real-world play.

## Contributing

Bug reports and suggestions are welcome: [open an issue](https://github.com/anshiwang8/garagepoker/issues).

For code changes:

- read [`SPEC.md`](SPEC.md) and [`CLAUDE.md`](CLAUDE.md) first
- keep `packages/engine` free of I/O, clocks and randomness
- add tests for every engine change
- run `pnpm test` and `pnpm typecheck` before opening a pull request

## License

UNLICENSED — Copyright © 2026 Anshi Wang.

No license has currently been selected for this repository. Until a license is added, the source code should not be assumed to grant permission for reuse, modification, or redistribution.
