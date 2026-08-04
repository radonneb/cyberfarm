PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS farms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_farms_owner_id ON farms(owner_id);
CREATE INDEX IF NOT EXISTS idx_farms_archived ON farms(archived);

CREATE TABLE IF NOT EXISTS farm_memberships (
  farm_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (farm_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_farm_memberships_user_id
  ON farm_memberships(user_id, active);

CREATE TABLE IF NOT EXISTS farm_module_permissions (
  farm_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  module TEXT NOT NULL CHECK (
    module IN (
      'fields',
      'guidance',
      'line_generation',
      'geotiff',
      'routes',
      'pivot_track',
      'grain_bunker',
      'import',
      'export',
      'files'
    )
  ),
  permission TEXT NOT NULL CHECK (permission IN ('none', 'view', 'manage')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (farm_id, user_id, module)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  active_farm_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS farm_imports (
  id TEXT PRIMARY KEY,
  farm_id TEXT NOT NULL,
  source_file_id TEXT,
  original_name TEXT NOT NULL,
  file_hash TEXT,
  import_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'processing', 'completed', 'failed')
  ),
  detected_fields INTEGER NOT NULL DEFAULT 0,
  imported_fields INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_farm_imports_farm_created
  ON farm_imports(farm_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_imports_completed_hash
  ON farm_imports(farm_id, file_hash)
  WHERE file_hash IS NOT NULL AND status = 'completed';

ALTER TABLE projects ADD COLUMN farm_id TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_farm_updated
  ON projects(farm_id, updated_at DESC);
