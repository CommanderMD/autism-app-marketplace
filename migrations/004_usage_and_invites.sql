-- Phase 3: migration tracking, unique usage key, school invites
--
-- IDEMPOTENT: every statement uses IF NOT EXISTS / OR IGNORE, so running this
-- file twice is safe (unlike 003_auth.sql, which must never be re-run).
-- scripts/migrate.mjs records '004_usage_and_invites.sql' in _migrations after
-- this file succeeds; that insert deliberately does not live here.

-- 1. Migration tracking table, read and written by scripts/migrate.mjs.
CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Backfill the migrations applied by hand before the runner existed, so
--    the runner never re-runs 003_auth.sql.
INSERT OR IGNORE INTO _migrations (name) VALUES
  ('001_init.sql'), ('002_seed_apps.sql'), ('003_auth.sql');

-- 3. One usage row per child, app and day. 001_init.sql only has non-unique
--    indexes on these columns.
--    ASSUMES NO DUPLICATE (child_id, app_id, session_date) ROWS EXIST. If any
--    do, this statement fails and the runner stops without recording 004.
--    That is intended: duplicates must be merged by a human, not silently dropped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_usage_unique
  ON app_usage(child_id, app_id, session_date);

-- 4. School invites: lets a second school_admin (or a parent) join an existing
--    school at registration instead of creating a new one.
CREATE TABLE IF NOT EXISTS school_invites (
  code TEXT PRIMARY KEY,               -- 8 chars, A-Z0-9, crypto.getRandomValues
  school_id TEXT NOT NULL,
  email TEXT,                          -- optional: bind invite to one address
  role TEXT NOT NULL DEFAULT 'school_admin'
    CHECK (role IN ('school_admin', 'parent')),
  created_by TEXT,
  expires_at TIMESTAMP,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id)
);
CREATE INDEX IF NOT EXISTS idx_school_invites_school ON school_invites(school_id);
