export type Env = {
  DB: D1Database
  FILES: R2Bucket
  ADMIN_EMAIL?: string
  ADMIN_PASSWORD?: string
}

export type UserRole = 'admin' | 'viewer'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: UserRole
  active: boolean
}

const SESSION_COOKIE = 'cyberfarm_auth'
const SESSION_DAYS = 7
const PASSWORD_ITERATIONS = 600_000

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(headers ?? {}),
    },
  })
}

export function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    keyMaterial,
    256,
  )

  return new Uint8Array(bits)
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS)
  return `${PASSWORD_ITERATIONS}.${bytesToBase64(salt)}.${bytesToBase64(hash)}`
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [iterationsRaw, saltRaw, hashRaw] = encodedHash.split('.')
  const iterations = Number(iterationsRaw)
  if (!iterations || !saltRaw || !hashRaw) return false

  const expected = base64ToBytes(hashRaw)
  const actual = await derivePassword(password, base64ToBytes(saltRaw), iterations)
  if (actual.length !== expected.length) return false

  let different = 0
  for (let index = 0; index < actual.length; index += 1) {
    different |= actual[index] ^ expected[index]
  }
  return different === 0
}

function getCookie(request: Request, name: string) {
  const header = request.headers.get('Cookie')
  if (!header) return null

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export async function getSessionUser(request: Request, env: Env): Promise<AuthUser | null> {
  const sessionId = getCookie(request, SESSION_COOKIE)
  if (!sessionId) return null

  const now = new Date().toISOString()
  const row = await env.DB
    .prepare(`
      SELECT u.id, u.email, u.name, u.role, u.active
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.active = 1
    `)
    .bind(sessionId, now)
    .first<Record<string, unknown>>()

  if (!row) return null

  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? row.email),
    role: row.role === 'admin' ? 'admin' : 'viewer',
    active: Boolean(row.active),
  }
}

export async function createSession(userId: string, env: Env, request?: Request) {
  const id = crypto.randomUUID()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)

  await env.DB
    .prepare(`
      INSERT INTO auth_sessions (id, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `)
    .bind(id, userId, createdAt.toISOString(), expiresAt.toISOString())
    .run()

  const secure = !request || new URL(request.url).protocol === 'https:'
  const secureAttribute = secure ? '; Secure' : ''

  return {
    id,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  }
}

export async function destroySession(request: Request, env: Env) {
  const sessionId = getCookie(request, SESSION_COOKIE)
  if (sessionId) {
    await env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(sessionId).run()
  }

  const secure = new URL(request.url).protocol === 'https:'
  const secureAttribute = secure ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=0`
}

export async function requireUser(request: Request, env: Env) {
  const user = await getSessionUser(request, env)
  if (!user) return { user: null, response: json({ ok: false, error: 'Unauthorized' }, 401) }
  return { user, response: null }
}

export async function requireAdmin(request: Request, env: Env) {
  const result = await requireUser(request, env)
  if (result.response || !result.user) return result
  if (result.user.role !== 'admin') {
    return {
      user: null,
      response: json({ ok: false, error: 'Administrator access is required.' }, 403),
    }
  }
  return result
}

export async function canViewProject(user: AuthUser, projectId: string, env: Env) {
  if (user.role === 'admin') return true

  const row = await env.DB
    .prepare(`
      SELECT p.id
      FROM projects p
      LEFT JOIN project_permissions pp
        ON pp.project_id = p.id
       AND pp.user_id = ?
       AND pp.can_view = 1
      LEFT JOIN farm_memberships fm
        ON fm.farm_id = p.farm_id
       AND fm.user_id = ?
       AND fm.active = 1
      WHERE p.id = ?
        AND (pp.project_id IS NOT NULL OR fm.user_id IS NOT NULL)
    `)
    .bind(user.id, user.id, projectId)
    .first()

  return Boolean(row)
}

export async function ensureAdminFromEnvironment(
  email: string,
  password: string,
  env: Env,
): Promise<AuthUser | null> {
  const adminEmail = normalizeEmail(env.ADMIN_EMAIL)
  const adminPassword = String(env.ADMIN_PASSWORD ?? '')
  if (!adminEmail || !adminPassword || email !== adminEmail || password !== adminPassword) {
    return null
  }

  const existing = await env.DB
    .prepare('SELECT id, email, name, role, active FROM users WHERE email = ?')
    .bind(adminEmail)
    .first<Record<string, unknown>>()

  if (existing) {
    if (existing.role !== 'admin' || !Boolean(existing.active)) {
      await env.DB
        .prepare('UPDATE users SET role = ?, active = 1, updated_at = ? WHERE id = ?')
        .bind('admin', new Date().toISOString(), String(existing.id))
        .run()
    }

    return {
      id: String(existing.id),
      email: String(existing.email),
      name: String(existing.name ?? 'Administrator'),
      role: 'admin',
      active: true,
    }
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(password)

  await env.DB
    .prepare(`
      INSERT INTO users (id, email, name, password_hash, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)
    `)
    .bind(id, adminEmail, 'Administrator', passwordHash, now, now)
    .run()

  return {
    id,
    email: adminEmail,
    name: 'Administrator',
    role: 'admin',
    active: true,
  }
}
