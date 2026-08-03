import {
  canViewProject,
  json,
  requireAdmin,
  requireUser,
  type Env,
} from '../../lib/auth'

type UpdateProjectBody = {
  name?: string
  fileName?: string
  projectData?: unknown
  fileId?: string | null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const id = String(params.id)
  if (!(await canViewProject(auth.user, id, env))) {
    return json({ ok: false, error: 'Project not found.' }, 404)
  }

  const row = await env.DB
    .prepare(`
      SELECT id, name, file_name, created_at, updated_at, project_json
      FROM projects
      WHERE id = ?
    `)
    .bind(id)
    .first<Record<string, unknown>>()

  if (!row) return json({ ok: false, error: 'Project not found.' }, 404)

  let projectData: unknown = null
  try {
    projectData = row.project_json ? JSON.parse(String(row.project_json)) : null
  } catch {
    projectData = null
  }

  const files = await env.DB
    .prepare(`
      SELECT f.id, f.original_name, f.content_type, f.size_bytes, f.created_at
      FROM files f
      JOIN project_files pf ON pf.file_id = f.id
      WHERE pf.project_id = ?
      ORDER BY f.created_at DESC
    `)
    .bind(id)
    .all()

  return json({
    ok: true,
    project: {
      id: String(row.id),
      name: String(row.name),
      fileName: row.file_name ? String(row.file_name) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      projectData,
      files: files.results ?? [],
    },
  })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const id = String(params.id)
    const body = (await request.json()) as UpdateProjectBody
    const existing = await env.DB
      .prepare('SELECT id FROM projects WHERE id = ?')
      .bind(id)
      .first()

    if (!existing) return json({ ok: false, error: 'Project not found.' }, 404)

    const now = new Date().toISOString()
    const name = String(body.name ?? 'Untitled project').trim() || 'Untitled project'
    const fileName = String(body.fileName ?? '').trim() || null

    await env.DB
      .prepare(`
        UPDATE projects
        SET name = ?, file_name = ?, updated_at = ?, project_json = ?
        WHERE id = ?
      `)
      .bind(name, fileName, now, JSON.stringify(body.projectData ?? null), id)
      .run()

    const fileId = String(body.fileId ?? '').trim()
    if (fileId) {
      await env.DB
        .prepare(`
          INSERT OR IGNORE INTO project_files (project_id, file_id, created_at)
          VALUES (?, ?, ?)
        `)
        .bind(id, fileId, now)
        .run()
    }

    return json({ ok: true })
  } catch (error) {
    console.error('Update project failed', error)
    return json({ ok: false, error: 'Failed to update project.' }, 500)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response || !auth.user) return auth.response

  const id = String(params.id)
  const attachedFiles = await env.DB
    .prepare(`
      SELECT f.id, f.r2_key
      FROM files f
      JOIN project_files pf ON pf.file_id = f.id
      WHERE pf.project_id = ?
    `)
    .bind(id)
    .all<Record<string, unknown>>()

  await env.DB.batch([
    env.DB.prepare('DELETE FROM project_permissions WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM project_files WHERE project_id = ?').bind(id),
    env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id),
  ])

  for (const file of attachedFiles.results ?? []) {
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
