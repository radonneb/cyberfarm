import {
  farmPermissionStatements,
  normalizeFarmRole,
  normalizeZones,
  parseStoredZones,
  zonesFromModules,
} from '../../../lib/access'
import { json, requireAdmin, type Env } from '../../../lib/auth'

type UpdateAccessBody = {
  userId?: string
  role?: string
  active?: boolean
  zones?: string[]
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const farmId = String(params.id)
  const farm = await env.DB.prepare('SELECT id FROM farms WHERE id = ?').bind(farmId).first()
  if (!farm) return json({ ok: false, error: 'Farm not found.' }, 404)

  const [membersResult, invitationsResult] = await Promise.all([
    env.DB
      .prepare(`
        SELECT u.id, u.email, u.name, u.active AS user_active,
               fm.role, fm.active,
               GROUP_CONCAT(
                 CASE WHEN fmp.permission <> 'none' THEN fmp.module END
               ) AS modules
        FROM farm_memberships fm
        JOIN users u ON u.id = fm.user_id
        LEFT JOIN farm_module_permissions fmp
          ON fmp.farm_id = fm.farm_id AND fmp.user_id = fm.user_id
        WHERE fm.farm_id = ? AND u.role <> 'admin'
        GROUP BY u.id, u.email, u.name, u.active, fm.role, fm.active
        ORDER BY u.email COLLATE NOCASE ASC
      `)
      .bind(farmId)
      .all<Record<string, unknown>>(),
    env.DB
      .prepare(`
        SELECT id, email, name, farm_role, zones_json, status, expires_at,
               email_message_id, email_error, created_at
        FROM access_invitations
        WHERE farm_id = ? AND status = 'pending'
        ORDER BY created_at DESC
      `)
      .bind(farmId)
      .all<Record<string, unknown>>(),
  ])

  const members = (membersResult.results ?? []).map((row) => {
    const modules = String(row.modules ?? '').split(',').filter(Boolean)
    return {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      role: normalizeFarmRole(row.role),
      active: Boolean(row.active) && Boolean(row.user_active),
      zones: zonesFromModules(modules),
    }
  })
  const invitations = (invitationsResult.results ?? []).map((row) => ({
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: normalizeFarmRole(row.farm_role),
    zones: parseStoredZones(row.zones_json),
    expiresAt: String(row.expires_at),
    emailSent: Boolean(row.email_message_id) && !row.email_error,
    emailError: row.email_error ? String(row.email_error) : null,
    expired: String(row.expires_at) <= new Date().toISOString(),
  }))

  return json({ ok: true, members, invitations })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  try {
    const farmId = String(params.id)
    const body = (await request.json()) as UpdateAccessBody
    const userId = String(body.userId ?? '').trim()
    const role = normalizeFarmRole(body.role)
    const zones = normalizeZones(body.zones)
    const active = body.active !== false
    if (!userId) return json({ ok: false, error: 'User is required.' }, 400)
    if (active && !zones.length) {
      return json({ ok: false, error: 'Select at least one accessible zone.' }, 400)
    }

    const [farm, user, farmsResult] = await Promise.all([
      env.DB.prepare('SELECT id FROM farms WHERE id = ?').bind(farmId).first(),
      env.DB.prepare("SELECT id FROM users WHERE id = ? AND role <> 'admin'").bind(userId).first(),
      env.DB.prepare('SELECT id FROM farms WHERE archived = 0').all<Record<string, unknown>>(),
    ])
    if (!farm || !user) return json({ ok: false, error: 'Farm or user not found.' }, 404)

    const now = new Date().toISOString()
    const farmIds = (farmsResult.results ?? []).map((row) => String(row.id))
    const memberships = farmIds.map((accessibleFarmId) => env.DB
        .prepare(`
          INSERT INTO farm_memberships (
            farm_id, user_id, role, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(farm_id, user_id) DO UPDATE SET
            role = excluded.role,
            active = excluded.active,
            updated_at = excluded.updated_at
        `)
        .bind(accessibleFarmId, userId, role, active ? 1 : 0, now, now))
    const permissions = active
      ? farmIds.flatMap((accessibleFarmId) =>
          farmPermissionStatements(env, accessibleFarmId, userId, role, zones, now),
        )
      : []

    await env.DB.batch([
      ...memberships,
      env.DB
        .prepare('DELETE FROM farm_module_permissions WHERE user_id = ?')
        .bind(userId),
      ...permissions,
    ])

    return json({ ok: true })
  } catch (error) {
    console.error('Update farm access failed', error)
    return json({ ok: false, error: 'Unable to update farm access.' }, 500)
  }
}
