import { canViewProject, json, requireUser, type Env } from '../../lib/auth'
import { claimFileForFarm } from '../../lib/files'
import { FARM_ZONES, type FarmZone } from '../../lib/access'
import { requireFarmZone } from '../../lib/farms'
import {
  deleteProjectData,
  ensureProjectDataSchema,
  ProjectVersionConflictError,
  readProjectData,
  writeProjectData,
} from '../../lib/projectData'

type UpdateProjectBody = {
  name?: string
  fileName?: string
  projectData?: unknown
  fileId?: string | null
  zone?: FarmZone
  mergeProjectIds?: string[]
  expectedRevision?: string | null
  allowEmpty?: boolean
}

function normalizeWriteZone(value: unknown): FarmZone {
  const zone = String(value ?? 'maps')
  return (FARM_ZONES as readonly string[]).includes(zone) ? zone as FarmZone : 'maps'
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const id = String(params.id)
  if (!(await canViewProject(auth.user, id, env))) {
    return json({ ok: false, error: 'Project not found.' }, 404)
  }

  const row = await env.DB
    .prepare(`
      SELECT id, name, file_name, farm_id, created_at, updated_at,
             project_json, project_data_key
      FROM projects
      WHERE id = ?
    `)
    .bind(id)
    .first<Record<string, unknown>>()

  if (!row) return json({ ok: false, error: 'Project not found.' }, 404)

  let stored: Awaited<ReturnType<typeof readProjectData>>
  try {
    stored = await readProjectData(row, env)
  } catch (error) {
    console.error('Project snapshot read failed; source-file recovery will be offered', error)
    stored = {
      data: null,
      revision: null,
      fieldCount: 0,
      source: 'missing',
      warning: 'The project snapshot could not be read. It can be rebuilt from the farm source files.',
    }
  }
  try {
    if (stored.data && stored.source !== 'd1') {
      const migrated = await writeProjectData(
        env,
        String(row.farm_id ?? ''),
        id,
        stored.data,
        String(row.project_data_key ?? '') || null,
        {
          expectedRevision: null,
          updatedBy: auth.user.id,
          context: { waitUntil },
        },
      )
      stored = {
        ...stored,
        revision: migrated.revision,
        fieldCount: migrated.fieldCount,
        source: 'd1',
      }
    }
  } catch (error) {
    if (error instanceof ProjectVersionConflictError) {
      stored = await readProjectData(row, env)
    } else {
      console.error('Project data migration failed', error)
    }
  }

  const [files, recoveryFiles] = await Promise.all([
    env.DB.prepare(`
      SELECT f.id, f.original_name, f.content_type, f.size_bytes, f.created_at
      FROM files f
      JOIN project_files pf ON pf.file_id = f.id
      WHERE pf.project_id = ?
      ORDER BY f.created_at DESC
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT
        f.id,
        f.original_name,
        f.content_type,
        f.size_bytes,
        f.created_at,
        fi.file_hash,
        fi.completed_at
      FROM farm_imports fi
      JOIN files f ON f.id = fi.source_file_id
      WHERE fi.farm_id = ?
        AND fi.status = 'completed'
        AND fi.source_file_id IS NOT NULL
      ORDER BY fi.completed_at DESC, fi.created_at DESC
      LIMIT 100
    `).bind(String(row.farm_id ?? '')).all(),
  ])

  return json({
    ok: true,
    project: {
      id: String(row.id),
      name: String(row.name),
      farmId: row.farm_id ? String(row.farm_id) : null,
      fileName: row.file_name ? String(row.file_name) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      projectData: stored.data,
      revision: stored.revision,
      fieldCount: stored.fieldCount,
      dataSource: stored.source,
      storageWarning: stored.warning,
      files: files.results ?? [],
      recoveryFiles: recoveryFiles.results ?? [],
    },
  })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const id = String(params.id)
    await ensureProjectDataSchema(env)
    const body = (await request.json()) as UpdateProjectBody
    const existing = await env.DB
      .prepare(`
        SELECT p.id, p.name, p.file_name, p.farm_id, p.project_data_key,
               ps.revision, COALESCE(ps.field_count, 0) AS field_count
        FROM projects p
        LEFT JOIN project_state ps ON ps.project_id = p.id
        WHERE p.id = ?
      `)
      .bind(id)
      .first<Record<string, unknown>>()

    if (!existing) return json({ ok: false, error: 'Project not found.' }, 404)

    const farmId = String(existing.farm_id ?? '')
    const farmAccess = await requireFarmZone(
      request,
      env,
      farmId,
      normalizeWriteZone(body.zone),
      true,
    )
    if (farmAccess.response) return farmAccess.response

    const now = new Date().toISOString()
    const name = String(body.name ?? existing.name ?? 'Farm workspace').trim() || 'Farm workspace'
    const fileName = body.fileName === undefined
      ? (existing.file_name ? String(existing.file_name) : null)
      : (String(body.fileName ?? '').trim() || null)
    const fileId = String(body.fileId ?? '').trim()

    if (fileId && !(await claimFileForFarm(fileId, farmId, env))) {
      return json({ ok: false, error: 'File not found.' }, 404)
    }

    const mergeProjectIds = Array.isArray(body.mergeProjectIds)
      ? [...new Set(body.mergeProjectIds.map((value) => String(value).trim()))]
          .filter((projectId) => projectId && projectId !== id)
      : []

    if (mergeProjectIds.length) {
      const placeholders = mergeProjectIds.map(() => '?').join(', ')
      const matching = await env.DB
        .prepare(`
          SELECT id
          FROM projects
          WHERE farm_id = ? AND archived = 0 AND id IN (${placeholders})
        `)
        .bind(farmId, ...mergeProjectIds)
        .all<Record<string, unknown>>()
      if ((matching.results ?? []).length !== mergeProjectIds.length) {
        return json({ ok: false, error: 'One or more workspaces cannot be merged.' }, 409)
      }
    }

    let revision = existing.revision ? String(existing.revision) : null
    if (body.projectData !== undefined) {
      const incomingFieldCount = body.projectData
        && typeof body.projectData === 'object'
        && 'fields' in body.projectData
        && Array.isArray((body.projectData as { fields?: unknown }).fields)
          ? (body.projectData as { fields: unknown[] }).fields.length
          : 0
      if (!body.allowEmpty && Number(existing.field_count ?? 0) > 0 && incomingFieldCount === 0) {
        return json({
          ok: false,
          code: 'EMPTY_PROJECT_REJECTED',
          error: 'The cloud farm contains fields. An empty browser state was not allowed to overwrite them. Press Sync now.',
        }, 409)
      }

      const saved = await writeProjectData(
        env,
        farmId,
        id,
        body.projectData,
        String(existing.project_data_key ?? '') || null,
        {
          expectedRevision: body.expectedRevision ?? null,
          updatedBy: auth.user.id,
          context: { waitUntil },
        },
      )
      revision = saved.revision

      await env.DB
        .prepare(`
          UPDATE projects
          SET name = ?, file_name = ?, updated_at = ?,
              project_json = NULL, project_data_key = ?
          WHERE id = ?
        `)
        .bind(name, fileName, now, saved.key, id)
        .run()
    } else {
      await env.DB
        .prepare(`
          UPDATE projects
          SET name = ?, file_name = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(name, fileName, now, id)
        .run()
    }

    if (fileId) {
      await env.DB
        .prepare(`
          INSERT OR IGNORE INTO project_files (project_id, file_id, created_at)
          VALUES (?, ?, ?)
        `)
        .bind(id, fileId, now)
        .run()
    }

    if (mergeProjectIds.length) {
      const placeholders = mergeProjectIds.map(() => '?').join(', ')
      await env.DB.batch([
        env.DB
          .prepare(`
            INSERT OR IGNORE INTO project_files (project_id, file_id, created_at)
            SELECT ?, file_id, ?
            FROM project_files
            WHERE project_id IN (${placeholders})
          `)
          .bind(id, now, ...mergeProjectIds),
        env.DB
          .prepare(`
            UPDATE projects
            SET archived = 1, updated_at = ?
            WHERE farm_id = ? AND id IN (${placeholders})
          `)
          .bind(now, farmId, ...mergeProjectIds),
      ])
    }

    return json({ ok: true, updatedAt: now, revision })
  } catch (error) {
    if (error instanceof ProjectVersionConflictError) {
      return json({
        ok: false,
        code: 'PROJECT_VERSION_CONFLICT',
        error: error.message,
      }, 409)
    }
    console.error('Update project failed', error)
    return json({ ok: false, error: 'Failed to update project.' }, 500)
  }
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const id = String(params.id)
  const project = await env.DB
    .prepare('SELECT farm_id, project_data_key FROM projects WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  if (!project) return json({ ok: false, error: 'Project not found.' }, 404)

  const farmAccess = await requireFarmZone(
    request,
    env,
    String(project.farm_id ?? ''),
    'maps',
    true,
  )
  if (farmAccess.response) return farmAccess.response

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

  await deleteProjectData(env, id, project.project_data_key)

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
