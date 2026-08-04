import { json, type Env } from '../../../lib/auth'
import { claimFileForFarm } from '../../../lib/files'
import { requireFarmZone } from '../../../lib/farms'

type CreateImportBody = {
  sourceFileId?: string | null
  originalName?: string
  fileHash?: string | null
  importType?: string
  detectedFields?: number
  importedFields?: number
}

async function findDuplicateImport(farmId: string, fileHash: string, env: Env) {
  if (!fileHash) return null

  return env.DB
    .prepare(`
      SELECT id, original_name, imported_fields, completed_at
      FROM farm_imports
      WHERE farm_id = ? AND file_hash = ? AND status = 'completed'
      LIMIT 1
    `)
    .bind(farmId, fileHash)
    .first<Record<string, unknown>>()
}

function duplicatePayload(existing: Record<string, unknown>) {
  return {
    id: String(existing.id),
    originalName: String(existing.original_name),
    importedFields: Number(existing.imported_fields ?? 0),
    completedAt: String(existing.completed_at ?? ''),
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const farmId = String(params.id)
  const access = await requireFarmZone(request, env, farmId, 'maps')
  if (access.response) return access.response

  const fileHash = String(new URL(request.url).searchParams.get('fileHash') ?? '').trim()
  if (fileHash) {
    const existing = await findDuplicateImport(farmId, fileHash, env)
    return json({
      ok: true,
      duplicate: Boolean(existing),
      import: existing ? duplicatePayload(existing) : null,
    })
  }

  const result = await env.DB
    .prepare(`
      SELECT
        fi.id,
        fi.original_name,
        fi.file_hash,
        fi.import_type,
        fi.status,
        fi.detected_fields,
        fi.imported_fields,
        fi.created_at,
        fi.completed_at,
        fi.error_message,
        u.name AS imported_by_name,
        u.email AS imported_by_email
      FROM farm_imports fi
      LEFT JOIN users u ON u.id = fi.imported_by
      WHERE fi.farm_id = ?
      ORDER BY fi.created_at DESC
      LIMIT 100
    `)
    .bind(farmId)
    .all()

  return json({ ok: true, imports: result.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const farmId = String(params.id)
  const access = await requireFarmZone(request, env, farmId, 'maps', true)
  if (access.response || !access.user) return access.response

  try {
    const body = (await request.json()) as CreateImportBody
    const originalName = String(body.originalName ?? '').trim()
    const fileHash = String(body.fileHash ?? '').trim() || null
    const importType = String(body.importType ?? 'unknown').trim().toLowerCase()
    const detectedFields = Math.max(0, Number(body.detectedFields ?? 0) || 0)
    const importedFields = Math.max(0, Number(body.importedFields ?? 0) || 0)
    const sourceFileId = String(body.sourceFileId ?? '').trim() || null

    if (!originalName) {
      return json({ ok: false, error: 'Original file name is required.' }, 400)
    }

    if (sourceFileId && !(await claimFileForFarm(sourceFileId, farmId, env))) {
      return json({ ok: false, error: 'Source file not found.' }, 404)
    }

    const previousImport = fileHash
      ? await findDuplicateImport(farmId, fileHash, env)
      : null

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.DB
      .prepare(`
        INSERT INTO farm_imports (
          id,
          farm_id,
          source_file_id,
          original_name,
          file_hash,
          import_type,
          status,
          detected_fields,
          imported_fields,
          imported_by,
          created_at,
          completed_at,
          error_message
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, NULL)
      `)
      .bind(
        id,
        farmId,
        sourceFileId,
        originalName,
        fileHash,
        importType,
        detectedFields,
        importedFields,
        access.user.id,
        now,
        now,
      )
      .run()

    return json({
      ok: true,
      duplicate: Boolean(previousImport),
      previousImport: previousImport ? duplicatePayload(previousImport) : null,
      id,
    }, 201)
  } catch (error) {
    console.error('Create farm import record failed', error)
    return json({ ok: false, error: 'Unable to record import history.' }, 500)
  }
}
