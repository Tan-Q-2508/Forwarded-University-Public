# 01 — Game spec (overview and locked rules)

Master copy: Claude doc "Forwarded University: Game Spec & Build Plan". This file is the build-time summary.

## Basics
- 3–8 players, solo, phone/browser, external voice call. 4-letter room code. Zero host needed (the first player is "room owner" only for starting the game).
- Positive-only scoring, except the voluntary wager in Round 3.
- Every phase has a timer plus a LOCK IN / DONE button and a live "3/5 Ready" counter. When all eligible players are ready, the phase ends early.
- Optional lobby toggle: Verbal Curses on/off (for groups on voice).

## Lobby and identity
- Join with room code + name (max 12 chars, unique inside the room, case-insensitive).
- Rejoin: same name + same code returns the player to their seat with their score. Works after refresh, kick, or network drop.
- Joining mid-game: you spectate; you are seated when the next game starts (after Play Again).
- Disconnected players grey out. No bots, no pause. They are skipped by "all done" checks and can come back any time.
- If fewer than 3 connected players remain mid-game: game continues (never blocks); at <2 connected, show "waiting for friends" and keep the room alive until the empty-room timeout.
- Play Again: same room, same players who are connected; spectators get seated.

## Scoring summary
| Item | Points |
|---|---|
| R1 correct answer | +10 |
| R1 bomb on a wrong option | +15 per player whose answer sat there; bomb on the truth is defused |
| Interlude Box A | +25 |
| Interlude Box B | next correct R2 guess worth double |
| Interlude Box C | +1 now, +30 bounty if curse survives; snitch steals |
| R2 Garbage tile | +20 |
| R2 writer fools hot seat | +20 per fooled guess |
| R2 hot seat finds truth | +25 (1st try) / +10 (2nd try) / 0 |
| R2 funniest fake vote | +10 |
| R3 Who Am I | wager x1.5 (hint 1–2), x1.0 (hint 3–4), x0.5 (hint 5), lose x1.0 if unsolved |

## Ties and edge rules
- Ties for first/last: broken by (1) fewer total points from R3 wager, (2) earlier join order. Always deterministic.
- Snitch threshold: `max(2, ceil(0.5 × eligible non-cursed players))`.
- If the cursed player drops mid-curse the bounty is void and nobody is penalised.
- Wager voided if the player is greyed at resolution; they keep their points.
- Zero-point players get a free-roll wager of 20.
- Odd numbers: catch-up uses Dealer = first place, Underdog = last place; fewer than 3 connected players skips the Interlude.
