PRAGMA foreign_keys = ON;

-- Canonical shared map state. Project geometry and tool configuration are kept
-- in D1 so every farm member reads the same revision. Payloads are split into
-- binary chunks by the Worker to stay below D1's per-row size limit.
CREATE TABLE IF NOT EXISTS project_state (
  project_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  byte_size INTEGER NOT NULL DEFAULT 0,
  field_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_state_chunks (
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload BLOB NOT NULL,
  PRIMARY KEY (project_id, revision, chunk_index),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_state_chunks_revision
  ON project_state_chunks(project_id, revision, chunk_index);
