# 03 — Rounds in detail

## Round 1 — True Story (4 questions)
- Question + 5–6 options (1 truth, 4–5 funny fakes chosen from the question's wrong_options).
- Each player taps ✅ (what they think is true) and 💣 (a different option they think others will fall for). Lock In.
- Reveal: ✅ avatars land (2s) → 💣 drop (2s) → truth turns green, wrong turn red. Truth +10 per ✅. Bombs on the truth are defused. Bomb owner +15 per victim on that wrong option.
- Lore card: our own illustrated card, 2–3 comparisons, source name + link, "Report error" button.
- Questions picked so no two in the game share a topic tag; mix India/world.

## Interlude — Mystery Boxes
- Dealer = first place, Underdog = last place (solo). Dealer secretly sees all 3 boxes and tries to talk the Underdog into one. Underdog picks.
- Box A +25. Box B VIP double on next correct R2 guess. Box C +1 and a verbal curse with a +30 bounty lasting first 2 turns of R2.
- Snitch button for non-cursed players during the curse; threshold `max(2, ceil(0.5 × eligible))` within 5s; success: bounty void, first tapper +15; failed vote: 15s cooldown for the initiator.
- Cursed player gets the first hot seat. Curse list is written to be clean (no abuse, no real names beyond players in the room). Disabled if the lobby toggle is off.

## Round 2 — Pick Me Behaviour
- One turn per player. Tiles = players + 1 Garbage. Tiles show decoy category titles (bait and switch). First to tap Garbage gets +20 and picks a real tile too.
- Writers write one fake (60 chars) in 60s; "Give me a preset lie" button pulls from the question's house lies; similarity check blocks the real answer and its aliases.
- Guess grid: all fakes + real answer, shuffled, identically formatted. Hot seat has 2 attempts. Scoring as in 01.
- Comedy vote: writers tap their favourite fake (not their own). +10 to the winner; ties → both get +10.
- The top-2 fakes of each turn are saved as pending crowd fakes (text only).
- Layout rule: list never scrolls; max 9 options fit the fixed grid (cap displayed fakes to 8 + real; if more writers, take a random 8 and give the rest nothing).

## Round 3 — Who Am I?
- 2 personalities. For each: secret wager 0–100% of current score (slider), then 5 pun hints.
- On each hint a player either locks a guess (uses 1 of 3 attempts, private right/wrong) or passes. Solved players are done.
- Payout: hint 1–2 → ×1.5, hint 3–4 → ×1.0, hint 5 → ×0.5, unsolved → −1.0×wager.
- Reveal shows an illustration (not a photo), all wagers and wrong guesses. Final podium follows.
- Searchable dropdown of personalities from the same list (no spelling mistakes); dropdown must contain 300+ names including decoys, not only the 80 answerable ones.
