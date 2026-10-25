-- Phase 5: IEP / learning-standards tagging
--
-- IDEMPOTENT: every statement uses IF NOT EXISTS / OR IGNORE, so running this
-- file twice is safe. scripts/migrate.mjs records '007_standards.sql' in
-- _migrations after this file succeeds; that insert deliberately does not
-- live here.
--
-- Numbering note: the training plan called this 004_standards.sql. 004-006
-- were already taken by the time Phase 5 started, so it is 007. Same content.

-- 1. A standard is a goal an IEP team can write against: "Identifies basic
--    shapes". `code` is an optional external reference (a state standard, an
--    ABLLS-R / VB-MAPP item) and is free text, never interpreted.
CREATE TABLE IF NOT EXISTS standards (
  id TEXT PRIMARY KEY,                 -- slug, e.g. 'shapes-identify'
  domain TEXT NOT NULL,                -- 'cognitive' | 'language' | 'social-emotional' | 'math' | 'daily-living'
  goal TEXT NOT NULL,                  -- one line, parent-readable
  description TEXT,                    -- optional: what "met" looks like
  code TEXT,                           -- optional external reference
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Which app (and, optionally, which lesson inside it) works on which goal.
--    lesson_id '' means the whole app. It is NOT NULL on purpose: SQLite lets
--    NULLs through a non-integer PRIMARY KEY and treats each as distinct, which
--    would allow duplicate whole-app rows.
CREATE TABLE IF NOT EXISTS app_standards (
  app_id TEXT NOT NULL,
  standard_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL DEFAULT '',  -- '' = whole app, else e.g. '01-shapes'
  PRIMARY KEY (app_id, standard_id, lesson_id),
  FOREIGN KEY (app_id) REFERENCES apps(id),
  FOREIGN KEY (standard_id) REFERENCES standards(id)
);
CREATE INDEX IF NOT EXISTS idx_app_standards_standard ON app_standards(standard_id);

-- 3. Act 1 goals, one per lesson. Wording is deliberately the kind of line
--    that goes straight into an IEP "present levels / goals" section.
INSERT OR IGNORE INTO standards (id, domain, goal, description) VALUES
  ('shapes-identify',       'cognitive',        'Identifies basic shapes',                     'Points to or names circle, square, triangle, rectangle and star when asked.'),
  ('numbers-count-10',      'math',             'Counts and recognises numbers 1-10',          'Matches a quantity to its numeral and a numeral to a quantity, 1-10.'),
  ('nouns-common-objects',  'language',         'Identifies common objects by name',           'Points to everyday objects, animals, vehicles and nature items when named.'),
  ('verbs-actions',         'language',         'Identifies action words',                     'Points to the picture that shows running, jumping, sprinting or skipping rope.'),
  ('colours-primary',       'cognitive',        'Identifies primary and secondary colours',    'Points to red, blue, yellow and green when named.'),
  ('emotions-basic',        'social-emotional', 'Recognises basic emotions',                   'Identifies happy, sad, calm and excited from a face or a situation.'),
  ('opposites-relational',  'cognitive',        'Understands relational opposites',            'Distinguishes big/small, hot/cold, fast/slow.'),
  ('sequencing-3-step',     'daily-living',     'Sequences a 3-step routine',                  'Orders first, next, last for a familiar routine such as morning preparation.'),
  ('prepositions-spatial',  'language',         'Understands spatial prepositions',            'Identifies in, on, under, behind and next to.'),
  ('math-add-subtract-5',   'math',             'Adds and subtracts within 5 using objects',   'Solves concrete single-digit addition and subtraction by adding or removing objects.');

INSERT OR IGNORE INTO app_standards (app_id, standard_id, lesson_id) VALUES
  ('act1-sensory-learning', 'shapes-identify',      '01-shapes'),
  ('act1-sensory-learning', 'numbers-count-10',     '02-numbers'),
  ('act1-sensory-learning', 'nouns-common-objects', '03-nouns'),
  ('act1-sensory-learning', 'verbs-actions',        '04-verbs'),
  ('act1-sensory-learning', 'colours-primary',      '05-colors'),
  ('act1-sensory-learning', 'emotions-basic',       '06-emotions'),
  ('act1-sensory-learning', 'opposites-relational', '07-opposites'),
  ('act1-sensory-learning', 'sequencing-3-step',    '08-sequencing'),
  ('act1-sensory-learning', 'prepositions-spatial', '09-prepositions'),
  ('act1-sensory-learning', 'math-add-subtract-5',  '10-math');
