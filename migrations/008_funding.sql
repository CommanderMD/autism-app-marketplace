-- Phase 5: funding model - who pays for a child's seat in an app
--
-- IDEMPOTENT: every statement uses IF NOT EXISTS / OR IGNORE. scripts/migrate.mjs
-- records '008_funding.sql' in _migrations after this file succeeds.
--
-- Numbering note: the training plan called this 005_funding.sql; 005 was taken.
--
-- Model (see docs/BILLING.md):
--   * A child WITH a school_id is funded through that school. The school holds
--     licenses: (app, seats, date window). A grant to such a child needs a
--     license that is current today AND has a free seat. Seats are counted
--     as live grants (is_active = 1 and not expired) to children of that
--     school for that app.
--   * A child WITHOUT a school_id is self-funded by the parent ('self'). No
--     seat check: the parent is the payer and Stripe arrives in a later phase.
--   No money moves in this phase. No card data is stored anywhere.

CREATE TABLE IF NOT EXISTS funding_sources (
  id TEXT PRIMARY KEY,                 -- 'school' | 'grant' | 'district' | 'self'
  name TEXT NOT NULL,
  description TEXT
);

INSERT OR IGNORE INTO funding_sources (id, name, description) VALUES
  ('school',   'School budget',  'Paid by the school from its own budget.'),
  ('grant',    'Grant',          'Paid by a named grant; record the grant in notes.'),
  ('district', 'District',       'Paid centrally by the school district.'),
  ('self',     'Family',         'Paid by the family directly. Children with no school are always self-funded.');

CREATE TABLE IF NOT EXISTS school_licenses (
  id TEXT PRIMARY KEY,                 -- UUID
  school_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  funding_source_id TEXT NOT NULL DEFAULT 'school',
  seats INTEGER NOT NULL CHECK (seats > 0 AND seats <= 100000),
  starts_at DATE NOT NULL,             -- YYYY-MM-DD, inclusive
  ends_at DATE,                        -- YYYY-MM-DD, inclusive; NULL = open-ended
  notes TEXT,                          -- PO number, grant name; never a child's name
  created_by TEXT,                     -- users.id of the platform_admin
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(id),
  FOREIGN KEY (app_id) REFERENCES apps(id),
  FOREIGN KEY (funding_source_id) REFERENCES funding_sources(id)
);
CREATE INDEX IF NOT EXISTS idx_school_licenses_school_app ON school_licenses(school_id, app_id);
