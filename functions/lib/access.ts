import type { AuthUser, Env } from './auth'

export const FARM_ZONES = ['maps', 'pivot', 'bunker', 'export'] as const

export type FarmZone = (typeof FARM_ZONES)[number]
export type FarmMemberRole = 'editor' | 'viewer'
export type FarmZones = Record<FarmZone, boolean> & { access: boolean }

const ZONE_MODULES: Record<FarmZone, string[]> = {
  maps: [
    'fields',
    'guidance',
    'line_generation',
    'geotiff',
    'routes',
    'import',
    'files',
  ],
  pivot: ['pivot_track'],
  bunker: ['grain_bunker'],
  export: ['export'],
}

export function normalizeFarmRole(value: unknown): FarmMemberRole {
  return value === 'editor' ? 'editor' : 'viewer'
}

export function normalizeZones(value: unknown): FarmZone[] {
  if (!Array.isArray(value)) return []
  const requested = new Set(value.map((zone) => String(zone)))
  return FARM_ZONES.filter((zone) => requested.has(zone))
}

export function modulesForZones(zones: FarmZone[]) {
  return [...new Set(zones.flatMap((zone) => ZONE_MODULES[zone]))]
}

export function zonesFromModules(modules: string[], access = false): FarmZones {
  const allowed = new Set(modules)
  return {
    maps: ZONE_MODULES.maps.some((module) => allowed.has(module)),
    pivot: ZONE_MODULES.pivot.some((module) => allowed.has(module)),
    bunker: ZONE_MODULES.bunker.some((module) => allowed.has(module)),
    export: ZONE_MODULES.export.some((module) => allowed.has(module)),
    access,
  }
}

export function parseStoredZones(value: unknown) {
  try {
    return normalizeZones(JSON.parse(String(value ?? '[]')))
  } catch {
    return []
  }
}

export async function getFarmZones(user: AuthUser, farmId: string, env: Env) {
  if (user.role === 'admin') {
    return zonesFromModules(modulesForZones([...FARM_ZONES]), true)
  }

  const result = await env.DB
    .prepare(`
      SELECT module
      FROM farm_module_permissions
      WHERE farm_id = ?
        AND user_id = ?
        AND permission <> 'none'
    `)
    .bind(farmId, user.id)
    .all<Record<string, unknown>>()

  return zonesFromModules(
    (result.results ?? []).map((row) => String(row.module)),
    false,
  )
}

export function farmPermissionStatements(
  env: Env,
  farmId: string,
  userId: string,
  role: FarmMemberRole,
  zones: FarmZone[],
  now: string,
) {
  const permission = role === 'editor' ? 'manage' : 'view'
  return modulesForZones(zones).map((module) =>
    env.DB
      .prepare(`
        INSERT INTO farm_module_permissions (
          farm_id, user_id, module, permission, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(farm_id, user_id, module) DO UPDATE SET
          permission = excluded.permission,
          updated_at = excluded.updated_at
      `)
      .bind(farmId, userId, module, permission, now),
  )
}

export async function hashInvitationToken(token: string) {
  const bytes = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function createInvitationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
