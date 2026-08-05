PRAGMA foreign_keys = ON;

-- Canonical shared map state lives in D1. Payloads are split into small rows so
-- farms with hundreds of fields never hit D1's per-row size limit.
CREATE TABLE IF NOT EXISTS project_state (
  project_id TEXT PRIMARY KEY,
  revision TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  byte_length INTEGER NOT NULL DEFAULT 0,
  field_count INTEGER NOT NULL DEFAULT 0,
  checksum TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS project_data_chunks (
  project_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, revision, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_project_data_chunks_project_revision
  ON project_data_chunks(project_id, revision, chunk_index);

