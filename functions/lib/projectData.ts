import type { Env } from './auth'

type ProjectDataRow = Record<string, unknown> & {
  id?: unknown
  farm_id?: unknown
  project_json?: unknown
  project_data_key?: unknown
}

export function projectDataKey(farmId: string, projectId: string) {
  return `farms/${farmId}/projects/${projectId}/project.json`
}

export async function readProjectData(row: ProjectDataRow, env: Env) {
  const key = String(row.project_data_key ?? '').trim()

  if (key) {
    const object = await env.FILES.get(key)
    if (!object) throw new Error('Project map data is missing from storage.')
    return JSON.parse(await object.text()) as unknown
  }

  const legacy = row.project_json
  if (legacy == null || legacy === '') return null
  return JSON.parse(String(legacy)) as unknown
}

export async function writeProjectData(
  env: Env,
  farmId: string,
  projectId: string,
  projectData: unknown,
  existingKey?: string | null,
) {
  const key = existingKey?.trim() || projectDataKey(farmId, projectId)
  const payload = JSON.stringify(projectData ?? null)

  await env.FILES.put(key, payload, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      farmId,
      projectId,
      kind: 'cyberfarm-project-data',
    },
  })

  return key
}

export async function deleteProjectData(env: Env, key: unknown) {
  const normalized = String(key ?? '').trim()
  if (normalized) await env.FILES.delete(normalized)
}
