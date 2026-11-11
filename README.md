# Forwarded University

A free-to-host party game for 3–8 friends, played on phones while everyone talks on a voice call.
Three rounds of fake-headline bluffing, a mystery-box interlude, and a pun-hint guessing finale.
Solo play, English with Indian references.

**Live demo:** https://forwarded-university.funplays.workers.dev

> This is the public code-only copy. The question bank, harvest pipeline data and prompts are private.
> A synthetic TEST pack lets the whole game run locally.

## What makes it interesting (engineering)

- **Pure game engine** (`src/engine/`): every rule is `(state, event) -> { state, effects }`. No clock, no network, randomness only via an injected seeded RNG. Fully unit-tested, including disconnects, ties and "3 players, 1 leaves".
- **Thin Cloudflare layer** (`src/worker/`): one Worker, one SQLite-backed Durable Object per room, one D1 database for content. WebSocket Hibernation, alarms for deadlines, saves only at phase changes to stay inside the free plan.
- **Server is the boss:** clients send intents only. Secrets (real answers, who picked what, hints) are sent at reveal time, and a chaos script scans every message for leaks.
- **Every phase has three exits:** everyone done, deadline, or nobody eligible, recomputed on disconnect, reconnect and lock.
- **Chaos test bots** (`scripts/ws-*.mjs`, `tests-engine/bots.test.ts`) join, leave and rejoin at random moments.
- **Fixed-stage layout:** 1920×1080 and 1080×1920 stages scaled to fit, with Playwright tests that fail if any element leaves its container.
- **Moderation:** slur filter on typed fakes, report buttons, crowd-fake review queue.

Design notes and trade-offs: [`docs/`](docs/), especially `docs/DECISIONS.md`.

## Run it

```bash
npm ci
npm test                # engine tests, bots, content + contrast checks
npm run dev             # static client screens (Vite)
npm run dev:full        # client + Worker + Durable Object with synthetic TEST content
npx playwright install chromium && npm run test:layout
```

Deploying to your own Cloudflare account: see [`docs/DEPLOY.md`](docs/DEPLOY.md) (you need your own D1 `database_id` in `wrangler.jsonc`).

## Stack

TypeScript, Vite, Cloudflare Workers + Durable Objects (SQLite) + D1, Vitest, Playwright. No other services.

## License

All rights reserved for now. Code is public to read.
