import { canViewProject, json, requireUser, type Env } from '../../lib/auth'

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  const id = String(params.id)
  const row = await env.DB
    .prepare(`
      SELECT id, r2_key, original_name, content_type
      FROM files
      WHERE id = ?
    `)
    .bind(id)
    .first<Record<string, unknown>>()

  if (!row) return json({ ok: false, error: 'File not found.' }, 404)

  if (auth.user.role !== 'admin') {
    const links = await env.DB
      .prepare('SELECT project_id FROM project_files WHERE file_id = ?')
      .bind(id)
      .all<Record<string, unknown>>()

    let allowed = false
    for (const link of links.results ?? []) {
      if (await canViewProject(auth.user, String(link.project_id), env)) {
        allowed = true
        break
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

  return new Response(object.body, { headers })
}
