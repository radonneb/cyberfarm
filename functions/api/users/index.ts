import {
  hashPassword,
  json,
  normalizeEmail,
  requireAdmin,
  type Env,
} from '../../lib/auth'

type CreateUserBody = {
  email?: string
  name?: string
  password?: string
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const result = await env.DB
    .prepare(`
      SELECT id, email, name, role, active, created_at, updated_at
      FROM users
      ORDER BY role ASC, email ASC
    `)
    .all()

  return json({ ok: true, users: result.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  try {
    const body = (await request.json()) as CreateUserBody
    const email = normalizeEmail(body.email)
    const name = String(body.name ?? '').trim() || email
    const password = String(body.password ?? '')

    if (!email || !email.includes('@')) {
      return json({ ok: false, error: 'A valid email is required.' }, 400)
    }
    if (password.length < 8) {
      return json({ ok: false, error: 'Password must contain at least 8 characters.' }, 400)
    }

    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (exists) return json({ ok: false, error: 'This email is already registered.' }, 409)

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const passwordHash = await hashPassword(password)

    await env.DB
      .prepare(`
        INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'viewer', 1, ?, ?)
      `)
      .bind(id, email, name, passwordHash, now, now)
      .run()

    return json({ ok: true, id }, 201)
  } catch (error) {
    console.error('Create user failed', error)
    return json({ ok: false, error: 'Failed to create user.' }, 500)
  }
}
