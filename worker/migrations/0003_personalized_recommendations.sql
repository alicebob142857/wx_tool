CREATE TABLE IF NOT EXISTS position_personalization (
  position_id TEXT PRIMARY KEY,
  custom_requirement_json TEXT NOT NULL DEFAULT '{}',
  personalized_json TEXT NOT NULL DEFAULT '{}',
  personalized_eligible INTEGER NOT NULL DEFAULT 0,
  personalized_ranking_key INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_position_personalized_pool
  ON position_personalization(personalized_eligible, personalized_ranking_key DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  custom_requirement TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
