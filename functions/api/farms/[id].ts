import { json, requireAdmin, type Env } from '../../lib/auth'
import { requireFarm } from '../../lib/farms'

type UpdateFarmBody = { name?: string; archived?: boolean }

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id)
  const access = await requireFarm(request, env, id)
  if (access.response) return access.response

  const row = await env.DB
    .prepare(`
      SELECT
        f.id,
        f.name,
        f.archived,
        f.created_at,
        f.updated_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT fm.user_id) AS member_count
      FROM farms f
      LEFT JOIN projects p ON p.farm_id = f.id
      LEFT JOIN farm_memberships fm ON fm.farm_id = f.id AND fm.active = 1
      WHERE f.id = ?
      GROUP BY f.id
    `)
    .bind(id)
    .first<Record<string, unknown>>()

  if (!row) return json({ ok: false, error: 'Farm not found.' }, 404)

  return json({
    ok: true,
    farm: {
      id: String(row.id),
      name: String(row.name),
      archived: Boolean(row.archived),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      projectCount: Number(row.project_count ?? 0),
      memberCount: Number(row.member_count ?? 0),
      role: access.role,
    },
  })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  try {
    const id = String(params.id)
    const existing = await env.DB
      .prepare('SELECT id, name, archived FROM farms WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>()
    if (!existing) return json({ ok: false, error: 'Farm not found.' }, 404)

    const body = (await request.json()) as UpdateFarmBody
    const name = body.name === undefined ? String(existing.name) : String(body.name).trim()
    if (!name) return json({ ok: false, error: 'Farm name is required.' }, 400)

    const archived = body.archived === undefined
      ? Boolean(existing.archived)
      : Boolean(body.archived)

    await env.DB
      .prepare('UPDATE farms SET name = ?, archived = ?, updated_at = ? WHERE id = ?')
      .bind(name, archived ? 1 : 0, new Date().toISOString(), id)
      .run()

    return json({ ok: true })
  } catch (error) {
    console.error('Update farm failed', error)
    return json({ ok: false, error: 'Failed to update farm.' }, 500)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const id = String(params.id)
  const farm = await env.DB.prepare('SELECT id FROM farms WHERE id = ?').bind(id).first()
  if (!farm) return json({ ok: false, error: 'Farm not found.' }, 404)

  const files = await env.DB
    .prepare(`
      SELECT DISTINCT f.id, f.r2_key
      FROM files f
      JOIN project_files pf ON pf.file_id = f.id
      JOIN projects p ON p.id = pf.project_id
      WHERE p.farm_id = ?
    `)
    .bind(id)
    .all<Record<string, unknown>>()

  const projects = await env.DB
    .prepare('SELECT id FROM projects WHERE farm_id = ?')
    .bind(id)
    .all<Record<string, unknown>>()

  const statements: D1PreparedStatement[] = []
  for (const row of projects.results ?? []) {
    const projectId = String(row.id)
    statements.push(
      env.DB.prepare('DELETE FROM project_permissions WHERE project_id = ?').bind(projectId),
      env.DB.prepare('DELETE FROM project_files WHERE project_id = ?').bind(projectId),
    )
  }

  statements.push(
    env.DB.prepare('DELETE FROM projects WHERE farm_id = ?').bind(id),
    env.DB.prepare('DELETE FROM farm_imports WHERE farm_id = ?').bind(id),
    env.DB.prepare('DELETE FROM farm_module_permissions WHERE farm_id = ?').bind(id),
    env.DB.prepare('DELETE FROM farm_memberships WHERE farm_id = ?').bind(id),
    env.DB
      .prepare('UPDATE user_preferences SET active_farm_id = NULL, updated_at = ? WHERE active_farm_id = ?')
      .bind(new Date().toISOString(), id),
    env.DB.prepare('DELETE FROM farms WHERE id = ?').bind(id),
  )

  await env.DB.batch(statements)

  for (const file of files.results ?? []) {
    const fileId = String(file.id)
    const remaining = await env.DB
      .prepare('SELECT COUNT(*) AS count FROM project_files WHERE file_id = ?')
      .bind(fileId)
      .first<Record<string, unknown>>()

    if (Number(remaining?.count ?? 0) === 0) {
      await env.FILES.delete(String(file.r2_key))
      await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run()
    }
  }

  return json({ ok: true })
}
