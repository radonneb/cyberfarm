import { json, requireAdmin, requireUser, type Env } from '../../lib/auth'
import { getActiveFarm, listAccessibleFarms } from '../../lib/farms'

type CreateFarmBody = { name?: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const farms = await listAccessibleFarms(auth.user, env)
  const activeFarm = await getActiveFarm(auth.user, env)
  return json({ ok: true, farms, activeFarmId: activeFarm?.id ?? null })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const body = (await request.json()) as CreateFarmBody
    const name = String(body.name ?? '').trim()
    if (!name) return json({ ok: false, error: 'Farm name is required.' }, 400)

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const [memberProfiles, permissionProfiles] = await Promise.all([
      env.DB
        .prepare(`
          SELECT
            user_id,
            CASE WHEN MAX(CASE WHEN role = 'editor' THEN 1 ELSE 0 END) = 1
              THEN 'editor' ELSE 'viewer' END AS role
          FROM farm_memberships
          WHERE active = 1
          GROUP BY user_id
        `)
        .all<Record<string, unknown>>(),
      env.DB
        .prepare(`
          SELECT
            user_id,
            module,
            CASE WHEN MAX(CASE WHEN permission = 'manage' THEN 1 ELSE 0 END) = 1
              THEN 'manage' ELSE 'view' END AS permission
          FROM farm_module_permissions
          WHERE permission <> 'none'
          GROUP BY user_id, module
        `)
        .all<Record<string, unknown>>(),
    ])

    const inheritedMemberships = (memberProfiles.results ?? []).map((profile) =>
      env.DB
        .prepare(`
          INSERT INTO farm_memberships (
            farm_id, user_id, role, active, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?)
        `)
        .bind(id, String(profile.user_id), profile.role === 'editor' ? 'editor' : 'viewer', now, now),
    )
    const inheritedPermissions = (permissionProfiles.results ?? []).map((profile) =>
      env.DB
        .prepare(`
          INSERT INTO farm_module_permissions (
            farm_id, user_id, module, permission, updated_at
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
          id,
          String(profile.user_id),
          String(profile.module),
          profile.permission === 'manage' ? 'manage' : 'view',
          now,
        ),
    )

    await env.DB.batch([
      env.DB
        .prepare(`
          INSERT INTO farms (id, name, owner_id, archived, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?)
        `)
        .bind(id, name, auth.user.id, now, now),
      env.DB
        .prepare(`
          INSERT INTO user_preferences (user_id, active_farm_id, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            active_farm_id = excluded.active_farm_id,
            updated_at = excluded.updated_at
        `)
        .bind(auth.user.id, id, now),
      ...inheritedMemberships,
      ...inheritedPermissions,
    ])

    return json(
      {
        ok: true,
        farm: {
          id,
          name,
          role: 'admin',
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
      },
      201,
    )
  } catch (error) {
    console.error('Create farm failed', error)
    return json({ ok: false, error: 'Failed to create farm.' }, 500)
  }
}
