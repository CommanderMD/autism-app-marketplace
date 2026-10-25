-- Phase 5: nightly usage rollup and the admin audit log
--
-- IDEMPOTENT: every statement uses IF NOT EXISTS. scripts/migrate.mjs records
-- '009_usage_daily_and_audit.sql' in _migrations after this file succeeds.

-- 1. usage_daily: one closed row per child, app and UTC day, written by the
--    scheduled handler (src/rollup.js) from app_usage. Only days before today
--    are rolled: today's row is still being written to, so the summary reads
--    today live from app_usage and every earlier day from here. Re-rolling a
--    day is safe (upsert) and corrects the row if app_usage changed.
CREATE TABLE IF NOT EXISTS usage_daily (
  child_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  day DATE NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  minutes INTEGER NOT NULL DEFAULT 0,
  activities INTEGER NOT NULL DEFAULT 0,
  score INTEGER,
  rolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, app_id, day),
  FOREIGN KEY (child_id) REFERENCES children(id),
  FOREIGN KEY (app_id) REFERENCES apps(id)
);
CREATE INDEX IF NOT EXISTS idx_usage_daily_day ON usage_daily(day);

-- 2. audit_log: who did what to which record, for admin and school-admin
--    actions. `detail` is small JSON (ids, counts, field names) and NEVER a
--    child's name, email or any other personal data (Rule A4). No IP address
--    is stored either. Rows are append-only; nothing in the app updates or
--    deletes them.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actor_id TEXT,                       -- users.id, or 'system' for the cron
  actor_role TEXT,                     -- 'platform_admin' | 'school_admin' | 'system'
  action TEXT NOT NULL,                -- e.g. 'app.create', 'license.create', 'usage.rollup'
  target_type TEXT,                    -- 'app' | 'school' | 'user' | 'license' | 'grant' | 'usage'
  target_id TEXT,
  detail TEXT                          -- JSON, ids and counts only
);
CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);
