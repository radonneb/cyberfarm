PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  farm_id TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_invitations_email
  ON user_invitations(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_invitations_farm
  ON user_invitations(farm_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_invitations_expiry
  ON user_invitations(expires_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  farm_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_farm_created
  ON audit_log(farm_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_created
  ON audit_log(actor_user_id, created_at DESC);
