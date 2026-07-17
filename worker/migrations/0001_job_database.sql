PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS report_days (
  report_date TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  accounts_configured INTEGER NOT NULL DEFAULT 0,
  accounts_succeeded INTEGER NOT NULL DEFAULT 0,
  articles_scanned INTEGER NOT NULL DEFAULT 0,
  new_articles INTEGER NOT NULL DEFAULT 0,
  candidate_articles INTEGER NOT NULL DEFAULT 0,
  relevant_articles INTEGER NOT NULL DEFAULT 0,
  positions_extracted INTEGER NOT NULL DEFAULT 0,
  failed_articles INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  account TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  ocr_used INTEGER NOT NULL DEFAULT 0,
  ocr_image_count INTEGER NOT NULL DEFAULT 0,
  analysis_source TEXT NOT NULL,
  extraction_complete INTEGER NOT NULL DEFAULT 0,
  notes_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (report_date) REFERENCES report_days(report_date) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  account TEXT NOT NULL,
  organization TEXT NOT NULL,
  job_title TEXT NOT NULL,
  locations_json TEXT NOT NULL DEFAULT '[]',
  headcount TEXT,
  employment_types_json TEXT NOT NULL DEFAULT '[]',
  education_summary TEXT NOT NULL DEFAULT '未明确',
  education_minimum TEXT,
  education_preferred TEXT,
  education_tier TEXT NOT NULL DEFAULT 'unspecified',
  hard_phd_required INTEGER NOT NULL DEFAULT 0,
  major_summary TEXT NOT NULL DEFAULT '未明确',
  accepted_majors_json TEXT NOT NULL DEFAULT '[]',
  major_fit TEXT NOT NULL DEFAULT 'uncertain',
  application_requirements_json TEXT NOT NULL DEFAULT '[]',
  compensation_summary TEXT NOT NULL DEFAULT '未披露',
  salary TEXT,
  benefits_json TEXT NOT NULL DEFAULT '[]',
  compensation_quality INTEGER NOT NULL DEFAULT 0,
  deadline TEXT,
  application_method TEXT,
  recommendation_score INTEGER NOT NULL DEFAULT 0,
  ranking_key INTEGER NOT NULL DEFAULT 0,
  recommendation_level TEXT NOT NULL DEFAULT 'low',
  recommendation_reasons_json TEXT NOT NULL DEFAULT '[]',
  concerns_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (report_date) REFERENCES report_days(report_date) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_positions_date_rank ON positions(report_date, ranking_key DESC);
CREATE INDEX IF NOT EXISTS idx_positions_account ON positions(account);
CREATE INDEX IF NOT EXISTS idx_positions_major_fit ON positions(major_fit);
CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(report_date);
