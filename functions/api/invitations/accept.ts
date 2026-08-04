import {
  createSession,
  hashPassword,
  json,
  type Env,
} from '../../lib/auth'
import { hashInvitationToken } from '../../lib/invitations'

type AcceptBody = {
  token?: string
  password?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as AcceptBody
    const token = String(body.token ?? '').trim()
    const password = String(body.password ?? '')

    if (!token) return json({ ok: false, error: 'Invitation token is required.' }, 400)
    if (password.length < 10) {
      return json({ ok: false, error: 'Password must contain at least 10 characters.' }, 400)
    }

    const tokenHash = await hashInvitationToken(token)
    const now = new Date()
    const invitation = await env.DB
      .prepare(`
        SELECT id, email, name, role, farm_id, expires_at, accepted_at, revoked_at
        FROM user_invitations
        WHERE token_hash = ?
      `)
      .bind(tokenHash)
      .first<Record<string, unknown>>()

    if (!invitation) return json({ ok: false, error: 'Invitation is invalid.' }, 404)
    if (invitation.accepted_at) {
      return json({ ok: false, error: 'Invitation has already been accepted.' }, 409)
    }
    if (invitation.revoked_at) {
      return json({ ok: false, error: 'Invitation has been revoked.' }, 410)
    }
    if (new Date(String(invitation.expires_at)).getTime() <= now.getTime()) {
      return json({ ok: false, error: 'Invitation has expired.' }, 410)
    }

    const existing = await env.DB
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(String(invitation.email))
      .first()

    if (existing) {
      return json({ ok: false, error: 'A user with this email already exists.' }, 409)
    }

    const userId = crypto.randomUUID()
    const passwordHash = await hashPassword(password)
    const createdAt = now.toISOString()
    const farmId = String(invitation.farm_id ?? '')
    const membershipRole = invitation.role === 'editor' ? 'editor' : 'viewer'

    await env.DB.batch([
      env.DB
        .prepare(`
          INSERT INTO users (
            id, email, name, password_hash, role, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'viewer', 1, ?, ?)
        `)
        .bind(
          userId,
          String(invitation.email),
          String(invitation.name),
          passwordHash,
          createdAt,
          createdAt,
        ),
      env.DB
        .prepare(`
          INSERT INTO farm_memberships (
            farm_id, user_id, role, active, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?)
          ON CONFLICT(farm_id, user_id) DO UPDATE SET
            role = excluded.role,
            active = 1,
            updated_at = excluded.updated_at
        `)
        .bind(farmId, userId, membershipRole, createdAt, createdAt),
      env.DB
        .prepare(`
          INSERT INTO user_preferences (user_id, active_farm_id, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            active_farm_id = excluded.active_farm_id,
            updated_at = excluded.updated_at
        `)
        .bind(userId, farmId, createdAt),
      env.DB
        .prepare(`
          UPDATE user_invitations
          SET accepted_at = ?, updated_at = ?
          WHERE id = ?
        `)
        .bind(createdAt, createdAt, String(invitation.id)),
      env.DB
        .prepare(`
          INSERT INTO audit_log (
            id, actor_user_id, farm_id, action, entity_type, entity_id,
            details_json, created_at
          ) VALUES (?, ?, ?, 'invitation.accepted', 'user', ?, ?, ?)
        `)
        .bind(
          crypto.randomUUID(),
          userId,
          farmId,
          userId,
          JSON.stringify({ invitationId: String(invitation.id), role: membershipRole }),
          createdAt,
        ),
    ])

    const session = await createSession(userId, env, request)
    return json(
      {
        ok: true,
        user: {
          id: userId,
          email: String(invitation.email),
          name: String(invitation.name),
          role: 'viewer',
          active: true,
        },
      },
      201,
      { 'Set-Cookie': session.cookie },
    )
  } catch (error) {
    console.error('Accept invitation failed', error)
    return json({ ok: false, error: 'Unable to activate account.' }, 500)
  }
}
