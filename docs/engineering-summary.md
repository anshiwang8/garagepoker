# Private-table improvements: engineering summary

Covers the work on branch `private-table-improvements` (`git log main..private-table-improvements`), on top of `main` (`6aa8fe9`), 56 files, about 4,000 lines added. Nothing has been pushed or deployed. The audit that set the plan is `docs/garagepoker-product-audit.md`; stage-by-stage notes are in `docs/improvements-progress.md`.

## Scope kept

Everything serves private, invite-only tables. Not added: lobbies, matchmaking, tournaments, voice or video, public profiles or leaderboards, paywalls, and real money.

Every existing game and setting still works the same:
- all 8 variants, including Tic-Tac-Toe Hold'em;
- blinds and antes, seats, double board, bomb pots, timers and time bank;
- run it twice, rabbit hunt, spectators, straddle, auto-start, rebuys, cent mode;
- the ledger and settle-up, provable fairness, and the last-hand replay.

## Features added, by stage

| Stage | What changed for players |
| --- | --- |
| 1. Reliability | **Double taps:** can't act twice or land on the next street (stale-action `seq` plus a "sent" state on buttons). **Errors:** an unexpected server error cancels the hand with stacks restored and pauses, instead of freezing the table. **Disconnects:** dropping out mid-time-bank gives 15 s to reconnect; dead connections are detected on both ends; reconnect happens when the network or the tab comes back. **Leaving or kicked players** auto-act on their turn. **Abuse limits:** per-connection message limit; visitor pruning and cap. **Dialogs:** the final ledger can be closed; dialogs trap and return focus. |
| 2. Design system | **Tokens:** all hard-coded colours became named tokens (one danger red, tier, timer and felt tokens). **Contrast:** 4.5:1 for text on tags. **Touch targets:** 44 px. **Raise panel:** shows min and max. **Toasts:** error and notice tones, read aloud by screen readers. **Accessibility:** focus rings; reduced motion everywhere. **Phones:** landscape safe areas; the keyboard resizes the page. |
| 3. Table creation | **Quick starts:** Casual Hold'em, Competitive Hold'em, Omaha Night, plus presets saved in the browser, plus Custom. **Layout:** essentials first, the rest in folded sections with summaries; Create pinned at the bottom of the screen (one tap from landing). **Inviting:** Share beside Copy link. The home page is about 30% shorter on a phone. |
| 4. Chat and host tools | **Chat:** table chat. **Desktop sidebar:** collapsible, with Chat, Log, Hands and Stats tabs; collapses to a tab with an unread count. **Phones:** chat in Options with an unread dot. **Early reveal:** live hands are shown once nobody can bet (SPEC §2.9). **Owner tools:** kick and block, unblock; optional join code. |
| 5. Session history | **History:** every hand of the session (last 200), replayable. **Export:** download your own hand history as text (your cards and cards that were shown). **Stats:** VPIP, PFR, showdowns, pots, biggest pot and net, each explained. **Highlights:** deterministic, including a bluff only when the winner showed high card. **Recap:** an image drawn in the browser. **Ledger CSV:** any time. |
| 6. Personalisation | **Appearance:** felt colours, GP card backs, two- or four-colour deck, large card corners, reduce motion. **Learn mode:** How to play, plus optional turn hints. **House rules:** the 7-2 bounty and mixed-games rotation. |
| QA | Web unit tests and Playwright browser tests (below). They found three bugs, fixed in that commit. |

## Decisions on SPEC conflicts

Your choices for the four conflicts were:
- desktop sidebar: collapsible;
- saved data: browser-only;
- customisation: GP-branded only;
- settings: the same ones, regrouped.

SPEC.md is updated to match, along with every other behaviour change: §4, §5, §7 and §8.

## Files

| Area | Main files |
| --- | --- |
| Engine | `packages/engine/src/settings.ts` (chat, reveal, 7-2, mixed-games settings and validation) |
| Protocol | `packages/protocol/src/index.ts` (seq, chat, block, join code, history, export, session view, bounty) |
| Server | `apps/server/src/index.ts` (recovery, rate limit, liveness, history storage), `table.ts` (grace, auto-act, chat, block, code, 7-2, rotation), `session.ts` (new: history, stats, highlights), `replay.ts` (stored hands, text export), `view.ts`, `limits.ts` |
| Web | `components/table/TableScreen.tsx` (sidebar), `Chat.tsx`, `Session.tsx`, `Learn.tsx` (new), `ActionZone.tsx`, `SettingsForm.tsx`, `CreateTable.tsx`, `OwnerMenu.tsx`, `layout.ts`, `ui.tsx`, `app/globals.css`, `lib/useTableSocket.ts`, `lib/prefs.ts`, `lib/tablePresets.ts`, `lib/useSent.ts`, `lib/useMediaQuery.ts` |
| Tests | `apps/server/test/*.test.ts`, `apps/web/src/**/*.test.ts`, `apps/web/e2e/*.spec.ts` |
| Docs | `SPEC.md`, `CLAUDE.md` (e2e command), `docs/garagepoker-product-audit.md`, `docs/improvements-progress.md`, this file |

## Test results (last run)

| Suite | Result |
| --- | --- |
| Engine (Vitest, including the 100k-hand property test) | 136 passed |
| Server (Vitest in workerd: rules, real sockets, fairness, replay) | 104 passed (77 before this work) |
| Web unit (Vitest: layout over ~1,400 combinations, presets, text) | 8 passed (no web tests before) |
| Browser (Playwright, Chrome, 4 screen sizes) | 88 passed |
| `pnpm typecheck`, web lint | clean |

**Manual checks in a real browser against a local server:**
- a double click on Check acts once;
- chat both ways between phone and desktop;
- sidebar collapse with unread count;
- all-in reveal during the run-it-twice question;
- join code, wrong and right;
- replay of hand 1 from storage;
- history download;
- recap image;
- appearance preferences with no hydration errors;
- switching games mid-session.

## Recurring cost

There are no new services and no paid APIs. Everything runs in the existing Durable Object and in the browser.
- **History:** writes one extra storage key per finished hand and deletes the 200th-oldest. The table record itself stays small.
- **Chat:** adds messages, capped at one a second per person and 40 per 10 s per connection.
- **Liveness checks:** run during existing alarms, with no new timers.

Check Cloudflare's current free-plan limits before a very large session.

## Known issues and limits

- **Not deployed.** Release order:
  1. Deploy the server first: `cd apps/server && npx wrangler deploy`.
  2. Then merge or push to `main` for Vercel.

  The server accepts older clients (new fields are optional or defaulted). An older server would reject the new client's messages, so the order matters.
- **Blocking is per browser,** as there are no accounts. It stops a forwarded link, not a determined person (said in the owner menu).
- **Not added:**
  - avatars and chip graphics (decision C3);
  - straddle variants beyond UTG (need engine work);
  - a server-side replay for hands before this version.
- **Stats** cover the last 200 hands of the session and reset with the table, by design (decision C4).
- **The recap image** uses system fonts.

## Recommended next steps

1. Deploy the server, then the web app, and play a real session with friends (SPEC phase 2's exit test).
2. Run the Playwright suite in CI (it needs Chrome on the runner) alongside `pnpm test`.
3. Button and Mississippi straddles, with engine property tests.
4. Optional sound effects (the setting exists; there are no sounds yet).
5. Split chat and the ledger into their own storage keys too, if sessions get long.
