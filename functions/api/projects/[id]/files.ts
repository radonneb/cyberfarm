import {
  canViewProject,
  json,
  requireAdmin,
  requireUser,
  type Env,
} from '../../../lib/auth'

type AttachFileBody = {
  fileId?: string
}

async function listProjectFiles(projectId: string, env: Env) {
  const result = await env.DB
    .prepare(`
      SELECT f.id, f.original_name, f.content_type, f.size_bytes, f.created_at
      FROM files f
      JOIN project_files pf ON pf.file_id = f.id
      WHERE pf.project_id = ?
      ORDER BY f.created_at DESC
    `)
    .bind(projectId)
    .all()

  return result.results ?? []
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const projectId = String(params.id)
  if (!(await canViewProject(auth.user, projectId, env))) {
    return json({ ok: false, error: 'Project not found.' }, 404)
  }

  const project = await env.DB
    .prepare('SELECT id FROM projects WHERE id = ?')
    .bind(projectId)
    .first()
  if (!project) return json({ ok: false, error: 'Project not found.' }, 404)

  return json({ ok: true, files: await listProjectFiles(projectId, env) })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const projectId = String(params.id)
  const body = (await request.json()) as AttachFileBody
  const fileId = String(body.fileId ?? '').trim()
  if (!fileId) return json({ ok: false, error: 'File is required.' }, 400)

  const [project, file] = await Promise.all([
    env.DB.prepare('SELECT id FROM projects WHERE id = ?').bind(projectId).first(),
    env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(fileId).first(),
  ])
  if (!project || !file) return json({ ok: false, error: 'Project or file not found.' }, 404)

  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO project_files (project_id, file_id, created_at)
      VALUES (?, ?, ?)
    `)
    .bind(projectId, fileId, new Date().toISOString())
    .run()

  return json({ ok: true, files: await listProjectFiles(projectId, env) })
}
