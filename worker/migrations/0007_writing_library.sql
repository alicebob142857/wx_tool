CREATE TABLE IF NOT EXISTS writing_accounts (
  fakeid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  seed_article_url TEXT NOT NULL DEFAULT '',
  seed_published_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'removed')),
  source TEXT NOT NULL DEFAULT 'name_search',
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_writing_accounts_status_name
  ON writing_accounts(status, name);

CREATE TABLE IF NOT EXISTS writing_entries (
  id TEXT PRIMARY KEY,
  account_fakeid TEXT NOT NULL,
  account_name TEXT NOT NULL,
  article_title TEXT NOT NULL,
  article_url TEXT NOT NULL UNIQUE,
  published_at TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  essay_title TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT '',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  essay_text TEXT NOT NULL,
  commentary_sections_json TEXT NOT NULL DEFAULT '[]',
  commentary_text TEXT NOT NULL,
  source_note TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  analysis_source TEXT NOT NULL DEFAULT 'deepseek',
  confidence REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_fakeid) REFERENCES writing_accounts(fakeid)
);

CREATE INDEX IF NOT EXISTS idx_writing_entries_published
  ON writing_entries(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_writing_entries_account_published
  ON writing_entries(account_fakeid, published_at DESC);

CREATE TABLE IF NOT EXISTS writing_favorites (
  entry_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES writing_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_writing_favorites_created
  ON writing_favorites(created_at DESC);

CREATE TABLE IF NOT EXISTS writing_runs (
  report_date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  accounts_configured INTEGER NOT NULL DEFAULT 0,
  accounts_succeeded INTEGER NOT NULL DEFAULT 0,
  articles_scanned INTEGER NOT NULL DEFAULT 0,
  new_articles INTEGER NOT NULL DEFAULT 0,
  candidate_articles INTEGER NOT NULL DEFAULT 0,
  examples_stored INTEGER NOT NULL DEFAULT 0,
  failed_articles INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

INSERT OR IGNORE INTO writing_accounts (
  fakeid, name, alias, avatar_url, seed_article_url, seed_published_at,
  status, source, added_at, updated_at
) VALUES (
  'MzI4MDA4MjkzMg==',
  '隔壁班学习园地',
  '',
  '',
  'https://mp.weixin.qq.com/s/UkoP5Y6mS21igFWHo1HcIw',
  '2026-07-24T11:00:00.000Z',
  'active',
  'article_url',
  '2026-07-26T00:00:00.000Z',
  '2026-07-26T00:00:00.000Z'
);
