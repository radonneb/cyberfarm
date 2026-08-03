import { json, requireAdmin, requireUser, type Env } from '../../lib/auth'

type CreateProjectBody = {
  name?: string
  fileName?: string
  projectData?: unknown
  fileId?: string | null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const query = auth.user.role === 'admin'
    ? env.DB.prepare(`
        SELECT p.id, p.name, p.file_name, p.created_at, p.updated_at,
               COUNT(pf.file_id) AS file_count
        FROM projects p
        LEFT JOIN project_files pf ON pf.project_id = p.id
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `)
    : env.DB.prepare(`
        SELECT p.id, p.name, p.file_name, p.created_at, p.updated_at,
               COUNT(pf.file_id) AS file_count
        FROM projects p
        JOIN project_permissions pp ON pp.project_id = p.id
        LEFT JOIN project_files pf ON pf.project_id = p.id
        WHERE pp.user_id = ? AND pp.can_view = 1
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `).bind(auth.user.id)

  const result = await query.all()
  return json({ ok: true, projects: result.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const body = (await request.json()) as CreateProjectBody
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const name = String(body.name ?? 'Untitled project').trim() || 'Untitled project'
    const fileName = String(body.fileName ?? '').trim() || null

    await env.DB
      .prepare(`
        INSERT INTO projects (
          id, name, file_name, created_at, updated_at, project_json, owner_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        name,
        fileName,
        now,
        now,
        JSON.stringify(body.projectData ?? null),
        auth.user.id,
      )
      .run()

    const fileId = String(body.fileId ?? '').trim()
    if (fileId) {
      const file = await env.DB
        .prepare('SELECT id FROM files WHERE id = ?')
        .bind(fileId)
        .first()

      if (file) {
        await env.DB
          .prepare(`
            INSERT OR IGNORE INTO project_files (project_id, file_id, created_at)
            VALUES (?, ?, ?)
          `)
          .bind(id, fileId, now)
          .run()
      }
    }

    return json({ ok: true, id }, 201)
  } catch (error) {
    console.error('Create project failed', error)
    return json({ ok: false, error: 'Failed to create project.' }, 500)
  }
}
