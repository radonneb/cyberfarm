import { getSessionUser, json, type Env } from './lib/auth'

const PUBLIC_API_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/session',
])

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context
  const path = new URL(request.url).pathname

  // The application shell and static assets are public. The React app displays
  // the email login screen. Only server APIs require an authenticated session.
  if (!path.startsWith('/api/') || PUBLIC_API_PATHS.has(path)) {
    return next()
  }

  const user = await getSessionUser(request, env)
  if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)

  return next()
}
