PRAGMA foreign_keys = ON;

ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_projects_farm_archived_updated
  ON projects(farm_id, archived, updated_at DESC);

-- Access roles and enabled modules are account-wide. Backfill every existing
-- farm so current moderators/observers can switch farms without reinvitation.
WITH member_profiles AS (
  SELECT
    user_id,
    CASE WHEN MAX(CASE WHEN role = 'editor' THEN 1 ELSE 0 END) = 1
      THEN 'editor' ELSE 'viewer' END AS role,
    MIN(created_at) AS created_at,
    MAX(updated_at) AS updated_at
  FROM farm_memberships
  WHERE active = 1
  GROUP BY user_id
)
INSERT INTO farm_memberships (
  farm_id, user_id, role, active, created_at, updated_at
)
SELECT
  f.id,
  mp.user_id,
  mp.role,
  1,
  mp.created_at,
  mp.updated_at
FROM farms f
CROSS JOIN member_profiles mp
WHERE f.archived = 0
ON CONFLICT(farm_id, user_id) DO UPDATE SET
  role = excluded.role,
  active = 1,
  updated_at = excluded.updated_at;

WITH permission_profiles AS (
  SELECT
    user_id,
    module,
    CASE WHEN MAX(CASE WHEN permission = 'manage' THEN 1 ELSE 0 END) = 1
      THEN 'manage' ELSE 'view' END AS permission,
    MAX(updated_at) AS updated_at
  FROM farm_module_permissions
  WHERE permission <> 'none'
  GROUP BY user_id, module
)
INSERT INTO farm_module_permissions (
  farm_id, user_id, module, permission, updated_at
)
SELECT
  f.id,
  pp.user_id,
  pp.module,
  pp.permission,
  pp.updated_at
FROM farms f
CROSS JOIN permission_profiles pp
WHERE f.archived = 0
ON CONFLICT(farm_id, user_id, module) DO UPDATE SET
  permission = excluded.permission,
  updated_at = excluded.updated_at;

-- A previous import must not permanently block restoring fields after an
-- accidental deletion or replacement. Keep the hash indexed, but not unique.
DROP INDEX IF EXISTS idx_farm_imports_completed_hash;
CREATE INDEX IF NOT EXISTS idx_farm_imports_farm_hash
  ON farm_imports(farm_id, file_hash, created_at DESC)
  WHERE file_hash IS NOT NULL AND status = 'completed';
