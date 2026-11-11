-- Forwarded University content database (Cloudflare D1).
-- Master files live in GitHub (content/); scripts/import-content.mjs loads approved items here.
-- Players never write to questions/personalities: only crowd_fakes, reports and option_blocks are written by the game.

CREATE TABLE IF NOT EXISTS questions (
  id         TEXT PRIMARY KEY,                 -- q0001
  status     TEXT NOT NULL,                    -- approved | reported | retired (only approved is playable)
  region     TEXT NOT NULL,                    -- IN | WORLD
  era        TEXT,
  json       TEXT NOT NULL,                    -- the whole question object (content/schema/question.schema.json)
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);

CREATE TABLE IF NOT EXISTS personalities (
  id     TEXT PRIMARY KEY,                     -- p001
  status TEXT NOT NULL,                        -- approved | reported | retired
  name   TEXT NOT NULL,
  json   TEXT NOT NULL
);

-- The searchable dropdown: every answer + aliases + decoys (300+ in production).
CREATE TABLE IF NOT EXISTS names (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL                           -- answer | decoy
);

CREATE TABLE IF NOT EXISTS curses (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  text   TEXT NOT NULL UNIQUE,                 -- may contain {target}
  status TEXT NOT NULL DEFAULT 'approved'
);

-- Crowd-written fakes. Text only: no names, no room codes. pending -> approved (human batch review) | rejected | reported.
CREATE TABLE IF NOT EXISTS crowd_fakes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL,
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  seen        INTEGER NOT NULL DEFAULT 1,      -- how many times groups wrote this same fake
  created_at  TEXT NOT NULL,
  UNIQUE (question_id, text)
);
CREATE INDEX IF NOT EXISTS idx_crowd_status ON crowd_fakes(status, question_id);

-- Player reports (Report on an option, Report error on a lore card). Reviewed in batches.
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL,
  kind        TEXT NOT NULL,                   -- option | error
  option_text TEXT,
  phase       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',    -- open | closed
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- A reported option leaves play immediately (even a curated one) until a human decides.
CREATE TABLE IF NOT EXISTS option_blocks (
  question_id TEXT NOT NULL,
  text        TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT 'reported',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (question_id, text)
);
