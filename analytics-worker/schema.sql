-- Applied Concepts — analytics D1 schema.
-- Deliberately minimal: no raw IPs, no user agents, no per-visitor history.
-- visitor_hashes only ever stores a one-way, per-day-rotating hash (date is
-- baked into the hash input), purely to de-duplicate "unique visitors" per
-- day without being able to track a person across days or identify them.

CREATE TABLE IF NOT EXISTS visitor_hashes (
  date TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE(date, hash)
);

CREATE TABLE IF NOT EXISTS pageviews (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tab_views (
  date TEXT NOT NULL,
  tab TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(date, tab)
);
