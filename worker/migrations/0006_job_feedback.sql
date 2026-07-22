ALTER TABLE user_preferences ADD COLUMN consider_feedback INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN generated_preference TEXT NOT NULL DEFAULT '';
ALTER TABLE user_preferences ADD COLUMN generated_preference_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE user_preferences ADD COLUMN feedback_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN feedback_profile_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_preferences ADD COLUMN feedback_updated_at TEXT;
ALTER TABLE user_preferences ADD COLUMN feedback_profile_generated_at TEXT;

ALTER TABLE position_personalization ADD COLUMN feedback_preference_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS job_feedback (
  position_id TEXT PRIMARY KEY,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('like', 'dislike')),
  reasons_json TEXT NOT NULL DEFAULT '[]',
  job_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_feedback_sentiment_updated
  ON job_feedback(sentiment, updated_at DESC);
