import { destroySession, json, type Env } from '../../lib/auth'

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const cookie = await destroySession(request, env)
  return json({ ok: true }, 200, { 'Set-Cookie': cookie })
}
