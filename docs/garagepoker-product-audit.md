# GaragePoker product audit

Audit of the private-table experience: what exists, what's incomplete, what's missing, and what to do next. No code was changed for this audit.

- **Date:** 2026-11-07
- **Code audited:** `main` at `6aa8fe9` (includes Tic-Tac-Toe Hold'em, the phone blank-felt fix and the "Pair" labels).
- **Method:**
  - Read the engine, protocol, server and web app.
  - Played a full private session locally (Wrangler + Next dev) with two browsers, screenshotting every step at 1440×900, 768×1024, 390×844 and 360×800.
  - Looked at Poker Now's public pages, without creating a game there or a table on the live site.
- **Screenshots:** `docs/audit/` (JPEG). The full set of 64 is in `.playwright-mcp/audit/` locally and isn't committed.
- **Not checked:** Poker Now's in-game screens. Creating a game on their site and creating tables on the live production site were both blocked as outward-facing actions. The in-game comparison in §3 is from Poker Now's documented, publicly known behaviour, and is marked as such.

**Scope:** private, invite-only tables only. No lobbies, matchmaking, tournaments, voice/video, paywalls or real money; nothing below proposes any of them.

---

## 1. Summary

GaragePoker already gets the hard parts right:
- a correct, well-tested engine with eight variants and every table option free;
- a server-authoritative design that never leaks hidden cards;
- reconnect on refresh;
- an owner approval flow;
- a ledger with settle-up and CSV.

The gaps are mostly around the edges of the game:
1. **Reliability:** three real bugs. A double tap can act on the next street; an unexpected error can freeze a table; a brief disconnect during your time bank folds you instantly.
2. **Missing features the SPEC already calls for:** text chat, and "reveal hands when no more action is possible".
3. **Table creation:** every setting is up front (about 20 controls, about 1,900 px of scrolling on a phone). Poker Now asks for a nickname only.
4. **Session tools:** only the last hand is kept, there are no stats, and there's no recap.
5. **Polish:**
   - Colours are partly hard-coded.
   - Dialogs don't manage focus.
   - Several touch targets are under 44 px.
   - No action button has a pending or "sent" state.

A few requests in the brief conflict with SPEC.md, which is the repo's source of truth; they're listed in §8 for a decision before any work starts.

---

## 2. Feature inventory

### 2.1 Existing and working

| Area | What exists | Where |
| --- | --- | --- |
| Variants | NLH, PLO, PLO5, PLO Hi/Lo, PLO5 Hi/Lo, 5-card Pineapple, Short deck, Tic-Tac-Toe Hold'em | `packages/engine/src/hand.ts` (`VARIANTS`) |
| Table options | Blinds/ante, 2–9 seats, 1–2 boards, bomb pots (every hand / every N, 1–10 BB ante), decision time 10–90 s, time bank 0–180 s, run it twice (no/ask/always), rabbit hunt, UTG straddle, spectators, auto-start, rebuys, cent mode. All validated against deck math | `packages/engine/src/settings.ts`, `apps/web/src/components/SettingsForm.tsx` |
| Engine correctness | Exhaustive evaluator test, 100k-hand property test (chips conserved, no card dealt twice, Omaha 2+3, Tic-Tac-Toe lines), side pots, hi/lo quartering, odd chips | `packages/engine/test` (136 tests) |
| Private links | Unguessable 10-character IDs (~59.5 bits), no listing endpoint, unknown ID → 404, allowed-origin check, table creation rate-limited (5/min/IP) | `apps/server/src/index.ts`, `limits.ts`, `rateLimit.ts` |
| Identity | Random per-browser token (localStorage + cookie), no accounts; the token owns the seat | `apps/web/src/lib/token.ts`, `apps/server/src/table.ts` |
| Reconnect | Refresh or reconnect mid-hand returns the same seat and cards; client backs off 1 → 10 s and pings every 25 s | `apps/web/src/lib/useTableSocket.ts`, `room.test.ts` |
| Hidden information | Views are built field by field per viewer. Folded cards, Pineapple discards, deck, salts and unhunted rabbit cards never reach a client, and spectators get the same treatment | `apps/server/src/view.ts`, `fairness.test.ts` |
| Host controls | Approve/decline seats (stack editable), approve rebuys, add/remove/set chips (ledgered), kick (after the hand), make someone else owner, pause/resume, end game, change settings (applied next hand), spectators on/off | `apps/server/src/table.ts`, `OwnerMenu.tsx` |
| Owner hand-off | After 5 minutes offline, ownership passes to the longest-seated eligible player | `table.ts` |
| Ledger | Sit-in, rebuy, add/remove/set, leave, kick, with buy-in/buy-out/stack; sum of nets asserted 0 every hand; greedy settle-up; CSV with formula-injection guard | `packages/engine/src/ledger.ts`, `settle.ts`, `apps/web/src/lib/csv.ts` |
| Fairness | Per-card SHA-256 commitments at hand start, browser-side Verify | `apps/server/src/fairness.ts`, `VerifyDialog.tsx` |
| Last-hand replay | Step-through replay of the last finished hand, own and shown cards only | `apps/server/src/replay.ts`, `ReplayDialog.tsx` |
| Action UI | Raise/Bet, Check/Call X, Fold; raise panel with presets (min, 2–3 BB, ½, ¾, pot, all in; capped in PL), slider, ± buttons, typed-amount validation; keyboard K/C/R/F, Enter, Esc | `ActionZone.tsx`, `packages/engine/src/presets.ts` |
| Timers | Plate timer bar (green → yellow → red, purple in the bank), "Extra time" banner, time bank refills 10 s every 10 hands | `Seat.tsx`, `table.ts` |
| Layout | Phone portrait and desktop stadium layouts that shrink until nothing overlaps; no horizontal scroll at any audited size | `apps/web/src/components/table/layout.ts` |
| Other | Show cards after a hand, rabbit hunt reveal, run-it-twice prompt, Pineapple discard picker, away / I'm back, leave seat | `ActionZone.tsx`, `table.ts` |
| Cost profile | WebSocket Hibernation (pings don't wake the Durable Object); one DO per table; static frontend on Vercel | `apps/server/src/index.ts` |

### 2.2 Existing but incomplete

| Area | What's there | What's missing |
| --- | --- | --- |
| Hand history | Last hand only (overwritten each hand) | Earlier hands in the session; export; your own history across hands |
| Replay | Last hand, 24×34 px cards, 1 step/s | Earlier hands; a bigger, table-like view; pot progression by street |
| Ledger | Live in Options; CSV only after the game ends | CSV any time; the end-of-game ledger **can't be closed** (`TableScreen.tsx:122`) |
| Host controls | Kick, make owner, chip edits | Block a kicked player from re-requesting; remove a spectator; sit someone out; cancel a requested end; approve all |
| Owner hand-off | 5 minutes offline | Checked only on presence change, "I'm back" or hand end; requests pile up meanwhile; the original owner can't take it back |
| Disconnects | Seat kept; auto-check/fold at the deadline | A disconnected player skips the time bank, so a network blip while in the bank folds you instantly (`table.ts:356-361`) |
| Leaving / kicked mid-hand | Applied after the hand | Not folded meanwhile: the hand waits on them, burning their timer |
| Ended table | Final ledger and settle-up | Everything is refused afterwards, including leaving a seat; no "new session" at the same table |
| Error feedback | Server errors become toasts (max 3, 4 s) | Every toast is styled as an error, even notices; no success feedback after acting; no pending state |
| Spectator privacy | `spectators: false` hides the game from people without a seat | No invite code or password; the link is the only credential |
| Preferences | Sound toggle (there are no sounds yet) | Felt/card/reduced-motion preferences; saved presets |
| Mobile | Safe areas top and bottom, `100dvh`, bottom sheets under 640 px | Left/right safe areas (landscape notch); keyboard resizing (`interactive-widget`); landscape phones get the desktop layout with little felt |

### 2.3 Confirmed missing

Each of these was searched for in the code, not assumed.

| Feature | Notes |
| --- | --- |
| **Text chat** | No protocol message, server handler or UI. SPEC §5 lists a Chat setting and §7 a Chat panel |
| **"Reveal hands when no more action is possible"** | SPEC §2.9 and §5 list it; not in `TableSettings`. Hands show only when the hand completes |
| Session hand history (all hands) | Only `lastHand` / `prevHand` / `prevRecord` |
| Session statistics | Nothing accumulates across hands (VPIP, PFR, hands played, biggest pot) |
| Highlights, session recap | None |
| Presets / quick create | No presets or saved configurations; every setting is on the home page |
| Table customisation | One felt, one card back, dark only, no avatars |
| Learn mode / rules help | None in the app (variant cards have one-line descriptions) |
| Invite code / password | None (see §6) |
| Duplicate-submit protection | No pending state on any action button; no per-action sequence check on the server |
| Web tests | None in `apps/web` |

---

## 3. Poker Now comparison (private games only)

**Poker Now creation flow (seen live):**
- The home page's "Start a new game" opens `/start-game`, which has a single **nickname** field and **Create Game**, behind a Cloudflare Turnstile check.
- No settings are chosen up front.

**Poker Now in-game patterns (from its public documentation and well-known behaviour; not re-checked live for this audit):**
- Settings are configured from inside the game.
- Seat requests are approved by the host.
- A copyable invite link is shown prominently while the table is empty.
- A chat and log panel sits beside the table on desktop.
- There is a full session log and hand history.
- Per SPEC.md's positioning: Hold'em, Omaha and Omaha Hi/Lo only, with bomb pots and double board paid. GaragePoker gives these away.

| | GaragePoker | Poker Now |
| --- | --- | --- |
| Taps from landing to a created table | 1 ("Create table" with defaults), but the whole form is in the way: ~20 controls, ~1,900 px on a phone | 1 field + 1 button |
| Taps to a running hand (owner) | ~5: create, Sit, name, Sit down, Start | Not checked (would need a game created) |
| Variants | 8, including Pineapple, Short deck, Tic-Tac-Toe | Hold'em, Omaha, Omaha Hi/Lo (per SPEC.md) |
| Bomb pots, double board, run it twice, rabbit hunt | Free | Bomb pots and double board paid (per SPEC.md) |
| Provable fairness | Per-card commitments, Verify in the browser | Not a user-facing feature |
| Chat | **None** | Yes (publicly known) |
| Hand history | Last hand only | Whole session (publicly known) |
| Mobile | Purpose-built phone layout; raise panel replaces the action row | In-game mobile layout not checked |

**What GaragePoker should borrow, within private-table scope:**
1. Create first, configure later: pick a game (or keep the default) and go, with settings in the owner menu.
2. Chat beside the log.
3. Full session history and a recap.

---

## 4. Desktop usability (1440×900, 1024+)

1. **Lots of empty felt.** On a heads-up or short table the stadium is mostly empty; the log is a small box in the bottom-left corner (`gp-07-preflop-to-act-1440x900.jpg`).
2. **No chat;** the log is read-only and only on screens 1024 px or wider.
3. **Small text links** for important things: "Details" (≈41×18 px) and "Verify" (≈31×16) after a hand.
4. **No pot pill preflop,** only a small "total 30" tag, so the pot is easy to miss before the flop.
5. **No sent/pending feedback** after clicking an action; a slow connection invites a second click (§6).
6. **Focus:** dialogs don't trap or return focus, and there are no visible focus rings beyond input borders.
7. **Escape on stacked dialogs:** Details → Verify are two stacked modals, and one Escape closes both.

## 5. Mobile usability (390×844, 360×800, 768×1024)

1. **Create form is very long:** ~1,900 px at 390 px wide (`gp-01-landing-390x844.jpg`). Seat buttons are 32–35 px wide at 360–390 px.
2. **Touch targets under 44 px:**
   - modal close ✕ (28×32);
   - toggles (24×44);
   - raise presets (36 px tall, 10.5 px text);
   - "Details", "Verify", and the guest's "Cancel" (47×20) while waiting for approval.
3. **Fixed:** blank felt for an unseated viewer before the first hand on 6+ seats (commit `9a03221`).
4. **Landscape phones** get the desktop stadium with a 64 px bar and a ≥100 px action zone, leaving little felt. No left/right safe-area insets.
5. **Keyboard:** no `interactive-widget` / `visualViewport` handling, so the on-screen keyboard can cover the bet box on some phones.
6. **Ledger** scrolls sideways inside its dialog at 360 px.
7. **Notices are styled as errors:** every toast has a red border, even neutral notices.
8. **Working well:**
   - The raise panel at 360×800 (`gp-09-raise-panel-360x800.jpg`).
   - 56 px action buttons.
   - The bottom-sheet modals.
   - The owner's Players tab (`gp-16-owner-players-390x844.jpg`).
   - No horizontal page scroll anywhere.

## 6. Multiplayer reliability and privacy risks

The first three were confirmed in the code.

| # | Risk | Severity | Detail |
| --- | --- | --- | --- |
| R1 | **Double tap acts on the next street** | High | `act` only checks the hand number and whose turn it is (`table.ts:824-826`); the client has no pending state. Heads-up, a doubled "check" on the big blind's option is applied as their first flop action |
| R2 | **An unexpected error can freeze a table** | High | `mutate` rolls back any non-game error and returns without persisting or rescheduling the alarm (`apps/server/src/index.ts:155-160`). If the cause is in the state (e.g. "hand stalled", ledger imbalance), every later message fails the same way, and idle deletion is never scheduled |
| R3 | **Disconnect during the time bank folds instantly** | Medium | `tick()` times out disconnected players at the decision deadline, skipping the bank (`table.ts:356-361`); a socket close runs `tick()` |
| R4 | Half-open sockets count as connected | Medium | Pings are auto-answered and never timestamped; no pong timeout on the client either; affects time bank, owner hand-off and idle delete |
| R5 | Table bloat by anyone with the link | Medium | Unlimited `hello`s with fresh tokens append to `players[]`; no message rate limit; each message rewrites the whole stored blob and broadcasts |
| R6 | Leaving/kicked players stay live mid-hand | Low | Not folded; the hand waits on their timer |
| R7 | Retention | Low | Tables are written to Durable Object storage (SPEC §4 says "memory only") and deleted 12 h after the last connection closes; any open tab, even a spectator's, keeps one alive |
| R8 | Two tabs, one token | Low | Works (presence is a set) but untested; both tabs can act |
| R9 | Link is the only credential | By design | Fine for friends; an optional join code would protect against a forwarded link |

**Server authority:** every card, legal action, chip amount and result is decided by the server; nothing above changes that.

## 7. Recommended improvements, staged

Each stage is a reviewable set of commits with tests, and nothing deploys without your approval. Stages 1–2 follow the SPEC as it stands; stages 3–6 need the decisions in §8.

### Stage 1: reliability (do first; small, high value)
- **R1 (double submit):**
  - Add an action sequence number to `act` that the server checks; a stale one is rejected quietly.
  - Add a pending state on every action button (also run it twice, discard, show cards, approve).
- **R2 (frozen table):** on an unexpected error, persist and reschedule the alarm; recover by voiding the hand (refund to the start-of-hand stacks) rather than freezing; log it.
- **R3 (disconnect folds):** let disconnected players keep their time bank, or give them a short grace period.
- **R4 (half-open sockets):** track last-seen time per socket and treat silent ones as disconnected.
- **R5 (table bloat):** per-socket message rate limit; cap `players[]` (only seated players and owner kept forever, idle spectators pruned).
- **R6:** fold leaving/kicked players when it's their turn.
- **Dialogs:** make the end-of-game ledger closable; stacked dialogs close one at a time.
- **Tests** for each of the above, plus two tabs on one token.

### Stage 2: design system and polish
- **Tokens:**
  - Move the 55 hard-coded hex colours and three different reds into theme tokens.
  - Add radius and shadow tokens.
  - One `Button` family for table controls too.
- **Dialogs:** focus trap and focus return; visible focus rings.
- **Touch targets** of 44 px or more everywhere.
- **Toasts:** separate notice / success / error tones; announce them with `aria-live`.
- **Feedback:** a small "sent" state on actions; pot pill preflop.

### Stage 3: quick private-table creation
- **Home:** game choice (or a preset: Casual Hold'em, Omaha Night, …) plus Create.
- **Settings:** essentials (blinds, seats) visible; everything else in collapsible "Table options" / "Timers" / "House rules" sections. All current settings stay.
- **Invite:** show a prominent invite panel (copy link, native share sheet) while seats are empty.
- **Saved presets:** in the browser's localStorage (no accounts, nothing on the server).

### Stage 4: chat and the missing SPEC features
- **Text chat** (SPEC §5/§7):
  - Per-table and session-only, rate-limited, length-capped.
  - Owner can turn it off.
  - Shown beside the log on desktop and in a sheet on phones.
- **"Reveal hands when no more action is possible"** (SPEC §2.9).
- **Host tools:** block rejoin after a kick, remove spectators, optional join code.

### Stage 5: session history, stats and recap
- **Keep every hand of the session** (bounded, e.g. the last 200) as compact records, and replay any of them.
- **Export your own permitted history** (own cards and shown cards only).
- **Session stats from the records:** hands played, VPIP, PFR, showdowns, pots won, biggest pot, net; each with a one-line explanation.
- **Deterministic highlights:** largest pot, biggest comeback, rare made hands.
- **End-of-session recap:** downloadable image or CSV.

### Stage 6: customisation, Learn mode, house rules
- **Customisation:** felt colours, card face legibility (four-colour deck, large indices), reduced-motion switch; all per browser.
- **Learn mode:** hand rankings, what each action does, NL vs PL, variant rules; never anything about hidden cards.
- **House rules:**
  - 7-2 bounty;
  - dealer's choice (rotating variant);
  - more straddle options.
  - Each needs engine tests before it ships.

### Infrastructure cost

| Item | Today | After stages 1–6 |
| --- | --- | --- |
| Frontend | Vercel (static plus app router) | Same |
| Realtime | One Durable Object per table, SQLite storage (SPEC §9: the free plan requires it); hibernating WebSockets | Same objects |
| Storage | One blob per table, rewritten on every change; deleted 12 h after the last connection | Hand history adds compact records (≈1–2 KB per hand × 200, well under per-value limits if split across keys); chat adds a capped ring buffer |
| Requests | One message per action, plus one alarm per turn | Chat adds messages; rate limits (R5) bound them |
| Paid services | None | None. Everything proposed is computed in the browser or the existing Durable Object; no AI APIs, no new services |

Main lever to keep costs flat: stop rewriting the whole blob on every change. Split hands, chat and the ledger into separate keys during Stage 5.

These are the cost drivers in the code. Check Cloudflare's current free-plan limits (requests, duration, storage per day) before a large session.

## 8. SPEC conflicts that need a decision

The repo's rules say to stop and ask when a task conflicts with SPEC.md. These items from the brief do:

| # | Request in the brief | SPEC.md says | Options |
| --- | --- | --- | --- |
| C1 | Collapsible desktop sidebar for chat and hand history | §7: "three zones … with no side panel"; desktop has a Chat/Log box at the bottom left | (a) keep the bottom-left box and add chat to it, (b) amend the SPEC for a collapsible right sidebar on wide screens |
| C2 | Customisable chip appearance | §7: "There are no chip graphics, only numbers" | (a) keep numbers only, (b) allow optional chip styles |
| C3 | Card backs, themes, avatars | §7: GaragePoker branding only, "our own card back (deep red …)" | (a) a few GP-branded backs and felt colours only, (b) broader themes |
| C4 | Hand history, saved presets and friend groups across sessions | Header: "no long-term storage"; §11: "persistent history across sessions" out of scope | (a) session-only on the server, with presets/groups kept in the browser only, (b) amend the SPEC |
| C5 | Settings moved behind presets / collapsible sections | §5 describes one settings form (owner menu) | Likely just an amendment: same settings, new grouping |
| C6 | Storage | §4/§8 say tables live "in memory only"; the code persists to DO storage (needed to survive eviction) | Amend the SPEC to match the code (recommended) |

## 9. Screenshots

All taken at 390×844 unless noted; files are in `docs/audit/`.

| File | Shows |
| --- | --- |
| `gp-01-landing-390x844.jpg`, `gp-01-landing-1440x900.jpg` | Home page and the full create form (full-page) |
| `gp-02-new-table-unseated-390x844.jpg` | New 8-seat table before anyone sits (after the fix) |
| `gp-06-owner-approval-popup-390x844.jpg` | Owner's seat-approval popup |
| `gp-07-preflop-to-act-1440x900.jpg`, `gp-07-preflop-to-act-360x800.jpg` | Preflop, hero to act, desktop and small phone |
| `gp-09-raise-panel-360x800.jpg` | Raise panel on a small phone |
| `gp-10-flop-768x1024.jpg` | Tablet, flop |
| `gp-11-hand-result-390x844.jpg`, `gp-12-result-details-390x844.jpg` | Hand result and Details |
| `gp-13-options-sheet-390x844.jpg`, `gp-14-ledger-390x844.jpg`, `gp-16-owner-players-390x844.jpg` | Options, ledger, owner's Players tab |

## 10. After

The staged work is done on branch `private-table-improvements`; see `docs/engineering-summary.md`. "After" screenshots are in `docs/audit/after/`, taken at the same sizes from a real local game and the table previews.
