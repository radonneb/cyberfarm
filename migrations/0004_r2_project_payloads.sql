ALTER TABLE projects ADD COLUMN project_data_key TEXT;
ALTER TABLE files ADD COLUMN farm_id TEXT;

UPDATE files
SET farm_id = (
  SELECT p.farm_id
  FROM project_files pf
  JOIN projects p ON p.id = pf.project_id
  WHERE pf.file_id = files.id
    AND p.farm_id IS NOT NULL
  LIMIT 1
)
WHERE farm_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_data_key
  ON projects(project_data_key);

CREATE INDEX IF NOT EXISTS idx_files_farm_created
  ON files(farm_id, created_at DESC);
