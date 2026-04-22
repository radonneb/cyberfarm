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

async function hasValidSession(request: Request, env: Env) {
  const cookieHeader = request.headers.get('Cookie')
  const sessionId = getCookieValue(cookieHeader, 'cyberfarm_session')
  if (!sessionId) return false

  const row = await env.DB
    .prepare('SELECT id FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first()

  return Boolean(row)
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context
  const url = new URL(request.url)
  const path = url.pathname

  const publicPaths = new Set([
    '/unlock',
    '/unlock.html',
    '/api/unlock',
    '/api/session',
    '/favicon.ico',
  ])

  const publicPrefixes = ['/assets/']

  const isPublic =
    publicPaths.has(path) ||
    publicPrefixes.some((prefix) => path.startsWith(prefix))

  if (isPublic) {
    return next()
  }

  const validSession = await hasValidSession(request, env)

  if (!validSession) {
    if (path.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    return Response.redirect(`${url.origin}/unlock.html`, 302)
  }

  return next()
}