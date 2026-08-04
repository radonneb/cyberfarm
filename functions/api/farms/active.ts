import { json, requireUser, type Env } from '../../lib/auth'
import { getActiveFarm, setActiveFarm } from '../../lib/farms'

type ActiveFarmBody = { farmId?: string }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response
  return json({ ok: true, farm: await getActiveFarm(auth.user, env) })
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireUser(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const body = (await request.json()) as ActiveFarmBody
    const farmId = String(body.farmId ?? '').trim()
    if (!farmId) return json({ ok: false, error: 'Farm id is required.' }, 400)

    const farm = await setActiveFarm(auth.user, farmId, env)
    if (!farm) return json({ ok: false, error: 'Farm not found.' }, 404)
    return json({ ok: true, farm })
  } catch (error) {
    console.error('Switch farm failed', error)
    return json({ ok: false, error: 'Unable to switch farm.' }, 500)
  }
}
