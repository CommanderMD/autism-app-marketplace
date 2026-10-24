-- Initial schema for Autism App Marketplace
-- Tables for managing children, apps, access, and usage

-- Children table - follows the child through their educational journey
CREATE TABLE IF NOT EXISTS children (
  id TEXT PRIMARY KEY,  -- UUID or similar identifier
  name TEXT NOT NULL,
  birth_date DATE,
  graduation_date DATE,  -- When they age out of the children's version
  school_id TEXT,        -- Reference to their school
  parent_id TEXT,        -- Reference to parent/guardian
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Apps table - the various educational/therapeutic apps in the marketplace
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,   -- UUID or slug
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,  -- e.g., 'finance', 'cognition', 'word-recognition'
  subcategory TEXT,        -- More specific categorization
  age_min INTEGER,         -- Minimum recommended age
  age_max INTEGER,         -- Maximum recommended age
  difficulty_level INTEGER, -- 1-5 scale
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Child app access/subscripitons - what apps each child has access to
CREATE TABLE IF NOT EXISTS child_app_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  granted_by TEXT,       -- Who granted access (school admin, parent)
  granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,  -- Optional expiration
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (child_id) REFERENCES children(id),
  FOREIGN KEY (app_id) REFERENCES apps(id),
  UNIQUE(child_id, app_id)
);

-- Usage tracking - for analytics and progress monitoring
CREATE TABLE IF NOT EXISTS app_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  session_date DATE NOT NULL,
  minutes_used INTEGER DEFAULT 0,
  activities_completed INTEGER DEFAULT 0,
  score INTEGER,         -- Optional score/rating
  notes TEXT,
  FOREIGN KEY (child_id) REFERENCES children(id),
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

-- Schools table - for managing school accounts and funding
CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Parents/Guardians table
CREATE TABLE IF NOT EXISTS parents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  relationship TEXT,     -- mother, father, guardian, etc.
  is_active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_child_app_access_child ON child_app_access(child_id);
CREATE INDEX IF NOT EXISTS idx_child_app_access_app ON child_app_access(app_id);
CREATE INDEX IF NOT EXISTS idx_app_usage_child ON app_usage(child_id);
CREATE INDEX IF NOT EXISTS idx_app_usage_app ON app_usage(app_id);
CREATE INDEX IF NOT EXISTS idx_app_usage_date ON app_usage(session_date);
CREATE INDEX IF NOT EXISTS idx_children_school ON children(school_id);
CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id);