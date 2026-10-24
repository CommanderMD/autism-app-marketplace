-- Seed apps into apps table
INSERT OR REPLACE INTO apps (id, name, description, category, subcategory, age_min, age_max, difficulty_level, is_active)
VALUES 
  ('act1-sensory-learning', 'Act 1 — Sensory Learning', 'A 10-lesson sequential sensory learning curriculum designed for autistic children.', 'learning', 'sensory', 3, 12, 1, 1),
  ('money-bingo', 'Money Bingo', 'Interactive financial recognition and money management game.', 'finance', 'counting', 5, 14, 2, 1),
  ('word-builder', 'Word Builder', 'Visual word recognition and vocabulary building for early learners.', 'cognition', 'literacy', 4, 10, 1, 1),
  ('emotion-match', 'Emotion Matcher', 'Recognizing and understanding facial expressions and social cues.', 'social', 'emotions', 3, 12, 1, 1),
  ('pattern-puzzles', 'Pattern Puzzles', 'Cognitive pattern recognition and visual sequencing games.', 'cognition', 'logic', 4, 12, 2, 1);
