import { hashInvitationToken, parseStoredZones } from '../../lib/access'
import { json, type Env } from '../../lib/auth'

type InspectBody = { token?: string }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as InspectBody
    const token = String(body.token ?? '').trim()
    if (!token) return json({ ok: false, error: 'Invitation token is required.' }, 400)

    const tokenHash = await hashInvitationToken(token)
    const invitation = await env.DB
      .prepare(`
        SELECT ai.email, ai.name, ai.farm_role, ai.zones_json, ai.expires_at,
               ai.status, f.name AS farm_name
        FROM access_invitations ai
        JOIN farms f ON f.id = ai.farm_id
        WHERE ai.token_hash = ?
      `)
      .bind(tokenHash)
      .first<Record<string, unknown>>()

    if (!invitation || invitation.status !== 'pending') {
      return json({ ok: false, error: 'This invitation is invalid or has already been used.' }, 404)
    }
    if (String(invitation.expires_at) <= new Date().toISOString()) {
      return json({ ok: false, error: 'This invitation has expired. Ask the administrator to send a new one.' }, 410)
    }

    return json({
      ok: true,
      invitation: {
        email: String(invitation.email),
        name: String(invitation.name),
        farmName: String(invitation.farm_name),
        role: invitation.farm_role === 'editor' ? 'editor' : 'viewer',
        zones: parseStoredZones(invitation.zones_json),
        expiresAt: String(invitation.expires_at),
      },
    })
  } catch (error) {
    console.error('Inspect invitation failed', error)
    return json({ ok: false, error: 'Unable to read this invitation.' }, 500)
  }
}
