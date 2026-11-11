# Decisions log (non-locked calls made while building)

Locked decisions live in `CLAUDE.md`. Anything below is a sensible default; change freely, tell the product owner.

## Stage 1 (design system + key screens)
- **Stack for the client:** Vite + TypeScript, vanilla (no framework). Screens are string templates rendered from fixtures, so Stage 1 has zero game logic. Fonts are bundled via `@fontsource` (Anton for display, Barlow Condensed for body), so no external font requests.
- **Body font is condensed** so 60-character options fit in two lines at the 44-unit minimum text size.
- **Header/ticker sizes:** landscape header 104 + ticker 70; portrait header 150 + ticker 100. All six key screens are laid out in fixed pixel boxes inside the 1920x1080 / 1080x1920 stages.
- **Line-clamp as a safety net:** option and hint text is clamped (2 or 3 lines) so a pathological string can never grow a box. Real protection is the input/server length limits.
- **Layout test** (`tests/layout.spec.ts`, `npm run test:layout`) screenshots 6 screens x 9 sizes into `test-results/` and fails on: element outside its parent or the stage, clipped text, font under 44 stage units, page scroll. Decorative marquee/confetti (`data-deco`) and SVG are exempt.
- **Fixtures are fake and labelled `EXAMPLE FIXTURE`.** They exist only in `src/client/fixtures.ts` for design work and must never be shown to players.
- **Dev screen switcher** (bottom-left links) is for design review only; hide with `?dev=0`. Force orientation with `?o=land` or `?o=port`.
- **R3 illustration** is a neutral silhouette placeholder (no real likeness).

## Stage 2 (pure engine, tests, bots)
Files: `src/engine/{types,rng,text,select,engine,view}.ts`. Tests: `tests-engine/` (`npm test`). The engine has no Cloudflare imports, no clock (time arrives on every event as `at`) and no `Math.random` (seeded rng lives in state).

### Where the docs disagree (the master doc wins, per README) — TELL THE OWNER
| Topic | `docs/` says | Master doc says | Built |
|---|---|---|---|
| R1 bomb | +15 per victim | +10 per victim, cap +40/question | master |
| Timers | interlude pick 20 s, result 8 s, R2 reveal ~8 s, turn end 4 s, podium 15 s | 60 s, 5 s, 5 s, 3 s, 10 s | master (all in `TIMERS`) |
| Interlude skip | fewer than 3 connected | fewer than 2 connected | master |
| Interlude tie-break | fewer R3 wager points, then join order | fewer R1 correct, then seeded random | master (R3 hasn't happened yet at that point) |
| R3 first solver | not mentioned | +10 | master |
| Nobody connected | hold state; delete 30 min after empty | freeze phase, fresh full timer on return, delete after 30 min | master |
| Hot seat drops mid-turn | skipped after 10 s grace | can return until the timer ends | 10 s grace (docs/02): a stuck game is worse than a skipped turn |

### Engine calls I made (change freely)
- **Start:** owner presses Start with 3+ connected players; Ready taps are shown but not required.
- **Not built yet (UI/Durable Object concern):** the 2-second "Advancing…" cancel window, the 3-minute lobby-idle-to-spectator rule, and the 5-second pre-start countdown.
- **Garbage tile:** the Hot Seat is the only one who picks tiles, so Garbage goes to them: +20, then they pick a real tile (fresh timer). Auto-pick never takes Garbage.
- **Curse length:** counted in R2 turns (the first 2 turns, skipped turns included); bounty paid when the 2nd turn ends if the cursed player is still connected and was not caught. Snitch window closes at any phase change with no reward and no cooldown.
- **Writers see the real answer** (they need it to bluff); the Hot Seat and spectators never do. Fakes are checked against the answer and its aliases (case, punctuation, "1,000" = "1000", fuzzy match >= 85%).
- **Preset lies are house lies:** they count as "submitted" but score nobody.
- **Wagers:** percent of score at wager time, floor-rounded; score 0 means free-roll 20. Greyed at resolution = voided.
- **Disconnected lobby players** keep their seat (greyed) so rejoin works; after a game they are kept 5 minutes.
- **Saves:** the engine asks the host to save only on phase changes and lock-ins; it asks for an alarm only when the next deadline changes.
- **Moderation list** in `text.ts` is a short starter list; the real English + Hinglish filter comes in the moderation stage.
- Test content is synthetic (`tests-engine/helpers.ts`, labelled TEST) and never touches `content/`.

## Stage 3 (Worker + Room Durable Object + live lobby)
Docs read first (per CLAUDE.md): Cloudflare DO llms.txt, WebSockets best practices, Alarms, SQLite storage, `state` (blockConcurrencyWhile), migrations/exports, pricing (DO works on Workers Free, SQLite only), Workers static assets.
- **Config:** `wrangler.jsonc` uses the newer `exports` block (`"storage": "sqlite"`) instead of legacy `migrations`. `assets.run_worker_first` is only `["/api/*", "/ws/*"]`, so the website itself is served as free static assets.
- **Room code:** created by `POST /api/rooms` (4 letters, no I/O/L, blocked-word list, retried until the Durable Object reports it is unused). A code whose room was wiped looks like "no room with that code" (we keep no tombstone, to avoid writing more rows).
- **Saving:** one SQLite row (`snap.state`), rewritten only when the engine emits `save` (phase changes + lock-ins). Alarm set only when the deadline changes. 
- **Hibernation:** `acceptWebSocket`, `setWebSocketAutoResponse("ping" -> "pong")` so heartbeats never wake the room. The socket's player name lives in the socket attachment, so nothing in memory is needed after a wake.
- **Disconnect detection:** clean close/error events, plus a stale sweep (no ping for 30 s) that runs whenever the room wakes. A silent phone in an otherwise idle room is greyed at the next message or deadline alarm. The master doc's "about 8 seconds" is not achievable with hibernation, because the room is asleep between messages; say if you want it tighter at the cost of more duration billing.
- **Restart reconciliation:** on wake, anyone saved as connected but without a live socket gets a normal disconnect. Verified by restarting `wrangler dev` mid-game: the browser tab reconnected on its own, the phase and deadline were restored from SQLite, and the two dead bot sockets showed as away.
- **Join errors:** the server answers `{type:"error"}` and the client closes the socket (a server close sent during the upgrade request is not delivered reliably). Such a socket has no name, is never a player and never receives state.
- **Limits:** messages over 2 KB are dropped; 25 messages/second per socket.
- **Real content:** the Worker's content pack is empty until Stage 6 (D1), so Start answers `content_not_ready` in production. Local dev only: `npm run dev:worker` passes `DEV_CONTENT=1` and loads the synthetic TEST pack from `src/engine/devContent.ts`.
- **Client:** `/` is the real app (home -> lobby -> phase placeholder). Refresh or reconnect puts you back in your seat (name + room code remembered in localStorage; device token for the same-device takeover). Design gallery stays at `/#lobby`, `/#r1-question`, etc.
- **Not built yet:** screens for rules card and the rounds (Stage 4+), sound, leave button.

## Stage 4 (Round 1 end to end)
- **Screens:** rules card (shared by all three rounds; text for R2 and R3 already written), question, reveal, lore card. All drawn from the server view only. The static key-screen fixtures now call the same live render functions, so the layout test covers the real screens (rules + lore added, 90 checks across 10 screens x 9 sizes).
- **Reveal steps are timed by the server deadline:** 0 s plain options, 1 s ✅ avatars land, 3 s 💣 drop, 5 s truth green / fakes red + verdict. Someone who joins or reconnects more than 1.5 s into a reveal sees the finished result, not a replay. `prefers-reduced-motion` shows the finished result too.
- **Taps are optimistic**: the screen updates at once, the server re-checks and its next broadcast wins. A tap on a ✅ option that holds your 💣 moves the 💣 off (the server would reject both on one option).
- **New text limit:** lore comparison text 72 characters, math 40 (schema, docs/05, engine `LIMITS`, layout fixtures). Needed so the fixed lore card can never overflow.
- **Lore link:** shown as the bare domain, `target=_blank rel=noopener`, http(s) only. "Report error" is a button that says reports arrive later (Stage 7).
- **Reveal banner** shows the top 3 scorers of that question; bomb scoring text is +10 per victim (master doc), the old static mock said +15.
- **Bots over real sockets:** `node scripts/ws-bots.mjs [players] [seed] [existingRoomCode]` plays rules card + 4 questions + reveals + lore through the real Durable Object with random drops/rejoins, and one bot leaving for good. Passed with 3, 4, 6 and 8 players. (Takes about 40 s because the real timers run.)

## Stage 5 (Interlude + snitch)
- **Screens:** Mystery Boxes pick (Underdog taps a box; the Dealer's phone shows what is inside each box; everyone else sees three `?` boxes) and the 5 s result (only the opened box is revealed). A shared **curse strip** shows the cursed player their curse text and shows everyone else a **BUSTED!** button with live vote count (`BUSTED 1/2`), a cooldown state, and no button for spectators. The strip is already on the placeholder phase screen and will be reused by the Round 2 screens.
- **What each phone is told** (`view.curse`): active, mine, text (cursed player only), window {votes, need, voted}, cooldownUntil (you only), canSnitch. Curse text never appears in anyone else's view (tested in engine tests and over real sockets).
- **New text limit:** curse text 70 characters (engine cuts after the `{target}` name is filled in). The curse list itself arrives with the content stage; dev content has one test curse.
- **Box C wording** follows the room toggle: curses off shows "SPONSOR TIP, +10 points" and no curse.
- **Tests added:** `tests-engine/snitch-view.test.ts` (6) and `scripts/ws-interlude.mjs`, a 19-check scenario over real WebSockets: Dealer/Underdog selection, Dealer-only box view, Curse Box pick, curse text privacy, +1, cursed player takes first Hot Seat, two BUSTED! taps end the curse and pay the first tapper +15.
- **Still manual:** the BUSTED! button and box taps have been verified by layout screenshots and the socket scenario, not by hand on a phone.

## Stage 6 (Round 2: Pick Me Behaviour)
- **Screens (all live):** tile pick, write-a-fake (typing screen), guess grid (9 slots max), reveal, comedy vote, turn end. A compact **curse slot** (cursed player's reminder, or everyone else's BUSTED! button) sits on every one of them. The turn counter (`Turn 3/8`) comes from the server view.
- **Guess uses tap + LOCK IN** (not tap-to-commit) so a mis-tap is not final; the server still treats the pick as final once received. Comedy vote is a single tap (final); your own fake is faded, with a pink letter chip.
- **Typing screen / phone keyboard:** the write screen keeps the prompt, text box, SUBMIT/PRESET and error line inside the top ~1000 stage units. While the box is focused and the visible area shrinks, the stage is fitted to the WIDTH and pinned to the top (visualViewport), and the stage orientation is frozen so the shrunken window can never flip it to landscape. Other players' state changes patch only the "3/6 READY" counter while you type, so the keyboard never drops. Tested at four phone sizes with the visible area cut to 480-580 px (`tests/keyboard.spec.ts`).
- **Stage root is now `position: fixed; overflow: hidden`**: the document can never scroll, even when the taller-than-visible stage is pinned to the top.
- **Landscape budget changed:** Round 2 head is 220 high and grid rows are 160 (was 190 / 168) so a 140-character prompt fits on two lines; portrait prompt text is 44 units (4 lines max). Tile titles use the 44-unit minimum (3 lines max). Reveal cells in landscape put the option letter in the "by" line instead of a chip.
- **Rejected fakes** show a plain message (too close to the truth / empty / not allowed). After 2 rejections the server offers PRESET LIE and the button is highlighted.
- **Old static R2 mock removed**; the key-screen gallery now shows the live R2 screens (pick, write, guess, reveal, vote).
- **Tests:** 7 new view tests (what writers, hot seat, spectators and voters may see); 4 keyboard tests; layout is now 16 screens x 9 sizes = 144 checks + 4 keyboard. `scripts/ws-game.mjs` plays a whole game (rules, R1, interlude, R2, R3, podium) through the real Durable Object with random drops: passed with 4 players (1% drop) and 6 players (4% drop, 61 drops).
- **Real-browser check:** an autopilot in the browser pane played Round 1, the Interlude and Round 2 turns (tile, write, guess, reveal, vote, turn end) against three socket bots. Not checked by hand on a real phone.
- **Known behaviour, not a bug:** with many drops a hot seat who is disconnected when their turn arrives is skipped (spec row 9), so a very chaotic run can see few `write` phases.
- **Round 3 screens are still the placeholder card** (next stage).

## Stage 7 (Round 3: Who Am I?, podium, Play Again)
- **Wager screen:** native range slider in 5% steps (fixed 88 px thumb, no layout change), live preview of "45% = 83 PTS" and the four outcomes (hint 1-2 x1.5, 3-4 x1.0, 5 x0.5, unsolved) recomputed on every drag with no re-render; the server hears the value when you let go (`change`) and again on LOCK WAGER. A zero-score player sees "FREE ROLL, wager 20, you cannot lose" with the slider disabled.
- **Hint screen:** silhouette placeholder (never a photo), hints shown one by one, `WAGER / GUESSES LEFT / NOW x1.5` pills, LOCK IN, PASS / UNPASS. Right or wrong comes back privately as a toast and a status line ("WRONG: name").
- **Searchable names:** `GET /api/names` (cached 5 min) returns the full list (answers + decoys); the client fetches it once, filters locally (prefix of any word first, then contains) and shows at most 5 suggestions in a fixed panel, so nothing scrolls. LOCK IN is enabled only for a name that is exactly in the list (typing the full name also counts); the server re-checks the list. Dev content has 312 names; **production must ship 300+ names including decoys** (spec).
- **Keyboard:** the guess box is a "typing" input like the Round 2 fake box (same top-pinned width-fit); portrait layout keeps the search box, suggestions, LOCK IN and PASS above y = 1280 so a phone keyboard cannot hide them (tested at four phone sizes). My first layout missed the header offset; the new keyboard test caught it.
- **Reveal:** the answer, "first to solve +10", and one row per player: wager, result (`HINT 2 +31`, `UNSOLVED -42`, `FREE`, `AWAY - VOIDED`) and all their wrong guesses. A player who sat out the wager phase has no row.
- **Podium:** built from the server's ranks (ties share a number, two champions both show 1, greyed players are greyed); confetti; "IT'S A TIE AT THE TOP!". **Play Again screen:** full leaderboard, PLAY AGAIN / LEAVE, "2/6 ANSWERED" counter. Leave tells the server, stops the connection, forgets the room code and returns to Home.
- **Tests:** layout is now 20 screens x 9 sizes + 8 keyboard checks (179 total).
- **Verified in a real browser** (autopilot driving the pane against socket bots): wager slider -> hints -> a private "WRONG. 2 LEFT" result -> reveal -> second personality -> podium -> Play Again -> same room's lobby, my seat kept, scores reset. This also found a real bug: tapping a suggestion did not fill the input because the page skipped the redraw while the input had focus (iOS keeps focus on the input when a button is tapped). Fixed by blurring first.
- `window.__fu` exposes the client state for in-browser checks (read-only use; no secrets beyond what the player's own view already holds).
- **Not checked:** a real phone, sound (not built), and the full game with 8 players in a browser.

## Stage 8 (real content in D1, no-repeat, moderation)
**There is still no real question bank, and nothing invented was added.** This stage builds the whole pipeline and proves it on a LOCAL database with the synthetic TEST pack. Production starts empty, so Start answers "content not ready" until you import approved content.

- **D1 schema** (`migrations/0001_init.sql`): `questions`, `personalities` (whole JSON + status), `names` (the searchable list), `curses`, `crowd_fakes` (pending/approved/rejected/reported, text only), `reports`, `option_blocks`. Only the game writes the last three.
- **Config:** `wrangler.jsonc` has a `DB` binding with a LOCAL-ONLY placeholder id. **Before deploying:** `npx wrangler d1 create forwarded-university`, paste the printed id into `wrangler.jsonc`, then `npm run db:migrate:remote` and `npm run import:remote`.
- **Loader** (`src/worker/content.ts`): one batched read, cached 60 s per isolate; only `approved` rows; every row re-validated at load and **skipped + logged if bad** (never a crash); a failed read keeps the last good pack. Rows containing EXAMPLE/TEST markers are refused unless `ALLOW_TEST_CONTENT=1` (local only; production var is `0`).
- **Validation** (`src/engine/validate.ts`, also used by the importer): every length limit, 4+ approved wrong options, no duplicate / answer-equal / abusive option, 3+ house lies, 2-3 lore comparisons, source link must be http(s), 2+ sources confirmed, sensitivity cleared, personalities need exactly 5 hints, a hint may not contain the name or a 5+-letter surname, illustration brief required, curse <= 70 chars with {target} filled and clean. The EXAMPLE sample is tested to be un-importable.
- **Importer** (`scripts/import-content.mjs`): reads `content/questions/`, `content/personalities/`, `content/curses.json`, `content/names-decoys.txt`; imports only `approved`; **any problem stops the whole import**; remote import also needs 300+ names and 12+ questions / 2+ personalities. It never resurrects a question pulled by a player report (status is untouched on update) and retires approved rows no longer in the files. `--dev` loads synthetic content to the local DB only and refuses `--remote`.
- **Names list:** answers + aliases + decoys, de-duplicated, served by `/api/names`; aliases are always added so "typing an alias" works.
- **No-repeat** (engine, now tested at launch scale with 250 questions / 80 personalities): 12 questions per game never repeat; the room remembers across games and gives about 19 clean games before anything repeats (list resets under 15 unused); every R1 mixes India/world with no shared topic tag; the personalities list resets when exhausted; a tiny pool never crashes a game.
- **Crowd fakes:** the top 2 fakes of a Round 2 turn go to the DO, which saves them to D1 as `pending` only if they pass the SHARED-POOL filter (`src/engine/moderation.ts`: abuse + religion, caste, communities, tragedies, minors, sexual content, personal data) **and** do not mention a player in the room or the room code. Duplicates across groups just bump `seen`. Everything else stays private to that room. Approved crowd fakes join the question's options, at most 10 per question and 12 options in all.
- **Reports** (`{t:"report"}` is its own message, not an engine intent): tap a row on the Round 1 or Round 2 reveal, press REPORT; the lore card's REPORT ERROR reports the facts. The server decides *what* was reported from its own state (the phone only says "option 3" or "error"), allows **one per seated player per phase**, saves it, and pulls the item at once: a reported option goes to `option_blocks` (and its crowd row to `reported`), a reported fact pulls the whole question. The cache is cleared in that isolate immediately and within 60 s everywhere. **Griefing risk:** a single player can pull one question; the cap is one report per player per phase and a human restores it (see below). Say so if you want a threshold of N players instead.
- **Review tooling** (`scripts/review.mjs`): `list`, `approve-crowd` (refuses past 10 per question), `reject-crowd`, `restore-question`, `retire-question`, `unblock`, `close-reports`. Nothing is ever approved automatically.
- **Tests:** 53 new engine tests (moderation, validation, pack builder, no-repeat at scale); layout is now 22 screens (reveal screens also tested with a row selected); `scripts/ws-moderation.mjs` is a 15-check end-to-end run on a real local D1 (reports, pulled items, one-per-phase, spectator ignored, crowd fakes pending and text-only, sensitive and name-bearing fakes NOT saved); the same report path was exercised from a real browser.
- **The shared-pool word list is a conservative starting list**, English + a few Hinglish terms, matched as whole words. It needs your review and a proper Hinglish pass before launch; over-blocking only keeps a fake private to its room, so it errs that way on purpose.
- **Local setup:** `npm run db:migrate:local`, `npm run import:dev`, `npm run dev:d1` (D1-backed, no DEV_CONTENT). `npm run dev:full` still uses the in-memory TEST pack.

## Stage 9 (sound, polish, hardening, deploy prep)
- **Sound** (`src/client/sound.ts`): 13 effects synthesized with the Web Audio API (no audio files to license or download): click, lock, pop, bomb, boom, correct, wrong, tick, siren, reveal, whoosh, coin, fanfare. The audio context starts on the first tap (browser autoplay rule). Where they play: reveal steps follow the server clock (✅ pop, 💣 whistle + boom, then correct/wrong depending on whether *you* backed the truth), last-5-seconds ticks, phase changes (whoosh), Round 2 and Interlude reveals, Round 3 result for you, podium fanfare, BUSTED! siren when a snitch window opens, a coin when your score goes up, private right/wrong on a Round 3 guess. Nothing plays on the first state after (re)joining, so a reconnect never replays old sounds.
- **Mute button** (header speaker) now works, shows 🔊/🔇, has `aria-pressed`, and the choice is remembered. Verified in the browser pane; actual audio output was **not** listened to by me (no speakers in this environment), so please judge the sounds by ear and tell me what to change.
- **Accessibility:** a test checks 34 real text/background colour pairs for >= 4.5:1 (docs/05) and that the CSS no longer contains the old low-contrast greys (placeholder, disabled buttons, locked hints and greyed seats were fixed); toasts are `role=status aria-live=polite`; reveal/loading overlays already had `role=status`; `prefers-reduced-motion` shows reveals in their final state.
- **Locked-decision guard:** a test fails the build if a messaging-app brand name appears in any client/engine/worker source, the manifest, `index.html` or config. It caught one leftover fixture tile , now fixed.
- **Security headers** (`public/_headers`, applied to the static site): CSP with `script-src 'self'` only (no inline scripts, no eval), `frame-ancestors 'none'`, `nosniff`, `no-referrer`, a locked-down `Permissions-Policy`; hashed assets cached for a year. Verified live in the dev Worker with no violations or console errors through lobby, start, Round 1 question and the animated reveal. `style-src` keeps `'unsafe-inline'` because screens use inline style attributes (positions of confetti, etc.).
- **Abuse guard:** `POST /api/rooms` is limited to 8 per client per minute per Worker isolate (best effort; each room is a Durable Object).
- **PWA basics:** SVG icon, `manifest.webmanifest` (installable "Add to Home Screen"), description + share tags, `robots.txt` (disallows `/api/` and `/ws/`).
- **Deploy prep:** `npm run deploy:check` (type check, all 205 engine/bot/content/config tests, build, `wrangler deploy --dry-run`) passes: 26 static files, 70 KB (20 KB gzipped), bindings ROOM + DB + ASSETS found. `.github/workflows/ci.yml` runs the same plus the layout and phone-keyboard tests on every push. `docs/DEPLOY.md` is the step-by-step checklist (D1 create, paste id, migrate, import, deploy, after-deploy checks, rollback, free-plan watch list, open non-code items). A config test pins the shipped config: dev flags `"0"`, exactly one SQLite Durable Object class + one D1 database (locked decision 8), compatibility date >= 2026-02-24, only `/api/*` and `/ws/*` run the Worker.
- **Free-plan measurement** (6 bots, a whole game, 1% drops): **225 incoming messages** per game plus 16 rejoin connections; the 162 heartbeats were answered by the runtime without waking the room. At the documented 20:1 rate that is roughly 11 request-equivalents + about 22 connections + a handful of API calls per game, so the 100,000 requests/day limit is far away (thousands of games). **The limit that actually matters is duration (13,000 GB-s/day)**, which depends on how long rooms stay awake in real play; I cannot measure that locally. Hibernation should keep it well under the spec's no-hibernation estimate of about 35 full games/day, but it must be measured on the live deployment (watch the Cloudflare dashboard during the first real sessions).
- **Not done, on purpose:** the 2-second "Advancing..." cancel window, the 3-minute lobby-idle rule and the pre-start countdown (the engine does not have them; say if you want them), actual Cloudflare deploy (needs your login), the name/domain/trademark checks, real-phone testing.

## Source rule relaxed (2026-11-08, the product owner)
- One reputable, linked source is enough (was: two). The source is always shown to players on the lore card (VERIFY and 2ND buttons) so players can check it themselves. Reputable means a national or major regional outlet (TOI, HT, Indian Express, India Today, NDTV, The Hindu, ThePrint, PTI/ANI syndication and similar). Blogs, aggregators and viral-video sites alone do not count.
- `validateQuestion` now needs `sources_confirmed >= 1`; schema and the content test were updated to match.
- Sensitivity rules are unchanged: serious news (child abuse, sexual, murder, death-by-negligence) stays out.

## Story sensitivity relaxed (2026-11-08, the product owner)
Only death, sexual content and abuse are blocked in news stories. Religion, politics, minors, communities, celebrities and anonymised private people are allowed. Complaints go through the in-game Report button (instant pull). Slur filter on typed fakes is unchanged. Claude still avoids stories whose punchline mocks a group, and still links one reputable source on every lore card. Previously dropped stories (idol thefts, Patna fake IPS, BNP passport, Gulf housemaid, minors) are re-eligible. Fictional cases (e.g. the TV show Maamla Legal Hai) are never used as news.

## Play-test with real content, 3-8 players (2026-11-09)
- Full games on the real 250-question / 80-personality bank, over real WebSockets: 3, 4, 5, 6, 7 and 8 players, with random drop-outs and rejoins (14 to 82 per game), all reached the podium. Two games survived the dev server being killed and restarted mid-game.
- `scripts/ws-chaos.mjs` (new): lobby abuse (bad/long/HTML names, name clashes, 9th player, garbage frames, 300-message spam) and a full game where an attacker sends invalid, stale and hostile intents in every phase while every state message is scanned for secrets (answers, locked hints). 14/14 at 3 and 8 players.
- `scripts/record-bot.mjs` (new): films one real browser player through a whole game (Playwright video).
- Findings: no game bug. Early failures were test-script flaws (bots guessing names not in the dropdown list, clients without the 5 s heartbeat being dropped as stale, bots not reconnecting). Scripts fixed.
- Round 3 takes up to about 7.5 minutes when nobody acts early (5 hints x 45 s x 2 personalities); a whole game is 9 to 15 minutes in real time.
- Content balance still to improve: 232/250 questions are from the last 5 years (plan: 50/30/20), curses list is empty.

## Content rewrite: funnier hints and fakes (2026-11-09)
the product owner play-tested the first content and found it bland: R3 hints were direct facts, R1/R2 fakes were generic ("Free chai").
- Wrote `content/prompts/joke-craft.md` (the style rules we follow from now on).
- Rewrote all 400 R3 hints (80 personalities) with a hook each (pun, double meaning, Hinglish punchline, misleading start), still hardest to easiest, no name leaks (validator passes).
- Rewrote the wrong options (now 6 per question, was 5) and 3 house lies for all 250 questions: same length and grammar as the truth, so the fake cannot be spotted by shape.
- Known gap: the later questions (about q0100 onward) are less inventive than the early ones; a second polish pass would help. Humour needs a human skim.
- Second pass (same day): hints were still giving the answer away in hints 1-2 ("Hera Pheri", "Mars", "bowlers"). New rule in `joke-craft.md`: hints 1-2 contain no signature word or field and read as wordplay that fits many people; the field is guessable at hint 3; the real giveaway comes only at hint 5.

### R3 hints: misdirection rule (2026-11-09)
the product owner asked for all 400 hints to be rewritten with no signature words and clues that point to a different field. All 80 personalities redone as true facts in the wrong profession's language; rule recorded in content/prompts/joke-craft.md. Known gap: a few hint 5 lines still name a field; a human skim is advised.

## 2026-11-09: Report on every question, rulebook, bank +44
- **Report button** (flag in the header on every screen that shows a question/hints: R1 question/reveal/lore, R2 write/guess/reveal/vote, R3 hints/reveal; seated players only). The form asks WHAT'S WRONG (offensive / wrong fact / other), WHICH PART (the question, or option A..I, or a revealed hint), and an optional note (140 chars). The lore card's REPORT ERROR opens the same form pre-set to "wrong fact". Old tap-a-row-then-REPORT flow is gone.
- **Server** (`src/engine/report.ts` decides what is reportable per phase; `Room.report` saves): up to 3 reports per player per screen, never the same thing twice. "Offensive" and "wrong fact" pull the item at once (an option is blocked; the question, its true answer, or any Round 3 hint pulls the whole question/personality). "Other" is only logged for a human. Needs `migrations/0002_report_reason.sql` (`npm run db:migrate:remote` before deploying); without it reports still save, minus reason and note. `scripts/review.mjs list` shows reason and note.
- **Rulebook**: HOW TO PLAY button on the home page and a book icon in every header, opening a 6-tab pop-up (Basics, Round 1, Interlude, Round 2, Round 3, Report). Numbers come from `K` in the engine; keep them in sync. Esc or the X closes it; the game keeps running behind it.
- **Content**: `harvest-batch-03.json` adds 44 questions (q0251-q0294), bank now 294. Sources were read in full (Indian Express via the browser pane, since WebFetch blocks that host; Dawn; Kathmandu Post). Only facts in the article are used. 3,900+ other harvest headlines remain unread: most are viral clips or listicles with no question in them.
- **Still unbalanced**: 41 of the 44 are from the last 5 years. Older evergreen stories (2000-2020, older) are the next thing to find.

## 2026-11-09 (later): second pass over the harvest, bank now 344
- **What was covered.** All 3,909 unused harvest headlines were looked at: the ~3,400 that were not obvious listicles or blocked topics (death, sex, abuse) had every title read, except about 1,960 lowercase slug-only viral headlines (no event in the title), which were only scanned by keyword. About 100 were shortlisted and 79 Indian Express articles were opened and read through the browser pane (the 5 Hindustan Times / Times of India picks were not opened).
- **Result.** `harvest-batch-04.json` adds 50 questions (q0295-q0344); bank is 344 (240 India, 104 world). All 50 sources are the Indian Express. Every fact comes from the article text only.
- **Left out on purpose.** Stories with injuries, deaths, sexual content, or people shamed on camera; viral clips with no concrete fact to ask about; recent politics with no funny angle.
- **Still lopsided.** 324 of 344 are last-5-years, 18 are 2000-2020, 2 are older. The harvest archive is almost all 2023-2026 trending news, so older evergreen stories need a new source (not more harvest).

## 2026-11-09 (third pass): rest of the harvest read, bank now 384
- The ~1,960 slug-only viral headlines left over were all read (title by title); about 50 were opened in the browser and 40 became `harvest-batch-05.json` (q0345-q0384). Every unused harvest headline has now been looked at once. Nothing in the harvest archive is left unread.
- Bank: 384 questions. Era is still lopsided (last 5 years: 364); older stories need a new source.

- **Timer change (the product owner, 2026-11-09):** interlude mystery-box pick 60 s -> 150 s; R3 wager 30 s -> 60 s (both in `TIMERS`).
