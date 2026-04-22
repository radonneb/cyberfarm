CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  project_json TEXT
);