import { json, requireUser, type AuthUser, type Env } from './auth'

export type FarmRole = 'admin' | 'editor' | 'viewer'
export type FarmPermission = 'none' | 'view' | 'manage'

export type FarmSummary = {
  id: string
  name: string
  role: FarmRole
  archived: boolean
  createdAt: string
  updatedAt: string
}

type Row = Record<string, unknown>

function normalizeFarm(row: Row, fallbackRole: FarmRole): FarmSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    role:
      row.role === 'editor' || row.role === 'viewer' || row.role === 'admin'
        ? row.role
        : fallbackRole,
    archived: Boolean(row.archived),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  }
}

async function createDefaultFarm(user: AuthUser, env: Env) {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await env.DB.batch([
    env.DB
      .prepare(`
        INSERT INTO farms (id, name, owner_id, archived, created_at, updated_at)
        VALUES (?, 'My Farm', ?, 0, ?, ?)
      `)
      .bind(id, user.id, now, now),
    env.DB
      .prepare(`
        UPDATE projects
        SET farm_id = ?
        WHERE farm_id IS NULL AND (owner_id = ? OR owner_id IS NULL)
      `)
      .bind(id, user.id),
    env.DB
      .prepare(`
        INSERT INTO user_preferences (user_id, active_farm_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          active_farm_id = excluded.active_farm_id,
          updated_at = excluded.updated_at
      `)
      .bind(user.id, id, now),
  ])

  return id
}

export async function ensureAdminFarm(user: AuthUser, env: Env) {
  if (user.role !== 'admin') return

  const existing = await env.DB
    .prepare('SELECT id FROM farms WHERE archived = 0 LIMIT 1')
    .first()

  if (existing) return

  const legacyProject = await env.DB
    .prepare('SELECT id FROM projects WHERE farm_id IS NULL LIMIT 1')
    .first()

  if (legacyProject) await createDefaultFarm(user, env)
}

export async function listAccessibleFarms(user: AuthUser, env: Env) {
  await ensureAdminFarm(user, env)

  const query =
    user.role === 'admin'
      ? env.DB.prepare(`
          SELECT id, name, archived, created_at, updated_at, 'admin' AS role
          FROM farms
          WHERE archived = 0
          ORDER BY name COLLATE NOCASE ASC
        `)
      : env.DB
          .prepare(`
            SELECT
              f.id,
              f.name,
              f.archived,
              f.created_at,
              f.updated_at,
              fm.role
            FROM farms f
            JOIN farm_memberships fm ON fm.farm_id = f.id
            WHERE fm.user_id = ?
              AND fm.active = 1
              AND f.archived = 0
            ORDER BY f.name COLLATE NOCASE ASC
          `)
          .bind(user.id)

  const result = await query.all<Row>()
  return (result.results ?? []).map((row) =>
    normalizeFarm(row, user.role === 'admin' ? 'admin' : 'viewer'),
  )
}

export async function canAccessFarm(user: AuthUser, farmId: string, env: Env) {
  if (user.role === 'admin') {
    const farm = await env.DB
      .prepare('SELECT id FROM farms WHERE id = ? AND archived = 0')
      .bind(farmId)
      .first()
    return { allowed: Boolean(farm), role: farm ? ('admin' as const) : null }
  }

  const membership = await env.DB
    .prepare(`
      SELECT fm.role
      FROM farm_memberships fm
      JOIN farms f ON f.id = fm.farm_id
      WHERE fm.farm_id = ?
        AND fm.user_id = ?
        AND fm.active = 1
        AND f.archived = 0
    `)
    .bind(farmId, user.id)
    .first<Row>()

  const role =
    membership?.role === 'editor' || membership?.role === 'viewer'
      ? membership.role
      : null

  return { allowed: Boolean(role), role }
}

export async function getActiveFarm(user: AuthUser, env: Env) {
  const farms = await listAccessibleFarms(user, env)
  if (!farms.length) return null

  const preference = await env.DB
    .prepare('SELECT active_farm_id FROM user_preferences WHERE user_id = ?')
    .bind(user.id)
    .first<Row>()

  const preferredId = String(preference?.active_farm_id ?? '')
  const active = farms.find((farm) => farm.id === preferredId) ?? farms[0]

  if (active.id !== preferredId) {
    const now = new Date().toISOString()
    await env.DB
      .prepare(`
        INSERT INTO user_preferences (user_id, active_farm_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          active_farm_id = excluded.active_farm_id,
          updated_at = excluded.updated_at
      `)
      .bind(user.id, active.id, now)
      .run()
  }

  return active
}

export async function setActiveFarm(user: AuthUser, farmId: string, env: Env) {
  const access = await canAccessFarm(user, farmId, env)
  if (!access.allowed) return null

  const now = new Date().toISOString()
  await env.DB
    .prepare(`
      INSERT INTO user_preferences (user_id, active_farm_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        active_farm_id = excluded.active_farm_id,
        updated_at = excluded.updated_at
    `)
    .bind(user.id, farmId, now)
    .run()

  const farms = await listAccessibleFarms(user, env)
  return farms.find((farm) => farm.id === farmId) ?? null
}

export async function requireFarm(
  request: Request,
  env: Env,
  farmId: string,
  manage = false,
) {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) {
    return { user: null, role: null, response: auth.response }
  }

  const access = await canAccessFarm(auth.user, farmId, env)
  if (!access.allowed || !access.role) {
    return {
      user: null,
      role: null,
      response: json({ ok: false, error: 'Farm not found.' }, 404),
    }
  }

  if (manage && access.role === 'viewer') {
    return {
      user: null,
      role: access.role,
      response: json({ ok: false, error: 'Editor access is required.' }, 403),
    }
  }

  return { user: auth.user, role: access.role, response: null }
}
