import {
  farmPermissionStatements,
  hashInvitationToken,
  normalizeFarmRole,
  parseStoredZones,
} from '../../lib/access'
import {
  createSession,
  hashPassword,
  json,
  type Env,
} from '../../lib/auth'

type AcceptBody = { token?: string; password?: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as AcceptBody
    const token = String(body.token ?? '').trim()
    const password = String(body.password ?? '')
    if (!token) return json({ ok: false, error: 'Invitation token is required.' }, 400)
    if (password.length < 8) {
      return json({ ok: false, error: 'Password must contain at least 8 characters.' }, 400)
    }

    const tokenHash = await hashInvitationToken(token)
    const now = new Date().toISOString()
    const invitation = await env.DB
      .prepare(`
        SELECT id, email, name, farm_id, farm_role, zones_json, status, expires_at
        FROM access_invitations
        WHERE token_hash = ?
      `)
      .bind(tokenHash)
      .first<Record<string, unknown>>()

    if (!invitation || invitation.status !== 'pending') {
      return json({ ok: false, error: 'This invitation is invalid or has already been used.' }, 404)
    }
    if (String(invitation.expires_at) <= now) {
      return json({ ok: false, error: 'This invitation has expired.' }, 410)
    }

    const email = String(invitation.email)
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (existing) {
      return json({ ok: false, error: 'An account already exists for this email. Sign in normally.' }, 409)
    }

    const userId = crypto.randomUUID()
    const passwordHash = await hashPassword(password)
    const farmId = String(invitation.farm_id)
    const role = normalizeFarmRole(invitation.farm_role)
    const zones = parseStoredZones(invitation.zones_json)
    if (!zones.length) {
      return json({ ok: false, error: 'This invitation has no accessible zones.' }, 400)
    }

    await env.DB.batch([
      env.DB
        .prepare(`
          INSERT INTO users (
            id, email, name, password_hash, role, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'viewer', 1, ?, ?)
        `)
        .bind(userId, email, String(invitation.name), passwordHash, now, now),
      env.DB
        .prepare(`
          INSERT INTO farm_memberships (
            farm_id, user_id, role, active, created_at, updated_at
          ) VALUES (?, ?, ?, 1, ?, ?)
        `)
        .bind(farmId, userId, role, now, now),
      env.DB
        .prepare(`
          INSERT INTO user_preferences (user_id, active_farm_id, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            active_farm_id = excluded.active_farm_id,
            updated_at = excluded.updated_at
        `)
        .bind(userId, farmId, now),
      ...farmPermissionStatements(env, farmId, userId, role, zones, now),
      env.DB
        .prepare(`
          UPDATE access_invitations
          SET status = 'accepted', accepted_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'
        `)
        .bind(now, now, String(invitation.id)),
    ])

    const session = await createSession(userId, env, request)
    return json({
      ok: true,
      user: {
        id: userId,
        email,
        name: String(invitation.name),
        role: 'viewer',
        active: true,
      },
    }, 201, { 'Set-Cookie': session.cookie })
  } catch (error) {
    console.error('Accept invitation failed', error)
    return json({ ok: false, error: 'Unable to accept this invitation.' }, 500)
  }
}
