-- Phase 2: accounts, roles, child-safe auth
--
-- `users` is the auth identity. `parents` and `schools` are profile tables.
-- Children NEVER get a users row: a child is a record owned by parent_id
-- and/or school_id (see docs/DATA_MODEL.md).
--
-- Sessions are NOT stored in D1; they live in the SESSIONS KV namespace.
--
-- SQLite cannot ALTER TABLE ... ADD CONSTRAINT, so `parents` and `children`
-- are rebuilt (create *_new, copy rows, drop old, rename) to add their
-- foreign keys. Order matters: schools -> users -> parents -> children.
--
-- D1 always enforces foreign keys. `DROP TABLE children` would run an implicit
-- DELETE that violates the FKs from child_app_access/app_usage, and SQLite
-- does not clear that violation when children_new is renamed into place
-- (even with defer_foreign_keys). So those dependent rows are stashed,
-- removed, and restored after the rebuild; no FK is ever violated.
-- Any pre-existing parents row without a matching users row makes this
-- migration fail and roll back as a whole (remote has 0 parents rows).

-- 1. schools: already created by 001_init.sql with the required shape.
--    Nothing to change; users and children reference it below.

-- 2. users: the only table that holds credentials.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                -- crypto.randomUUID()
  email TEXT UNIQUE NOT NULL,         -- stored lower-cased
  password_hash TEXT NOT NULL,        -- pbkdf2$sha256$<iter>$<b64salt>$<b64hash>
  role TEXT NOT NULL CHECK (role IN ('school_admin', 'parent', 'platform_admin')),
  school_id TEXT,                     -- set for school_admin users
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id)
);

CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);

-- 3. parents: rebuilt so that parents.id REFERENCES users(id).
--    A parent-role user gets a parents row with the same id.
--    name becomes nullable because registration only requires email/password.
CREATE TABLE parents_new (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  relationship TEXT,     -- mother, father, guardian, etc.
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id) REFERENCES users(id)
);

INSERT INTO parents_new (id, name, email, phone, relationship, is_active, created_at, updated_at)
  SELECT id, name, email, phone, relationship, is_active, created_at, updated_at FROM parents;

DROP TABLE parents;
ALTER TABLE parents_new RENAME TO parents;

-- 4. children: rebuilt to add parent_id -> parents(id) and school_id -> schools(id).
CREATE TABLE children_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_date DATE,
  graduation_date DATE,  -- When they age out of the children's version
  school_id TEXT,        -- Owning school (FERPA education record holder)
  parent_id TEXT,        -- Owning parent/guardian (COPPA consenting adult)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES parents(id),
  FOREIGN KEY (school_id) REFERENCES schools(id)
);

INSERT INTO children_new (id, name, birth_date, graduation_date, school_id, parent_id, created_at, updated_at)
  SELECT id, name, birth_date, graduation_date, school_id, parent_id, created_at, updated_at FROM children;

-- Stash rows that reference children, then clear them so the drop is clean.
CREATE TABLE _stash_child_app_access AS
  SELECT id, child_id, app_id, granted_by, granted_at, expires_at, is_active FROM child_app_access;
CREATE TABLE _stash_app_usage AS
  SELECT id, child_id, app_id, session_date, minutes_used, activities_completed, score, notes FROM app_usage;
DELETE FROM child_app_access;
DELETE FROM app_usage;

DROP TABLE children;
ALTER TABLE children_new RENAME TO children;

-- Restore dependent rows (ids preserved) against the rebuilt children table.
INSERT INTO child_app_access (id, child_id, app_id, granted_by, granted_at, expires_at, is_active)
  SELECT id, child_id, app_id, granted_by, granted_at, expires_at, is_active FROM _stash_child_app_access;
INSERT INTO app_usage (id, child_id, app_id, session_date, minutes_used, activities_completed, score, notes)
  SELECT id, child_id, app_id, session_date, minutes_used, activities_completed, score, notes FROM _stash_app_usage;
DROP TABLE _stash_child_app_access;
DROP TABLE _stash_app_usage;

-- DROP TABLE removed the old indexes on children; recreate them.
CREATE INDEX IF NOT EXISTS idx_children_school ON children(school_id);
CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id);
