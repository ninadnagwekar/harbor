-- Test case sheets. The API also creates this table on startup.
CREATE TABLE IF NOT EXISTS test_cases (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  title VARCHAR(200) NOT NULL,
  module VARCHAR(120) NOT NULL DEFAULT '',
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  case_type VARCHAR(20) NOT NULL DEFAULT 'functional',
  preconditions TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '',
  expected_result TEXT NOT NULL DEFAULT '',
  actual_result TEXT NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'not_run',
  assignee_id UUID REFERENCES users (id) ON DELETE SET NULL,
  comments TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_test_case_code UNIQUE (project_id, code),
  CONSTRAINT ck_test_cases_priority CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT ck_test_cases_status CHECK (status IN ('not_run', 'pass', 'fail', 'blocked')),
  CONSTRAINT ck_test_cases_type CHECK (case_type IN ('functional', 'regression', 'smoke', 'integration', 'ui'))
);
CREATE INDEX IF NOT EXISTS ix_test_cases_project ON test_cases (project_id, position);
