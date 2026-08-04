import type { Env } from './auth'

type ProjectDataRow = Record<string, unknown> & {
  id?: unknown
  farm_id?: unknown
  project_json?: unknown
  project_data_key?: unknown
}

type ProjectStateMeta = {
  revision: number
  checksum: string
  chunkCount: number
  byteSize: number
  fieldCount: number
  updatedAt: string
}

export type ProjectDataSnapshot = ProjectStateMeta & {
  data: unknown | null
  storage: 'd1' | 'r2-migrated' | 'legacy-migrated' | 'fallback' | 'missing'
  warning?: string
}

export type ProjectDataWriteResult = ProjectStateMeta & {
  key: string
  backupStored: boolean
}

export class ProjectDataConflict extends Error {
  code: 'PROJECT_REVISION_CONFLICT' | 'EMPTY_PROJECT_REJECTED'
  currentRevision: number
  currentFieldCount: number

  constructor(
    code: ProjectDataConflict['code'],
    message: string,
    currentRevision: number,
    currentFieldCount: number,
  ) {
    super(message)
    this.name = 'ProjectDataConflict'
    this.code = code
    this.currentRevision = currentRevision
    this.currentFieldCount = currentFieldCount
  }
}

const CHUNK_BYTES = 1_500_000
const MAX_PROJECT_BYTES = 60_000_000
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export function projectDataKey(farmId: string, projectId: string) {
  return `farms/${farmId}/projects/${projectId}/project.json`
}

function fieldCountOf(value: unknown) {
  if (!value || typeof value !== 'object') return 0
  const fields = (value as { fields?: unknown }).fields
  return Array.isArray(fields) ? fields.length : 0
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function checksumBytes(bytes: Uint8Array) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

function splitBytes(bytes: Uint8Array) {
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
    chunks.push(bytes.slice(offset, Math.min(offset + CHUNK_BYTES, bytes.byteLength)))
  }
  return chunks.length ? chunks : [new Uint8Array()]
}

function valueToBytes(value: unknown) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }
  if (Array.isArray(value)) return Uint8Array.from(value.map((item) => Number(item)))
  throw new Error('Shared project chunk has an unsupported format.')
}

async function readD1Meta(projectId: string, env: Env): Promise<ProjectStateMeta | null> {
  const row = await env.DB
    .prepare(`
      SELECT revision, checksum, chunk_count, byte_size, field_count, updated_at
      FROM project_state
      WHERE project_id = ?
    `)
    .bind(projectId)
    .first<Record<string, unknown>>()

  if (!row) return null
  return {
    revision: Number(row.revision ?? 0),
    checksum: String(row.checksum ?? ''),
    chunkCount: Number(row.chunk_count ?? 0),
    byteSize: Number(row.byte_size ?? 0),
    fieldCount: Number(row.field_count ?? 0),
    updatedAt: String(row.updated_at ?? ''),
  }
}

async function readD1Snapshot(projectId: string, env: Env): Promise<ProjectDataSnapshot | null> {
  const meta = await readD1Meta(projectId, env)
  if (!meta) return null

  const chunks = await env.DB
    .prepare(`
      SELECT chunk_index, payload
      FROM project_state_chunks
      WHERE project_id = ? AND revision = ?
      ORDER BY chunk_index ASC
    `)
    .bind(projectId, meta.revision)
    .all<Record<string, unknown>>()

  const rows = chunks.results ?? []
  if (rows.length !== meta.chunkCount) {
    throw new Error(`Shared project revision ${meta.revision} is incomplete.`)
  }

  const payload = new Uint8Array(meta.byteSize)
  let offset = 0
  for (let index = 0; index < rows.length; index += 1) {
    if (Number(rows[index].chunk_index ?? -1) !== index) {
      throw new Error(`Shared project revision ${meta.revision} has invalid chunk order.`)
    }
    const bytes = valueToBytes(rows[index].payload)
    if (offset + bytes.byteLength > payload.byteLength) {
      throw new Error(`Shared project revision ${meta.revision} exceeds its recorded size.`)
    }
    payload.set(bytes, offset)
    offset += bytes.byteLength
  }

  if (offset !== payload.byteLength) {
    throw new Error(`Shared project revision ${meta.revision} has an invalid byte count.`)
  }

  const checksum = await checksumBytes(payload)
  if (checksum !== meta.checksum) {
    throw new Error(`Shared project revision ${meta.revision} failed its checksum.`)
  }

  return {
    ...meta,
    data: JSON.parse(decoder.decode(payload)) as unknown,
    storage: 'd1',
  }
}

type FallbackRead = {
  found: boolean
  data: unknown | null
  storage: 'r2-migrated' | 'legacy-migrated' | 'missing'
  warning?: string
}

async function readFallbackProjectData(row: ProjectDataRow, env: Env): Promise<FallbackRead> {
  const key = String(row.project_data_key ?? '').trim()
  let warning: string | undefined

  if (key) {
    try {
      const object = await env.FILES.get(key)
      if (object) {
        return {
          found: true,
          data: JSON.parse(await object.text()) as unknown,
          storage: 'r2-migrated',
        }
      }
      warning = 'The former R2 project backup is missing.'
    } catch (error) {
      console.error('R2 project backup read failed', error)
      warning = 'The former R2 project backup is temporarily unavailable.'
    }
  }

  const legacy = row.project_json
  if (legacy != null && legacy !== '') {
    try {
      return {
        found: true,
        data: JSON.parse(String(legacy)) as unknown,
        storage: 'legacy-migrated',
        warning,
      }
    } catch (error) {
      console.error('Legacy project data parse failed', error)
      warning = warning
        ? `${warning} The legacy D1 project copy is invalid.`
        : 'The legacy D1 project copy is invalid.'
    }
  }

  return { found: false, data: null, storage: 'missing', warning }
}

async function persistD1State(
  env: Env,
  projectId: string,
  projectData: unknown,
  options: {
    currentRevision: number
    currentFieldCount: number
    expectedRevision?: number | null
    allowEmpty?: boolean
    updatedBy?: string | null
  },
): Promise<ProjectStateMeta> {
  const expectedRevision = options.expectedRevision
  if (expectedRevision != null && expectedRevision !== options.currentRevision) {
    throw new ProjectDataConflict(
      'PROJECT_REVISION_CONFLICT',
      'A newer shared map revision exists. Synchronize before saving again.',
      options.currentRevision,
      options.currentFieldCount,
    )
  }

  const fieldCount = fieldCountOf(projectData)
  if (options.currentFieldCount > 0 && fieldCount === 0 && !options.allowEmpty) {
    throw new ProjectDataConflict(
      'EMPTY_PROJECT_REJECTED',
      'An empty browser state was prevented from replacing the shared farm map. Synchronize to restore the fields.',
      options.currentRevision,
      options.currentFieldCount,
    )
  }

  const text = JSON.stringify(projectData ?? null)
  const payload = encoder.encode(text)
  if (payload.byteLength > MAX_PROJECT_BYTES) {
    throw new Error('Project map data is too large for shared D1 storage. Move large raster content to farm files.')
  }

  const chunks = splitBytes(payload)
  const revision = options.currentRevision + 1
  const checksum = await checksumBytes(payload)
  const updatedAt = new Date().toISOString()

  const statements: D1PreparedStatement[] = chunks.map((chunk, chunkIndex) =>
    env.DB
      .prepare(`
        INSERT INTO project_state_chunks (project_id, revision, chunk_index, payload)
        VALUES (?, ?, ?, ?)
      `)
      .bind(projectId, revision, chunkIndex, chunk.buffer),
  )

  statements.push(
    env.DB
      .prepare(`
        INSERT INTO project_state (
          project_id, revision, checksum, chunk_count, byte_size,
          field_count, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          revision = excluded.revision,
          checksum = excluded.checksum,
          chunk_count = excluded.chunk_count,
          byte_size = excluded.byte_size,
          field_count = excluded.field_count,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by
      `)
      .bind(
        projectId,
        revision,
        checksum,
        chunks.length,
        payload.byteLength,
        fieldCount,
        updatedAt,
        options.updatedBy ?? null,
      ),
    env.DB
      .prepare('DELETE FROM project_state_chunks WHERE project_id = ? AND revision <> ?')
      .bind(projectId, revision),
  )

  await env.DB.batch(statements)

  return {
    revision,
    checksum,
    chunkCount: chunks.length,
    byteSize: payload.byteLength,
    fieldCount,
    updatedAt,
  }
}

export async function readProjectData(row: ProjectDataRow, env: Env): Promise<ProjectDataSnapshot> {
  const projectId = String(row.id ?? '').trim()
  let d1Warning: string | undefined

  if (projectId) {
    try {
      const shared = await readD1Snapshot(projectId, env)
      if (shared) return shared
    } catch (error) {
      console.error('D1 shared project read failed', error)
      d1Warning = 'The shared D1 revision failed validation; a backup recovery was attempted.'
    }
  }

  const fallback = await readFallbackProjectData(row, env)
  const warning = [d1Warning, fallback.warning].filter(Boolean).join(' ')
  if (!fallback.found || !projectId) {
    return {
      data: fallback.data,
      revision: 0,
      checksum: '',
      chunkCount: 0,
      byteSize: 0,
      fieldCount: fieldCountOf(fallback.data),
      updatedAt: '',
      storage: fallback.found ? 'fallback' : 'missing',
      warning: warning || undefined,
    }
  }

  try {
    const current = await readD1Meta(projectId, env)
    const migrated = await persistD1State(env, projectId, fallback.data, {
      currentRevision: current?.revision ?? 0,
      currentFieldCount: current?.fieldCount ?? 0,
      allowEmpty: true,
    })
    return {
      ...migrated,
      data: fallback.data,
      storage: fallback.storage,
      warning: warning || undefined,
    }
  } catch (error) {
    console.error('Lazy project migration to D1 failed', error)
    return {
      data: fallback.data,
      revision: 0,
      checksum: '',
      chunkCount: 0,
      byteSize: 0,
      fieldCount: fieldCountOf(fallback.data),
      updatedAt: '',
      storage: 'fallback',
      warning: warning || 'The map loaded from backup, but D1 migration failed.',
    }
  }
}

export async function writeProjectData(
  env: Env,
  farmId: string,
  projectId: string,
  projectData: unknown,
  options: {
    existingKey?: string | null
    expectedRevision?: number | null
    allowEmpty?: boolean
    updatedBy?: string | null
    skipBackup?: boolean
  } = {},
): Promise<ProjectDataWriteResult> {
  let current = await readD1Meta(projectId, env)

  if (!current) {
    const row = await env.DB
      .prepare(`
        SELECT id, farm_id, project_json, project_data_key
        FROM projects
        WHERE id = ?
      `)
      .bind(projectId)
      .first<ProjectDataRow>()

    if (row) {
      const fallback = await readFallbackProjectData(row, env)
      if (fallback.found) {
        current = await persistD1State(env, projectId, fallback.data, {
          currentRevision: 0,
          currentFieldCount: 0,
          allowEmpty: true,
          updatedBy: options.updatedBy,
        })
      }
    }
  }

  const saved = await persistD1State(env, projectId, projectData, {
    currentRevision: current?.revision ?? 0,
    currentFieldCount: current?.fieldCount ?? 0,
    expectedRevision: options.expectedRevision,
    allowEmpty: options.allowEmpty,
    updatedBy: options.updatedBy,
  })

  const key = options.existingKey?.trim() || projectDataKey(farmId, projectId)
  let backupStored = false

  if (!options.skipBackup) {
    try {
      await env.FILES.put(key, JSON.stringify(projectData ?? null), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        customMetadata: {
          farmId,
          projectId,
          kind: 'cyberfarm-project-backup',
          revision: String(saved.revision),
          checksum: saved.checksum,
        },
      })
      backupStored = true
    } catch (error) {
      console.error('R2 project backup write failed', error)
    }
  }

  return { ...saved, key, backupStored }
}

export async function deleteProjectData(
  env: Env,
  projectId: string,
  key: unknown,
) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM project_state_chunks WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM project_state WHERE project_id = ?').bind(projectId),
  ])

  const normalized = String(key ?? '').trim()
  if (normalized) {
    try {
      await env.FILES.delete(normalized)
    } catch (error) {
      console.error('R2 project backup delete failed', error)
    }
  }
}
