import { json, requireUser, type Env } from '../../lib/auth'
import { claimFileForFarm } from '../../lib/files'
import { canAccessFarm, getActiveFarm, requireFarmZone } from '../../lib/farms'
import { deleteProjectData, writeProjectData } from '../../lib/projectData'

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
  const activeFarm = requestedFarmId ? null : await getActiveFarm(auth.user, env)
  const farmId = requestedFarmId || activeFarm?.id || ''

  if (!farmId) return json({ ok: true, projects: [] })

  const access = await canAccessFarm(auth.user, farmId, env)
  if (!access.allowed) return json({ ok: false, error: 'Farm not found.' }, 404)

  const result = await env.DB
    .prepare(`
      SELECT p.id, p.name, p.file_name, p.created_at, p.updated_at,
             p.farm_id, COUNT(pf.file_id) AS file_count
      FROM projects p
      LEFT JOIN project_files pf ON pf.project_id = p.id
      WHERE p.farm_id = ?
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `)
    .bind(farmId)
    .all()

  return json({ ok: true, projects: result.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  let projectDataKey: string | null = null

  try {
    const body = (await request.json()) as CreateProjectBody
    const activeFarm = body.farmId ? null : await getActiveFarm(auth.user, env)
    const farmId = String(body.farmId ?? activeFarm?.id ?? '').trim()

    if (!farmId) return json({ ok: false, error: 'Farm is required.' }, 400)

    const access = await requireFarmZone(request, env, farmId, 'maps', true)
    if (access.response) return access.response

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const name = String(body.name ?? 'Farm workspace').trim() || 'Farm workspace'
    const fileName = String(body.fileName ?? '').trim() || null
    const fileId = String(body.fileId ?? '').trim()

    if (fileId && !(await claimFileForFarm(fileId, farmId, env))) {
      return json({ ok: false, error: 'File not found.' }, 404)
    }

    if (body.projectData !== undefined) {
      projectDataKey = await writeProjectData(env, farmId, id, body.projectData)
    }

    const statements: D1PreparedStatement[] = [
      env.DB
        .prepare(`
          INSERT INTO projects (
            id, name, file_name, created_at, updated_at, project_json,
            owner_id, farm_id, project_data_key
          ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)
        `)
        .bind(
          id,
          name,
          fileName,
          now,
          now,
          auth.user.id,
          farmId,
          projectDataKey,
        ),
    ]

    if (fileId) {
      statements.push(
        env.DB
          .prepare(`
            INSERT OR IGNORE INTO project_files (project_id, file_id, created_at)
            VALUES (?, ?, ?)
          `)
          .bind(id, fileId, now),
      )
    }

    await env.DB.batch(statements)
    return json({ ok: true, id }, 201)
  } catch (error) {
    if (projectDataKey) await deleteProjectData(env, projectDataKey)
    console.error('Create project failed', error)
    return json({ ok: false, error: 'Failed to create project.' }, 500)
  }
}
