import { hashPassword, json, requireAdmin, type Env } from '../../lib/auth'

type UpdateUserBody = {
  name?: string
  active?: boolean
  password?: string
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response || !auth.user) return auth.response

  const id = String(params.id)
  if (id === auth.user.id) {
    return json({ ok: false, error: 'The active administrator cannot disable this account.' }, 400)
  }

  const body = (await request.json()) as UpdateUserBody
  const existing = await env.DB
    .prepare('SELECT id, name, active FROM users WHERE id = ? AND role = ?')
    .bind(id, 'viewer')
    .first<Record<string, unknown>>()

  if (!existing) return json({ ok: false, error: 'User not found.' }, 404)

  const now = new Date().toISOString()
  const name = String(body.name ?? existing.name ?? '').trim() || 'Viewer'
  const active = typeof body.active === 'boolean' ? body.active : Boolean(existing.active)
  const password = String(body.password ?? '')

  if (password) {
    if (password.length < 8) {
      return json({ ok: false, error: 'Password must contain at least 8 characters.' }, 400)
    }
    const passwordHash = await hashPassword(password)
    await env.DB
      .prepare(`
        UPDATE users
        SET name = ?, active = ?, password_hash = ?, updated_at = ?
        WHERE id = ?
      `)
      .bind(name, active ? 1 : 0, passwordHash, now, id)
      .run()
  } else {
    await env.DB
      .prepare('UPDATE users SET name = ?, active = ?, updated_at = ? WHERE id = ?')
      .bind(name, active ? 1 : 0, now, id)
      .run()
  }

  if (!active) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id).run()
  }

  return json({ ok: true })
}
