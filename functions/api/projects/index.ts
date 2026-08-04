import { json, requireUser, type Env } from '../../lib/auth'
import { canAccessFarm, getActiveFarm, requireFarm } from '../../lib/farms'

type CreateProjectBody = {
  name?: string
  fileName?: string
  projectData?: unknown
  fileId?: string | null
  farmId?: string | null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const url = new URL(request.url)
  const requestedFarmId = String(url.searchParams.get('farmId') ?? '').trim()
  const activeFarm = requestedFarmId
    ? null
    : await getActiveFarm(auth.user, env)
  const farmId = requestedFarmId || activeFarm?.id || ''

  if (!farmId) return json({ ok: true, projects: [] })

  const access = await canAccessFarm(auth.user, farmId, env)
  if (!access.allowed) return json({ ok: false, error: 'Farm not found.' }, 404)

  const query = auth.user.role === 'admin'
    ? env.DB.prepare(`
        SELECT p.id, p.name, p.file_name, p.created_at, p.updated_at,
               p.farm_id, COUNT(pf.file_id) AS file_count
        FROM projects p
        LEFT JOIN project_files pf ON pf.project_id = p.id
        WHERE p.farm_id = ?
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `).bind(farmId)
    : env.DB.prepare(`
        SELECT p.id, p.name, p.file_name, p.created_at, p.updated_at,
               p.farm_id, COUNT(pf.file_id) AS file_count
        FROM projects p
        LEFT JOIN project_files pf ON pf.project_id = p.id
        WHERE p.farm_id = ?
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `).bind(farmId)

  const result = await query.all()
  return json({ ok: true, projects: result.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const body = (await request.json()) as CreateProjectBody
    const activeFarm = body.farmId
      ? null
      : await getActiveFarm(auth.user, env)
    const farmId = String(body.farmId ?? activeFarm?.id ?? '').trim()

    if (!farmId) return json({ ok: false, error: 'Farm is required.' }, 400)

    const access = await requireFarm(request, env, farmId, true)
    if (access.response) return access.response

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const name = String(body.name ?? 'Farm workspace').trim() || 'Farm workspace'
    const fileName = String(body.fileName ?? '').trim() || null

    await env.DB
      .prepare(`
        INSERT INTO projects (
          id, name, file_name, created_at, updated_at, project_json, owner_id, farm_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        name,
        fileName,
        now,
        now,
        JSON.stringify(body.projectData ?? null),
        auth.user.id,
        farmId,
      )
      .run()

    const fileId = String(body.fileId ?? '').trim()
    if (fileId) {
      const file = await env.DB.prepare('SELECT id FROM files WHERE id = ?').bind(fileId).first()
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
