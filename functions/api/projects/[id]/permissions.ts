import { json, requireAdmin, type Env } from '../../../lib/auth'

type PermissionBody = {
  userId?: string
  allowed?: boolean
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const projectId = String(params.id)
  const result = await env.DB
    .prepare(`
      SELECT u.id, u.email, u.name, u.active,
             CASE WHEN pp.can_view = 1 THEN 1 ELSE 0 END AS allowed
      FROM users u
      LEFT JOIN project_permissions pp
        ON pp.user_id = u.id AND pp.project_id = ?
      WHERE u.role = 'viewer'
      ORDER BY u.email ASC
    `)
    .bind(projectId)
    .all()

  return json({ ok: true, permissions: result.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const projectId = String(params.id)
  const body = (await request.json()) as PermissionBody
  const userId = String(body.userId ?? '').trim()

  if (!userId) return json({ ok: false, error: 'User is required.' }, 400)

  const [project, user] = await Promise.all([
    env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first(),
    env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'viewer'").bind(userId).first(),
  ])

  if (!project || !user) return json({ ok: false, error: 'Project or user not found.' }, 404)

  if (body.allowed === false) {
    await env.DB
      .prepare('DELETE FROM project_permissions WHERE project_id = ? AND user_id = ?')
      .bind(projectId, userId)
      .run()
  } else {
    await env.DB
      .prepare(`
        INSERT INTO project_permissions (project_id, user_id, can_view, created_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(project_id, user_id)
        DO UPDATE SET can_view = 1
      `)
      .bind(projectId, userId, new Date().toISOString())
      .run()
  }

  return json({ ok: true })
}
