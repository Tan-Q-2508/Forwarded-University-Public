# 06 — Content system

## Pipeline
1. **Harvest** (Gemini Deep Research, 3 big runs, all-time; prompts in `content/prompts/`) → CSV of real headlines with source URLs.
2. **Verify** (Claude): open each URL, confirm from at least 1 reputable outlet and link it on the lore card, drop anything sensitive.
3. **Write** (Claude): question, setup, real answer, 4–12 funny wrong options (Hinglish OK), lore comparisons with maths, R2 decoy category title, house lies, sensitivity flags. Style follows the style bible from `content/prompts/gemini-style-bible.md`.
4. **Import** into D1 via script. Only `status: approved` rows are playable.

## Targets
- 250 questions (each usable in R1 or R2), 80 personalities (5 pun hints each, illustration brief).
- 65% India / 35% world. Era: ~50% last 5 years, 30% 2000–2020, rest older.
- ~20 games per room before repeats.

## Selection and repetition
- Never repeat inside a game. Per-room used list: pick randomly from unused; reset when <15 left.
- Round balance: mix India/world, no shared topic tag within a round.
- Same question may be used in R1 or R2 (never both in one game).

## Crowd fakes
- Top 2 fakes per R2 turn → saved as `pending` (text only; no names, no room codes).
- Approved only after review (automatic filter + human batch). Cap 10 approved per question. Rejected ones are never shown.

## Moderation
- Automatic abuse/slur filter (English + Hinglish) on every typed fake, in the room and before saving.
- Story topic block (relaxed 2026-11-08): only death, sexual content and abuse. Everything else is allowed in stories; the Report button handles complaints. Typed fakes still go through the slur filter.
- Real people only if public figures and only for documented public acts.
- In-game **Report** button on any option; **Report error** on lore cards. Reports go to a table for batch review.
- A fake that is funny inside one group but sensitive to others is visible only in its own room; it enters the shared pool only after approval.

## Copyright
- Never copy newspaper text or screenshots. Our own summary and illustrated card, with newspaper name and link.
- Never reuse the show's own questions. No photos of real people; stylised illustrations only. Ask a lawyer about Indian personality rights before using any likeness.

## Schemas
See `content/schema/question.schema.json` and `personality.schema.json`.
