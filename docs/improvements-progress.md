# Private-table improvements: progress

The staged plan from `docs/garagepoker-product-audit.md` §7, worked on the local branch `private-table-improvements`. Nothing has been pushed or deployed.

**Decisions on the SPEC conflicts (audit §8), made 2026-11-07:**
- **C1, desktop:** collapsible right sidebar for chat, log and hand history (SPEC §7 amended).
- **C2/C3, customisation:** GP-branded options only (a few felt colours, four-colour deck and large indices, GP card backs); chips stay numbers.
- **C4, storage:** browser-only for presets and friend groups; hand history is session-only on the server and deleted with the table.
- **C5:** same settings, regrouped (SPEC §5 amended).
- **C6:** SPEC to match the code: tables persist in Durable Object storage until deleted.

**Release order:** protocol changes are backward compatible on the server side. Deploy the server (`cd apps/server && npx wrangler deploy`) **before** the web app.

## Stages

| Stage | Status | Commits / notes |
| --- | --- | --- |
| 1. Reliability | done | Stale-action `seq` + sent state on buttons; recover (cancel hand, restore stacks, pause) instead of freezing; 15 s reconnect grace in the time bank; leaving/kicked players auto-act; 75 s silent-socket detection, pong timeout and reconnect on online/visible; 40 msgs/10 s per socket; visitor pruning (200) and cap (500); closable final ledger; modal focus trap/return, Escape closes only the top dialog, 44 px close button. 10 new server tests. Checked in a browser: a real double click on Check acts once. |
| 2. Design system and polish | done | All 55 hard-coded colours → named theme tokens (one danger red, an alert red for white-text badges, chrome greys, tier/timer/chip/pot tokens); deeper teal and purple for 4.5:1 text. 44 px targets (top bar, steppers, presets, segmented options, toggles, toasts; enlarged hit areas on Details/Verify/Cancel). Raise panel shows Min/Max. Sent buttons dim to 60%, not the 30% "unavailable" look. Toasts: error vs notice tones, aria-live. Global `:focus-visible` gold ring; reduced motion for all animations and transitions; landscape safe-area padding; keyboard resizes the page (`interactive-widget`). Name validation explains `<` `>`. One `Send` type. |
| 3. Quick private-table creation | done | Quick starts (Casual, Competitive, Omaha Night) + browser-saved presets (save/delete, validated on load) + Custom. Essentials shown; advanced settings in three folded sections with summaries (open in the owner menu). Compact 2/4-column game picker. Create button pinned at the bottom on phones (1 tap from landing). Copy link + native Share. Home page height on a phone: ~1,880 → ~1,330 px. |
| 4. Chat, reveal-hands, host tools | done | Text chat (server-stored for the session, 100 kept/40 in views, 1 msg/s, owner toggle, hidden from people who can't watch). Collapsible desktop sidebar (Chat/Log tabs, remembered; collapsed tab with unread count); phones: Options → Chat with an unread dot. Reveal all live hands once nobody can bet (SPEC §2.9; not in discard games), owner toggle. Kick and block / unblock. Optional join code (owner-only in views, case-insensitive, 10-attempt lockout). Older stored tables get the new settings' defaults on load. 7 new server tests; checked live: chat both ways, sidebar collapse/unread, all-in reveal during run-it-twice, join code wrong/right. |
| 5. Session history, stats, recap | done | Every hand indexed (last 200); full records written to their own storage keys (table record stays small); replay any hand; per-viewer text export (own cards + shown cards only). Stats from public actions (VPIP, PFR, showdowns, pots, biggest pot, net) with explanations; deterministic highlights incl. evidence-only shown bluffs; recap dialog + PNG drawn in the browser; ledger CSV any time. Sidebar Hands/Stats tabs; phones: Options → Hand history / Session stats. 4 new server tests (incl. export privacy over real sockets). |
| 6. Customisation, Learn mode, house rules | in progress | |
