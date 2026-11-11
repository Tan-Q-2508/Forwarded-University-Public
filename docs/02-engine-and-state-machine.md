# 02 — Engine rules and state machine

## Engine rules
A. **Pure reducer.** `reduce(state, event, ctx) -> { state, effects }`. Effects = send message, set alarm, save snapshot. Nothing else.
B. **Three exits per phase:** all eligible done / deadline alarm / nobody eligible. Eligible = connected, seated, not already done. Recompute on every join, leave, rejoin, lock, unlock.
C. **Phase id + seq.** Every outgoing state has `phaseId`; every client intent includes it. Wrong id → ignore.
D. **Secrets.** Real answers, other players' picks, hints and fakes' authors are only sent at their reveal phase. The client never holds them earlier.
E. **Validation on server.** Length limits, one lock per player, ✅ and 💣 on different options, fake ≠ real answer (similarity check), wager ≤ score, etc.
F. **Time.** Deadlines are server timestamps set by DO alarms. Clients show countdowns but never decide anything.

## States
| # | State | Timer | Done when | Next |
|---|---|---|---|---|
| 1 | Lobby | none | owner presses Start (≥3 connected) | 2 |
| 2 | Rules card | 15s | all ready / timer | 3 |
| 3 | R1 question (×4) | 90s | all locked / timer | 4 |
| 4 | R1 reveal | ~10s scripted | animation done | 5 |
| 5 | R1 lore card | 45s | all ready / timer | 3 (next question) or 6 |
| 6 | Interlude setup | 20s | dealer + underdog chosen | 7 |
| 7 | Interlude pick | 150s | underdog picks / timer (random box) | 8 |
| 8 | Interlude result | 8s | timer | 9 |
| 9 | R2 tile pick | 20s | tile chosen / timer (random) | 10 |
| 10 | R2 write | 60s | all writers done / timer | 11 |
| 11 | R2 guess | 30s per attempt (2 attempts) | hot seat locks / timer | 12 |
| 12 | R2 reveal | ~8s | animation | 13 |
| 13 | R2 comedy vote | 12s | all voted / timer | 14 |
| 14 | R2 turn end | 4s | next hot seat or → 15 | 9 or 15 |
| 15 | R3 wager | 60s | all locked / timer | 16 |
| 16 | R3 hint ×5 | 45s each | all lock/pass/solved / timer | 17 |
| 17 | R3 reveal | ~12s | animation (×2 personalities: back to 15 per personality or single wager — see 03) | 18 |
| 18 | Final podium | 15s | timer | 19 |
| 19 | Post-game | 90s | Play Again / leave | 1 |

## Failure cases the engine must handle (write a test for each)
1. Hot seat player disconnects → their turn is skipped after 10s grace; writers' fakes are saved and unused.
2. All writers disconnect → turn skipped.
3. Dealer or underdog disconnects → pick next in standing order; if none → skip Interlude.
4. Cursed player disconnects → bounty void.
5. Last player in a phase disconnects → "nobody eligible" exit fires immediately.
6. Everyone disconnects → hold state; room storage deleted 30 min after empty.
7. Player rejoins mid-phase → gets the current phase view without secrets; if they already locked, shown as locked.
8. Duplicate/late message, stale phase id → ignored.
9. Tie on any pick or vote → deterministic tiebreak (lowest seat).
10. Content pool exhausted → reset used list when <15 left, never repeat inside a game.
11. Server restart or Durable Object eviction mid-phase → restore from the last saved snapshot and re-arm the alarm from the stored deadline.
12. Player tries to place ✅ and 💣 on the same option via crafted message → rejected.
