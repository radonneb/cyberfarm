type Env = {
  APP_UNLOCK_CODE: string
  DB: D1Database
  FILES: R2Bucket
}

function getCookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';').map((part) => part.trim())
  for (const part of parts) {
    const [key, ...rest] = part.split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const cookieHeader = request.headers.get('Cookie')
  const sessionId = getCookieValue(cookieHeader, 'cyberfarm_session')

  if (!sessionId) {
    return new Response(JSON.stringify({ ok: false, authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const row = await env.DB
    .prepare('SELECT id FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first()

  return new Response(
    JSON.stringify({
      ok: true,
      authenticated: Boolean(row),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}