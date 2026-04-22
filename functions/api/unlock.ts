type Env = {
  APP_UNLOCK_CODE: string
  DB: D1Database
  FILES: R2Bucket
}

type UnlockBody = {
  code?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as UnlockBody
    const code = String(body.code ?? '').trim()

    if (!code) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Code is required.' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    if (code !== env.APP_UNLOCK_CODE) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Invalid code.' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    const sessionId = crypto.randomUUID()
    const createdAt = new Date().toISOString()

    await env.DB
      .prepare('INSERT INTO sessions (id, created_at) VALUES (?, ?)')
      .bind(sessionId, createdAt)
      .run()

    return new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': `cyberfarm_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
        },
      },
    )
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Unlock failed.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}