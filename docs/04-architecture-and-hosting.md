# 04 — Architecture and hosting

## One platform: Cloudflare (free plan)
- **One Worker** serves the static frontend (static asset requests are free and unlimited) and routes WebSocket upgrades.
- **One Durable Object class `Room`** (SQLite-backed), one instance per 4-letter room code. WebSocket Hibernation API so idle rooms cost nothing. DO alarms drive deadlines. State saved to SQLite at phase changes only.
- **One D1 database** for the content bank (questions, personalities, crowd fakes pending/approved/rejected, reports).
- **GitHub** holds master content files; a deploy script imports them into D1.
- Each room's used-question list lives in that room's storage (cleared 30 min after empty).

## Free-plan limits to design for (from Cloudflare docs; check again before launch)
- 100,000 requests/day (incoming WebSocket messages count 20:1; outgoing are free)
- 13,000 GB-s/day duration (128 MB billed) — avoids burn by hibernating
- 100,000 SQLite rows written/day (each alarm and delete counts), 5M rows read/day, 5 GB storage
- Resets at 00:00 UTC (5:30 AM IST)
- Rough estimate: ~35 full games/day (our estimate, not Cloudflare's). If we outgrow it, the paid plan starts around $5/month.
- Rules: no per-second writes; heartbeats use auto-response; batch messages; keep payloads small.

## Fallbacks (only if Cloudflare fails)
Render free web service (sleeps after 15 min idle, ~1 min wake, ephemeral disk). Not preferred.

## Code layout
```
src/engine/      pure game logic + tests (no Cloudflare imports)
src/worker/      Worker entry, Room Durable Object (sockets, alarms, save)
src/client/      frontend (vanilla TS or small framework), design system
content/         schemas, samples, prompts, verified data
scripts/         import-content, layout screenshot tests, test bots
```

## Build order
1. Design system + key screens (static)
2. Pure engine + unit tests + test bots
3. Room DO: lobby, join, rejoin, spectators, grey-out
4. Round 1 end to end
5. Interlude + snitch
6. Round 2
7. Round 3 + podium + Play Again
8. Content import into D1 + no-repeat selection
9. Moderation, reports, crowd fakes
10. Layout tests across sizes, sound, polish, deploy

After each stage: runnable demo, stop, report.
