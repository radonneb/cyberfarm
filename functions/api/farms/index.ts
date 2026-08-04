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
