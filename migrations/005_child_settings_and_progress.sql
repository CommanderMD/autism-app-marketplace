-- Phase 4: per-child sensory settings, per-lesson progress, sub-minute usage
--
-- NOT FULLY IDEMPOTENT. Sections 1 and 2 use IF NOT EXISTS; section 3 is an
-- ALTER TABLE, which SQLite cannot guard. scripts/migrate.mjs applies this
-- file exactly once and records '005_child_settings_and_progress.sql' in
-- _migrations after it succeeds; that insert deliberately does not live here.

-- 1. Sensory settings, one row per (child, app), so a child's profile follows
--    them across apps. A missing row means "defaults" (see src/routes/settings.js).
CREATE TABLE IF NOT EXISTS child_settings (
  child_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  volume INTEGER NOT NULL DEFAULT 60,          -- 0-100
  flash_intensity INTEGER NOT NULL DEFAULT 50, -- 0-100
  animation_speed REAL NOT NULL DEFAULT 1.0,   -- 0.25-2.0
  contrast TEXT NOT NULL DEFAULT 'normal',     -- 'normal' | 'high'
  animations INTEGER NOT NULL DEFAULT 1,       -- 0 | 1
  safe_mode INTEGER NOT NULL DEFAULT 1,        -- 0 | 1 - photosensitivity safe mode, ON by default
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, app_id),
  FOREIGN KEY (child_id) REFERENCES children(id),
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

-- 2. Per-lesson progress: resume point and the unlock chain.
--    No separate (child_id, app_id) index: the primary key's leading columns
--    already serve that lookup, and test/auth.test.js pins the idx_* list.
CREATE TABLE IF NOT EXISTS lesson_progress (
  child_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,        -- e.g. '01-shapes'
  step_index INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (child_id, app_id, lesson_id),
  FOREIGN KEY (child_id) REFERENCES children(id),
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

-- 3. Sub-minute usage, so minutes_used can be derived from honest seconds.
--    THIS LINE IS NOT GUARDED. SQLite has no ADD COLUMN IF NOT EXISTS. This
--    file is applied exactly once by scripts/migrate.mjs. If it is ever run a
--    second time by hand, this statement fails loudly with "duplicate column
--    name: seconds_used" - and that is correct: it means the file was already
--    applied and nothing else in it needs to run.
ALTER TABLE app_usage ADD COLUMN seconds_used INTEGER NOT NULL DEFAULT 0;
