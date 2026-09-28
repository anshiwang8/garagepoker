# GaragePoker

PokerNow-style home-game poker tables. Every variant and table feature is free. No accounts, no real money, no long-term storage.

**Read SPEC.md before any task.** It is the source of truth for rules, settings, ledger and build phases. If a task conflicts with SPEC.md, stop and ask.

## Repo layout (pnpm workspaces)

- `packages/engine`: pure TypeScript game logic (cards, evaluator, hand state machine, pots, ledger). Imported by both apps.
- `apps/server`: Cloudflare Worker + Durable Object `TableRoom` (binding `TABLE`), one per table.
- `apps/web`: Next.js App Router + Tailwind frontend, deployed on Vercel.

## Commands

- `pnpm install`: install everything (run at the root)
- `pnpm test`: all tests
- `pnpm typecheck`: all TypeScript checks
- `pnpm --filter @garagepoker/engine test`: engine tests only
- `cd apps/server && npx wrangler dev`: run the server locally
- `cd apps/web && pnpm dev`: run the site at http://localhost:3000

## Hard rules

- `packages/engine` has no I/O: no `fetch`, `Date.now`, `Math.random` or `console` in logic. Randomness and time are passed in as arguments.
- The engine is a reducer: `(state, action) => newState`. State is plain JSON-serializable data.
- The server is authoritative. Clients send actions and render the views they receive; they never compute game state.
- Never send a card to a client that the client isn't allowed to see. Build each seat's view on the server.
- All chip amounts are integer cents. No floats, anywhere.
- Shuffle with `crypto.getRandomValues` and unbiased Fisher-Yates. No burn cards.
- Durable Objects use SQLite storage and the WebSocket Hibernation API (`ctx.acceptWebSocket`), not `ws.accept()`.
- Validate every client message with Zod on the server before it reaches the engine.

## Working style

- Work on one build phase (SPEC.md §10) at a time. Don't start the next phase until the current phase's exit test passes.
- Every engine change comes with Vitest tests. Use fast-check property tests for invariants: chips conserved, no card dealt twice, sum of ledger nets = 0.
- Run `pnpm test` and `pnpm typecheck` before saying a task is done. If they fail, fix them; don't skip or weaken tests.
- Keep changes small, and commit after each passing step with a clear message.
- Don't add dependencies without saying why.
- Don't run `wrangler deploy` or push to git unless asked.
- Server changes only reach production after `npx wrangler deploy` in apps/server; remind me whenever apps/server or packages/protocol/engine changes.

## Environment

- Developer is on Windows (PowerShell). Give Windows-compatible commands.