CREATE TABLE IF NOT EXISTS monitored_accounts (
  fakeid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'removed')),
  source TEXT NOT NULL DEFAULT 'name_search',
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monitored_accounts_status_name
  ON monitored_accounts(status, name);
