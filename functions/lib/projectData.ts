import type { Env } from './auth'

type ProjectDataRow = Record<string, unknown> & {
  id?: unknown
  farm_id?: unknown
  project_json?: unknown
  project_data_key?: unknown
}

type ProjectStateRow = Record<string, unknown> & {
  revision?: unknown
  chunk_count?: unknown
  byte_length?: unknown
  field_count?: unknown
  checksum?: unknown
}

export type ProjectDataReadResult = {
  data: unknown
  revision: string | null
  fieldCount: number
  source: 'd1' | 'r2-backup' | 'legacy' | 'missing'
  warning: string | null
}

export type ProjectDataWriteResult = {
  key: string
  revision: string
  fieldCount: number
  byteLength: number
}

export class ProjectVersionConflictError extends Error {
  constructor() {
    super('The farm changed in the cloud. Synchronize and try again.')
    this.name = 'ProjectVersionConflictError'
  }
}

const CHUNK_CHARACTERS = 200_000
let projectDataSchemaReady: Promise<void> | null = null

/**
 * Pages deployments do not run D1 migrations automatically. Keep the new
 * shared-project storage self-healing so a frontend deploy cannot start using
 * project_state before the production database has received migration 0007.
 */
export async function ensureProjectDataSchema(env: Env) {
  if (!projectDataSchemaReady) {
    projectDataSchemaReady = env.DB.batch([
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS project_state (
          project_id TEXT PRIMARY KEY,
          revision TEXT NOT NULL,
          chunk_count INTEGER NOT NULL,
          byte_length INTEGER NOT NULL DEFAULT 0,
          field_count INTEGER NOT NULL DEFAULT 0,
          checksum TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT
        )
      `),
      env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS project_data_chunks (
          project_id TEXT NOT NULL,
          revision TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (project_id, revision, chunk_index)
        )
      `),
      env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_project_data_chunks_project_revision
        ON project_data_chunks(project_id, revision, chunk_index)
      `),
    ])
      .then(() => undefined)
      .catch((error) => {
        projectDataSchemaReady = null
        throw error
      })
  }
  await projectDataSchemaReady
}

export function projectDataKey(farmId: string, projectId: string) {
  return `farms/${farmId}/projects/${projectId}/project.json`
}

function splitPayload(payload: string) {
  const chunks: string[] = []
  for (let start = 0; start < payload.length;) {
    let end = Math.min(payload.length, start + CHUNK_CHARACTERS)
    const finalCode = payload.charCodeAt(end - 1)
    if (end < payload.length && finalCode >= 0xd800 && finalCode <= 0xdbff) end -= 1
    chunks.push(payload.slice(start, end))
    start = end
  }
  return chunks.length ? chunks : ['']
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function projectFieldCount(projectData: unknown) {
  if (!projectData || typeof projectData !== 'object' || !('fields' in projectData)) return 0
  const fields = (projectData as { fields?: unknown }).fields
  return Array.isArray(fields) ? fields.length : 0
}

async function readD1ProjectData(projectId: string, env: Env): Promise<ProjectDataReadResult | null> {
  await ensureProjectDataSchema(env)
  const state = await env.DB
    .prepare(`
      SELECT revision, chunk_count, byte_length, field_count, checksum
      FROM project_state
      WHERE project_id = ?
    `)
    .bind(projectId)
    .first<ProjectStateRow>()

  if (!state) return null
  const revision = String(state.revision ?? '')
  const expectedChunks = Number(state.chunk_count ?? 0)
  const rows = await env.DB
    .prepare(`
      SELECT chunk_index, payload
      FROM project_data_chunks
      WHERE project_id = ? AND revision = ?
      ORDER BY chunk_index ASC
    `)
    .bind(projectId, revision)
    .all<Record<string, unknown>>()

  const chunks = rows.results ?? []
  if (!revision || chunks.length !== expectedChunks) {
    throw new Error('The shared project snapshot is incomplete.')
  }
  const payload = chunks.map((chunk) => String(chunk.payload ?? '')).join('')
  if (String(state.checksum ?? '') !== await sha256(payload)) {
    throw new Error('The shared project snapshot checksum is invalid.')
  }

  return {
    data: JSON.parse(payload) as unknown,
    revision,
    fieldCount: Number(state.field_count ?? 0),
    source: 'd1',
    warning: null,
  }
}

async function getR2WithRetry(env: Env, key: string) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await env.FILES.get(key)
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 70 * (attempt + 1)))
    }
  }
  throw lastError
}

export async function readProjectData(row: ProjectDataRow, env: Env): Promise<ProjectDataReadResult> {
  const projectId = String(row.id ?? '').trim()
  let d1Warning: string | null = null
  if (projectId) {
    try {
      const shared = await readD1ProjectData(projectId, env)
      if (shared) return shared
    } catch (error) {
      console.error('Read shared D1 project snapshot failed', error)
      d1Warning = 'The shared database snapshot needs recovery.'
    }
  }

  const key = String(row.project_data_key ?? '').trim()
  if (key) {
    try {
      const object = await getR2WithRetry(env, key)
      if (object) {
        const data = JSON.parse(await object.text()) as unknown
        return {
          data,
          revision: null,
          fieldCount: projectFieldCount(data),
          source: 'r2-backup',
          warning: d1Warning,
        }
      }
    } catch (error) {
      console.error('Read R2 project backup failed', error)
      d1Warning = 'Cloud storage is temporarily unavailable. Source-file recovery is available.'
    }
  }

  const legacy = row.project_json
  if (legacy != null && legacy !== '') {
    const data = JSON.parse(String(legacy)) as unknown
    return {
      data,
      revision: null,
      fieldCount: projectFieldCount(data),
      source: 'legacy',
      warning: d1Warning,
    }
  }

  return {
    data: null,
    revision: null,
    fieldCount: 0,
    source: 'missing',
    warning: d1Warning ?? 'The project snapshot is missing. It can be rebuilt from the farm source files.',
  }
}

export async function writeProjectData(
  env: Env,
  farmId: string,
  projectId: string,
  projectData: unknown,
  existingKey?: string | null,
  options?: {
    expectedRevision?: string | null
    updatedBy?: string | null
    context?: Pick<ExecutionContext, 'waitUntil'>
  },
): Promise<ProjectDataWriteResult> {
  await ensureProjectDataSchema(env)
  const payload = JSON.stringify(projectData ?? null)
  const chunks = splitPayload(payload)
  const revision = crypto.randomUUID()
  const now = new Date().toISOString()
  const checksum = await sha256(payload)
  const byteLength = new TextEncoder().encode(payload).byteLength
  const fieldCount = projectFieldCount(projectData)
  const current = await env.DB
    .prepare('SELECT revision FROM project_state WHERE project_id = ?')
    .bind(projectId)
    .first<Record<string, unknown>>()
  const currentRevision = current ? String(current.revision ?? '') : null
  const expectedRevision = options && 'expectedRevision' in options
    ? (options.expectedRevision || null)
    : currentRevision

  if (expectedRevision !== currentRevision) throw new ProjectVersionConflictError()

  const inserts = chunks.map((chunk, index) => env.DB
    .prepare(`
      INSERT INTO project_data_chunks (
        project_id, revision, chunk_index, payload, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .bind(projectId, revision, index, chunk, now))

  const updateState = currentRevision
    ? env.DB
        .prepare(`
          UPDATE project_state
          SET revision = ?, chunk_count = ?, byte_length = ?, field_count = ?,
              checksum = ?, updated_at = ?, updated_by = ?
          WHERE project_id = ? AND revision = ?
        `)
        .bind(
          revision,
          chunks.length,
          byteLength,
          fieldCount,
          checksum,
          now,
          options?.updatedBy ?? null,
          projectId,
          currentRevision,
        )
    : env.DB
        .prepare(`
          INSERT INTO project_state (
            project_id, revision, chunk_count, byte_length, field_count,
            checksum, updated_at, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          projectId,
          revision,
          chunks.length,
          byteLength,
          fieldCount,
          checksum,
          now,
          options?.updatedBy ?? null,
        )

  try {
    const results = await env.DB.batch([...inserts, updateState])
    const stateResult = results[results.length - 1]
    if (!stateResult.success || Number(stateResult.meta.changes ?? 0) !== 1) {
      await env.DB
        .prepare('DELETE FROM project_data_chunks WHERE project_id = ? AND revision = ?')
        .bind(projectId, revision)
        .run()
      throw new ProjectVersionConflictError()
    }
  } catch (error) {
    if (error instanceof ProjectVersionConflictError) throw error
    if (String(error).toLowerCase().includes('unique')) throw new ProjectVersionConflictError()
    throw error
  }

  const key = existingKey?.trim() || projectDataKey(farmId, projectId)
  const cleanup = env.DB
    .prepare('DELETE FROM project_data_chunks WHERE project_id = ? AND revision <> ?')
    .bind(projectId, revision)
    .run()
    .catch((error) => console.error('Old project snapshot cleanup failed', error))
  const backup = env.FILES
    .put(key, payload, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { farmId, projectId, kind: 'cyberfarm-project-backup', revision },
    })
    .catch((error) => console.error('R2 project backup failed', error))

  if (options?.context) {
    options.context.waitUntil(Promise.all([cleanup, backup]).then(() => undefined))
  } else {
    await Promise.all([cleanup, backup])
  }

  return { key, revision, fieldCount, byteLength }
}

export async function deleteProjectData(env: Env, projectId: string, key: unknown) {
  await ensureProjectDataSchema(env)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM project_data_chunks WHERE project_id = ?').bind(projectId),
    env.DB.prepare('DELETE FROM project_state WHERE project_id = ?').bind(projectId),
  ])
  const normalized = String(key ?? '').trim()
  if (normalized) await env.FILES.delete(normalized)
}
