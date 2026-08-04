import type { Env } from './auth'

export async function claimFileForFarm(
  fileId: string,
  farmId: string,
  env: Env,
) {
  const file = await env.DB
    .prepare('SELECT id, farm_id FROM files WHERE id = ?')
    .bind(fileId)
    .first<Record<string, unknown>>()

  if (!file) return false

  const currentFarmId = String(file.farm_id ?? '').trim()
  if (currentFarmId && currentFarmId !== farmId) return false

  if (!currentFarmId) {
    await env.DB
      .prepare('UPDATE files SET farm_id = ? WHERE id = ? AND farm_id IS NULL')
      .bind(farmId, fileId)
      .run()
  }

  return true
}
