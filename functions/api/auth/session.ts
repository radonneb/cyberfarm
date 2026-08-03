import { getSessionUser, json, type Env } from '../../lib/auth'

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env)
  return json({ ok: true, authenticated: Boolean(user), user })
}
