CREATE TABLE IF NOT EXISTS access_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  farm_id TEXT NOT NULL,
  farm_role TEXT NOT NULL CHECK (farm_role IN ('editor', 'viewer')),
  zones_json TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'accepted', 'revoked')
  ),
  invited_by TEXT NOT NULL,
  email_message_id TEXT,
  email_error TEXT,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_access_invitations_farm_status
  ON access_invitations(farm_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_access_invitations_email_status
  ON access_invitations(email, status);

CREATE INDEX IF NOT EXISTS idx_access_invitations_expires
  ON access_invitations(status, expires_at);
