# Deploying Forwarded University (Cloudflare, free plan)

**Status:** deployed on Cloudflare (free plan) from a private repo. This public copy has no content bank and a placeholder D1 id; `wrangler deploy` needs your own `database_id` (step 3).

Everything below needs **your** Cloudflare login. I can verify the build (`npm run deploy:check`) but cannot deploy for you.

## One-time setup
1. `npx wrangler login`
2. Create the content database and copy the printed `database_id`:
   ```bash
   npx wrangler d1 create forwarded-university
   ```
3. Paste that id into `wrangler.jsonc` (`d1_databases[0].database_id`; today it is a local-only placeholder).
4. Create the tables:
   ```bash
   npm run db:migrate:remote
   ```
5. Import **approved, verified** content (see `docs/06-content-system.md`). The remote import refuses fewer than 12 questions, 2 personalities or 300 names, and stops on any invalid item:
   ```bash
   npm run import:remote
   ```
   Until this is done Start answers "question bank not loaded" (by design).

## Every deploy
```bash
npm run deploy:check    # type check, engine tests + bots, build, wrangler dry-run: nothing is published
npm run deploy          # build + wrangler deploy
```
The site is then live at `https://forwarded-university.<your-account>.workers.dev`.

## After deploying (5-minute check)
- `curl -I https://<your-url>/` shows `content-security-policy`, `x-frame-options: DENY`, `x-content-type-options: nosniff`.
- Open the URL on a phone, create a room, join from a second phone or laptop, play a few rounds. Try: lock screen / switch to the call app and back (should show "RECONNECTING" then return to your seat), type a fake with the keyboard open, mute button.
- `BASE=https://<your-url> node scripts/ws-smoke.mjs` (the Start step needs content imported).
- Confirm the vars are `"0"`: `DEV_CONTENT` and `ALLOW_TEST_CONTENT` (a test in `npm test` fails the build if they are not).

## Rollback
`npx wrangler rollback` returns to the previous Worker version. Room state lives in Durable Objects and content in D1, so a rollback does not lose either. A deploy that changes the saved-state shape needs a migration of old room snapshots: not needed yet, but remember it before changing `State` in `src/engine/types.ts` (rooms are deleted 30 minutes after they empty, so a short maintenance window also works).

## Free-plan watch list (Cloudflare limits as of the docs read in Stage 3; re-check before launch)
| Limit (per day, resets 00:00 UTC = 5:30 AM IST) | What counts | Our design |
|---|---|---|
| 100,000 requests | each WebSocket connection, each incoming message at 20:1, page API calls (static assets are free) | measured below |
| 13,000 GB-s duration | time a room is awake, billed at 128 MB | hibernation + auto-answered heartbeats; rooms sleep between messages |
| 100,000 SQLite rows written | one snapshot row per phase change/lock-in, one per alarm set, deletes | no per-tick writes |
| D1 5M rows read, 100k written | content load (cached 60 s per isolate) and crowd/report writes | tiny |
If a limit is hit, that kind of operation fails until the reset. The paid plan (about $5/month) lifts all of this.

Measured with the socket bots (`node scripts/ws-game.mjs 6 1 0.01`): see the "incoming messages" figure in its last line; `docs/DECISIONS.md` (Stage 9) records the numbers.

## Still open (not code)
- Check `forwardeduniversity` .com / .in, social handles, IP India and USPTO searches (master doc open item).
- Run the Gemini style analysis and review the Style Bible; write and verify the real content (250 questions, 80 personalities, 300+ names, curses).
- Review the moderation word list (`src/engine/moderation.ts`), especially Hinglish terms.
- Ask a lawyer about personality rights in India before any likeness is used (today: neutral silhouette only).
- Real-phone testing on iOS Safari and Android Chrome (keyboard behaviour, reconnect after switching apps, wake lock).
