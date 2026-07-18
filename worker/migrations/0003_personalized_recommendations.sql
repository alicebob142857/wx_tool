ALTER TABLE positions ADD COLUMN custom_requirement_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE positions ADD COLUMN personalized_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE positions ADD COLUMN personalized_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE positions ADD COLUMN personalized_ranking_key INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_positions_personalized_pool
  ON positions(personalized_eligible, personalized_ranking_key DESC);

CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  custom_requirement TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
