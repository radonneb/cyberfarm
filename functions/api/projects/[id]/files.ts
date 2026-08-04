import { canViewProject, json, requireUser, type Env } from '../../../lib/auth'
import { claimFileForFarm } from '../../../lib/files'
import { requireFarm } from '../../../lib/farms'

type AttachFileBody = { fileId?: string }

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

  return json({ ok: true, files: await listProjectFiles(projectId, env) })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const projectId = String(params.id)
  const project = await env.DB
    .prepare('SELECT id, farm_id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Record<string, unknown>>()
  if (!project) return json({ ok: false, error: 'Project not found.' }, 404)

  const farmId = String(project.farm_id ?? '')
  const farmAccess = await requireFarm(request, env, farmId, true)
  if (farmAccess.response) return farmAccess.response

  const body = (await request.json()) as AttachFileBody
  const fileId = String(body.fileId ?? '').trim()
  if (!fileId) return json({ ok: false, error: 'File is required.' }, 400)

  if (!(await claimFileForFarm(fileId, farmId, env))) {
    return json({ ok: false, error: 'File not found.' }, 404)
  }

  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO project_files (project_id, file_id, created_at)
      VALUES (?, ?, ?)
    `)
    .bind(projectId, fileId, new Date().toISOString())
    .run()

  return json({ ok: true, files: await listProjectFiles(projectId, env) })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const projectId = String(params.id)
  const fileId = String(new URL(request.url).searchParams.get('fileId') ?? '').trim()
  if (!fileId) return json({ ok: false, error: 'File is required.' }, 400)

  const project = await env.DB
    .prepare('SELECT farm_id FROM projects WHERE id = ?')
    .bind(projectId)
    .first<Record<string, unknown>>()
  if (!project) return json({ ok: false, error: 'Project not found.' }, 404)

  const farmAccess = await requireFarm(request, env, String(project.farm_id ?? ''), true)
  if (farmAccess.response) return farmAccess.response

  const file = await env.DB
    .prepare(`
      SELECT f.id, f.r2_key
      FROM files f
      JOIN project_files pf ON pf.file_id = f.id
      WHERE pf.project_id = ? AND pf.file_id = ?
    `)
    .bind(projectId, fileId)
    .first<Record<string, unknown>>()
  if (!file) return json({ ok: false, error: 'File not found.' }, 404)

  await env.DB
    .prepare('DELETE FROM project_files WHERE project_id = ? AND file_id = ?')
    .bind(projectId, fileId)
    .run()

  const remaining = await env.DB
    .prepare('SELECT COUNT(*) AS count FROM project_files WHERE file_id = ?')
    .bind(fileId)
    .first<Record<string, unknown>>()

  if (Number(remaining?.count ?? 0) === 0) {
    await env.FILES.delete(String(file.r2_key))
    await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run()
  }

  return json({ ok: true, files: await listProjectFiles(projectId, env) })
}
