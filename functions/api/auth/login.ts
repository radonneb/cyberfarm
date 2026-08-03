import {
  createSession,
  ensureAdminFromEnvironment,
  json,
  normalizeEmail,
  verifyPassword,
  type AuthUser,
  type Env,
} from '../../lib/auth'

type LoginBody = {
  email?: string
  password?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as LoginBody
    const email = normalizeEmail(body.email)
    const password = String(body.password ?? '')

    if (!email || !password) {
      return json({ ok: false, error: 'Email and password are required.' }, 400)
    }

    let user: AuthUser | null = await ensureAdminFromEnvironment(email, password, env)

    if (!user) {
      const row = await env.DB
        .prepare(`
          SELECT id, email, name, password_hash, role, active
          FROM users
          WHERE email = ?
        `)
        .bind(email)
        .first<Record<string, unknown>>()

      if (!row || !Boolean(row.active)) {
        return json({ ok: false, error: 'Invalid email or password.' }, 401)
      }

      const valid = await verifyPassword(password, String(row.password_hash ?? ''))
      if (!valid) {
        return json({ ok: false, error: 'Invalid email or password.' }, 401)
      }

      user = {
        id: String(row.id),
        email: String(row.email),
        name: String(row.name ?? row.email),
        role: row.role === 'admin' ? 'admin' : 'viewer',
        active: true,
      }
    }

    const session = await createSession(user.id, env, request)
    return json(
      { ok: true, user },
      200,
      { 'Set-Cookie': session.cookie },
    )
  } catch (error) {
    console.error('Login failed', error)
    return json({ ok: false, error: 'Unable to sign in.' }, 500)
  }
}
