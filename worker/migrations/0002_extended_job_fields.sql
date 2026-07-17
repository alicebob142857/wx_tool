ALTER TABLE positions ADD COLUMN organization_nature TEXT NOT NULL DEFAULT '未披露';
ALTER TABLE positions ADD COLUMN industry TEXT NOT NULL DEFAULT '未披露';
ALTER TABLE positions ADD COLUMN job_directions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE positions ADD COLUMN graduate_scope TEXT NOT NULL DEFAULT '未明确';
ALTER TABLE positions ADD COLUMN previous_graduates_eligible TEXT NOT NULL DEFAULT 'uncertain';
ALTER TABLE positions ADD COLUMN application_url TEXT;
ALTER TABLE positions ADD COLUMN referral_code TEXT;

CREATE INDEX IF NOT EXISTS idx_positions_organization_nature ON positions(organization_nature);
CREATE INDEX IF NOT EXISTS idx_positions_industry ON positions(industry);
