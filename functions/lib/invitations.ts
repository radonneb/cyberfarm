import { json, normalizeEmail, type Env } from './auth'

export type InvitationEnv = Env & {
  RESEND_API_KEY?: string
  INVITE_FROM_EMAIL?: string
  APP_ORIGIN?: string
}

export type InvitationRole = 'editor' | 'viewer'

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function createInvitationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bytesToHex(bytes)
}

export async function hashInvitationToken(token: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  )
  return bytesToHex(new Uint8Array(digest))
}

export function validateInvitationInput(body: Record<string, unknown>) {
  const email = normalizeEmail(body.email)
  const name = String(body.name ?? '').trim()
  const role: InvitationRole = body.role === 'editor' ? 'editor' : 'viewer'
  const farmId = String(body.farmId ?? '').trim()

  if (!email) return { error: 'Email is required.' as const }
  if (!name) return { error: 'Name is required.' as const }
  if (!farmId) return { error: 'Farm is required.' as const }

  return { email, name, role, farmId }
}

export async function sendInvitationEmail(
  env: InvitationEnv,
  invitation: {
    email: string
    name: string
    role: InvitationRole
    farmName: string
    inviteUrl: string
    expiresAt: string
  },
) {
  const apiKey = String(env.RESEND_API_KEY ?? '').trim()
  const from = String(env.INVITE_FROM_EMAIL ?? 'CyberFarm <access@notify.cyberfarm.org>').trim()

  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY is not configured.' }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [invitation.email],
      subject: `You are invited to ${invitation.farmName} in CyberFarm`,
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#10231a">
          <h1 style="font-size:24px">CyberFarm invitation</h1>
          <p>Hello ${escapeHtml(invitation.name)},</p>
          <p>You were invited as <strong>${invitation.role}</strong> to <strong>${escapeHtml(invitation.farmName)}</strong>.</p>
          <p><a href="${invitation.inviteUrl}" style="display:inline-block;background:#f2c94c;color:#06110c;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Set password and activate account</a></p>
          <p style="font-size:13px;color:#587064">This one-time link expires on ${new Date(invitation.expiresAt).toUTCString()}.</p>
        </div>
      `,
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    console.error('Resend invitation failed', response.status, detail)
    return { sent: false, reason: 'Email provider rejected the invitation.' }
  }

  return { sent: true }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function invitationError(message: string, status = 400) {
  return json({ ok: false, error: message }, status)
}
