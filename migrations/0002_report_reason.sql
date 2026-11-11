-- Report button on every question: why it was reported and an optional short note from the player.
-- reports.kind is now 'option' | 'question' (older rows say 'error' = wrong fact about the question).
-- reports.question_id holds a question id (q0001) or, for Round 3, a personality id (p001).
ALTER TABLE reports ADD COLUMN reason TEXT;   -- offensive | wrong | other
ALTER TABLE reports ADD COLUMN note   TEXT;   -- player's own words, max 140 characters, may be NULL
