import { canViewProject, json, requireUser, type Env } from '../../lib/auth'
import { requireFarmZone } from '../../lib/farms'

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const id = String(params.id)
  const row = await env.DB
    .prepare(`
      SELECT id, farm_id, r2_key, original_name, content_type, size_bytes, created_at
      FROM files
      WHERE id = ?
    `)
    .bind(id)
    .first<Record<string, unknown>>()

  if (!row) return json({ ok: false, error: 'File not found.' }, 404)

  if (auth.user.role !== 'admin') {
    let allowed = false
    const farmId = String(row.farm_id ?? '').trim()

    if (farmId) {
      const farmAccess = await requireFarmZone(request, env, farmId, 'maps')
      if (farmAccess.response) {
        return json({ ok: false, error: 'File not found.' }, 404)
      }
      allowed = true
    } else {
      const links = await env.DB
        .prepare('SELECT project_id FROM project_files WHERE file_id = ?')
        .bind(id)
        .all<Record<string, unknown>>()

      for (const link of links.results ?? []) {
        if (await canViewProject(auth.user, String(link.project_id), env)) {
          allowed = true
          break
        }
      }
    }

    if (!allowed) return json({ ok: false, error: 'File not found.' }, 404)
  }

  const object = await env.FILES.get(String(row.r2_key))
  if (!object) return json({ ok: false, error: 'File not found in storage.' }, 404)

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(String(row.original_name))}`)
  headers.set('Cache-Control', 'private, no-store')
  headers.set('ETag', object.httpEtag)
  headers.set('X-CyberFarm-File-Size', String(row.size_bytes ?? object.size))
  headers.set('X-CyberFarm-File-Created-At', String(row.created_at ?? ''))

  return new Response(object.body, { headers })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const id = String(params.id)
  const file = await env.DB
    .prepare('SELECT id, farm_id, r2_key FROM files WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
  if (!file) return json({ ok: false, error: 'File not found.' }, 404)

  const farmId = String(file.farm_id ?? '').trim()
  if (farmId) {
    const farmAccess = await requireFarmZone(request, env, farmId, 'maps', true)
    if (farmAccess.response) return farmAccess.response
  } else if (auth.user.role !== 'admin') {
    return json({ ok: false, error: 'File not found.' }, 404)
  }

  const linked = await env.DB
    .prepare('SELECT COUNT(*) AS count FROM project_files WHERE file_id = ?')
    .bind(id)
    .first<Record<string, unknown>>()

  if (Number(linked?.count ?? 0) > 0) {
    return json({ ok: false, error: 'Detach the file from its project before deleting it.' }, 409)
  }

  await env.FILES.delete(String(file.r2_key))
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run()
  return json({ ok: true })
}
