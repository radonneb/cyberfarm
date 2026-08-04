import { json, requireAdmin } from '../../lib/auth'
import {
  createInvitationToken,
  hashInvitationToken,
  sendInvitationEmail,
  validateInvitationInput,
  type InvitationEnv,
} from '../../lib/invitations'

export const onRequestGet: PagesFunction<InvitationEnv> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const result = await env.DB
    .prepare(`
      SELECT
        i.id,
        i.email,
        i.name,
        i.role,
        i.farm_id,
        f.name AS farm_name,
        i.expires_at,
        i.accepted_at,
        i.revoked_at,
        i.created_at
      FROM user_invitations i
      LEFT JOIN farms f ON f.id = i.farm_id
      ORDER BY i.created_at DESC
    `)
    .all<Record<string, unknown>>()

  return json({ ok: true, invitations: result.results ?? [] })
}

export const onRequestPost: PagesFunction<InvitationEnv> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const body = (await request.json()) as Record<string, unknown>
    const parsed = validateInvitationInput(body)
    if ('error' in parsed) return json({ ok: false, error: parsed.error }, 400)

    const farm = await env.DB
      .prepare('SELECT id, name FROM farms WHERE id = ? AND archived = 0')
      .bind(parsed.farmId)
      .first<Record<string, unknown>>()

    if (!farm) return json({ ok: false, error: 'Farm not found.' }, 404)

    const existingUser = await env.DB
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(parsed.email)
      .first()

    if (existingUser) {
      return json({ ok: false, error: 'A user with this email already exists.' }, 409)
    }

    const token = createInvitationToken()
    const tokenHash = await hashInvitationToken(token)
    const id = crypto.randomUUID()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000)

    await env.DB.batch([
      env.DB
        .prepare(`
          UPDATE user_invitations
          SET revoked_at = ?, updated_at = ?
          WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL
        `)
        .bind(now.toISOString(), now.toISOString(), parsed.email),
      env.DB
        .prepare(`
          INSERT INTO user_invitations (
            id, email, name, token_hash, invited_by, role, farm_id,
            expires_at, accepted_at, revoked_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        `)
        .bind(
          id,
          parsed.email,
          parsed.name,
          tokenHash,
          auth.user.id,
          parsed.role,
          parsed.farmId,
          expiresAt.toISOString(),
          now.toISOString(),
          now.toISOString(),
        ),
      env.DB
        .prepare(`
          INSERT INTO audit_log (
            id, actor_user_id, farm_id, action, entity_type, entity_id,
            details_json, created_at
          ) VALUES (?, ?, ?, 'invitation.created', 'user_invitation', ?, ?, ?)
        `)
        .bind(
          crypto.randomUUID(),
          auth.user.id,
          parsed.farmId,
          id,
          JSON.stringify({ email: parsed.email, role: parsed.role }),
          now.toISOString(),
        ),
    ])

    const origin = String(env.APP_ORIGIN ?? new URL(request.url).origin).replace(/\/$/, '')
    const inviteUrl = `${origin}/accept-invite?token=${encodeURIComponent(token)}`
    const delivery = await sendInvitationEmail(env, {
      email: parsed.email,
      name: parsed.name,
      role: parsed.role,
      farmName: String(farm.name),
      inviteUrl,
      expiresAt: expiresAt.toISOString(),
    })

    return json(
      {
        ok: true,
        invitation: {
          id,
          email: parsed.email,
          name: parsed.name,
          role: parsed.role,
          farmId: parsed.farmId,
          farmName: String(farm.name),
          expiresAt: expiresAt.toISOString(),
        },
        delivery,
        inviteUrl: delivery.sent ? undefined : inviteUrl,
      },
      201,
    )
  } catch (error) {
    console.error('Create invitation failed', error)
    return json({ ok: false, error: 'Unable to create invitation.' }, 500)
  }
}
