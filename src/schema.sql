PRAGMA foreign_keys = ON;

-- Core jobs table (required + future fields)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','processing','completed','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  run_at TEXT NOT NULL,
  retry_at TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  worker_id TEXT,
  locked_at TEXT,
  timeout_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_state_runat ON jobs(state, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);

-- KV config store
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
