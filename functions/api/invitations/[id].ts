import { json, requireAdmin, type Env } from '../../lib/auth'

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const id = String(params.id ?? '')
  const result = await env.DB
    .prepare(`
      UPDATE access_invitations
      SET status = 'revoked', updated_at = ?
      WHERE id = ? AND status = 'pending'
    `)
    .bind(new Date().toISOString(), id)
    .run()

  if (!result.meta.changes) {
    return json({ ok: false, error: 'Pending invitation not found.' }, 404)
  }
  return json({ ok: true })
}
