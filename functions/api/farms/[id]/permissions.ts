import { getFarmZones } from '../../../lib/access'
import { json, type Env } from '../../../lib/auth'
import { requireFarm } from '../../../lib/farms'

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const farmId = String(params.id)
  const access = await requireFarm(request, env, farmId)
  if (access.response || !access.user || !access.role) return access.response

  const zones = await getFarmZones(access.user, farmId, env)
  return json({ ok: true, role: access.role, zones })
}
