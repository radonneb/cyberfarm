import type { Env } from './auth'

type ResendEmail = {
  to: string
  subject: string
  html: string
  text: string
}

type ResendResponse = {
  id?: string
  message?: string
  name?: string
}

function senderName(value: string) {
  return value.replace(/[<>\r\n]/g, ' ').trim() || 'CyberFarms'
}

export async function sendResendEmail(env: Env, message: ResendEmail) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error('Resend is not configured for this deployment.')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${senderName(String(env.APP_NAME ?? 'CyberFarms'))} <${env.EMAIL_FROM}>`,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  })

  const result = await response.json().catch(() => ({})) as ResendResponse
  if (!response.ok || !result.id) {
    throw new Error(result.message || result.name || `Resend returned HTTP ${response.status}.`)
  }

  return result.id
}
