import {
  createInvitationToken,
  hashInvitationToken,
  normalizeFarmRole,
  normalizeZones,
} from '../../lib/access'
import { json, normalizeEmail, requireAdmin, type Env } from '../../lib/auth'
import { sendResendEmail } from '../../lib/resend'

type InvitationBody = {
  email?: string
  name?: string
  farmId?: string
  role?: string
  zones?: string[]
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const body = (await request.json()) as InvitationBody
    const email = normalizeEmail(body.email)
    const name = String(body.name ?? '').trim() || email
    const farmId = String(body.farmId ?? '').trim()
    const role = normalizeFarmRole(body.role)
    const zones = normalizeZones(body.zones)

    if (!email || !email.includes('@')) {
      return json({ ok: false, error: 'A valid email is required.' }, 400)
    }
    if (!farmId) return json({ ok: false, error: 'Farm is required.' }, 400)
    if (!zones.length) {
      return json({ ok: false, error: 'Select at least one accessible zone.' }, 400)
    }
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
      return json({
        ok: false,
        error: 'Resend is not configured for this deployment.',
      }, 503)
    }

    const [farm, existingUser] = await Promise.all([
      env.DB.prepare('SELECT id, name FROM farms WHERE id = ? AND archived = 0').bind(farmId).first<Record<string, unknown>>(),
      env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first(),
    ])
    if (!farm) return json({ ok: false, error: 'Farm not found.' }, 404)
    if (existingUser) {
      return json({ ok: false, error: 'This email already has an account. Add it as a farm member instead.' }, 409)
    }

    const id = crypto.randomUUID()
    const token = createInvitationToken()
    const tokenHash = await hashInvitationToken(token)
    const createdAt = new Date()
    const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    const now = createdAt.toISOString()

    await env.DB.batch([
      env.DB
        .prepare(`
          UPDATE access_invitations
          SET status = 'revoked', updated_at = ?
          WHERE email = ? AND farm_id = ? AND status = 'pending'
        `)
        .bind(now, email, farmId),
      env.DB
        .prepare(`
          INSERT INTO access_invitations (
            id, email, name, farm_id, farm_role, zones_json, token_hash,
            status, invited_by, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
        `)
        .bind(
          id,
          email,
          name,
          farmId,
          role,
          JSON.stringify(zones),
          tokenHash,
          auth.user.id,
          expiresAt.toISOString(),
          now,
          now,
        ),
    ])

    const appName = String(env.APP_NAME ?? 'CyberFarms')
    const invitationUrl = new URL('/', new URL(request.url).origin)
    invitationUrl.searchParams.set('invite', token)
    const safeName = escapeHtml(name)
    const safeFarm = escapeHtml(String(farm.name))
    const roleLabel = role === 'editor' ? 'Moderator' : 'Observer'
    const zoneLabel = zones.map((zone) => zone[0].toUpperCase() + zone.slice(1)).join(', ')

    try {
      const messageId = await sendResendEmail(env, {
        to: email,
        subject: `${appName}: account invitation`,
        text: [
          `Hello ${name},`,
          '',
          `${auth.user.name || auth.user.email} invited you to ${appName}.`,
          `Starting farm: ${String(farm.name)}`,
          'Your role and accessible zones apply to every farm.',
          `Role: ${roleLabel}`,
          `Accessible zones: ${zoneLabel}`,
          '',
          `Create your password: ${invitationUrl.toString()}`,
          '',
          'This invitation expires in 7 days and can only be used once.',
        ].join('\n'),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#173326">
            <div style="padding:24px;border-radius:18px 18px 0 0;background:#0b3a27;color:#fff">
              <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8ce0a9">${escapeHtml(appName)}</div>
              <h1 style="margin:8px 0 0;font-size:24px">Account access invitation</h1>
            </div>
            <div style="padding:26px;border:1px solid #dce9e1;border-top:0;border-radius:0 0 18px 18px;background:#f8fbf9">
              <p>Hello <strong>${safeName}</strong>,</p>
              <p>You have been invited to <strong>${escapeHtml(appName)}</strong>. Your role and accessible zones apply to every farm.</p>
              <div style="margin:20px 0;padding:14px 16px;border-radius:12px;background:#edf6f0">
                <div><strong>Starting farm:</strong> ${safeFarm}</div>
                <div style="margin-top:6px"><strong>Role:</strong> ${roleLabel}</div>
                <div style="margin-top:6px"><strong>Accessible zones:</strong> ${escapeHtml(zoneLabel)}</div>
              </div>
              <a href="${escapeHtml(invitationUrl.toString())}" style="display:inline-block;padding:13px 20px;border-radius:11px;background:#f2c94c;color:#25331d;text-decoration:none;font-weight:700">Create password and join</a>
              <p style="margin-top:22px;color:#6d7d73;font-size:12px">The link expires in 7 days and can only be used once.</p>
            </div>
          </div>
        `,
      })

      await env.DB
        .prepare(`
          UPDATE access_invitations
          SET email_message_id = ?, email_error = NULL, updated_at = ?
          WHERE id = ?
        `)
        .bind(messageId, new Date().toISOString(), id)
        .run()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email delivery failed.'
      await env.DB
        .prepare('UPDATE access_invitations SET email_error = ?, updated_at = ? WHERE id = ?')
        .bind(message.slice(0, 500), new Date().toISOString(), id)
        .run()
      console.error('Invitation email failed', error)
      return json({
        ok: false,
        invitationId: id,
        error: 'Invitation was saved, but Resend could not send the email. Check the Resend domain and API key, then retry.',
      }, 502)
    }

    return json({ ok: true, invitationId: id, expiresAt: expiresAt.toISOString() }, 201)
  } catch (error) {
    console.error('Create invitation failed', error)
    return json({ ok: false, error: 'Unable to create invitation.' }, 500)
  }
}
