-- Phase 4E: scene background and combined-cue switch, per (child, app)
--
-- NOT IDEMPOTENT: two ALTER TABLE statements, which SQLite cannot guard.
-- scripts/migrate.mjs applies this file exactly once and records
-- '006_scene_and_cues.sql' in _migrations after it succeeds.

-- scene: 'plain' | 'solar' | 'jungle' | 'speedway' - a static, muted picture
-- behind the play area. 'plain' is the default (nothing behind the cards).
ALTER TABLE child_settings ADD COLUMN scene TEXT NOT NULL DEFAULT 'plain';

-- coloured_shapes: 0 | 1 - when 1, lesson 01 uses the combined colour+shape
-- cue set ("Touch the red square"). Off by default: shape alone comes first.
ALTER TABLE child_settings ADD COLUMN coloured_shapes INTEGER NOT NULL DEFAULT 0;
