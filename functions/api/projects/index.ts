type Env = {
  APP_UNLOCK_CODE: string
  DB: D1Database
  FILES: R2Bucket
}

type CreateProjectBody = {
  name?: string
  fileName?: string
  projectData?: unknown
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const result = await env.DB
    .prepare(`
      SELECT id, name, file_name, created_at, updated_at
      FROM projects
      ORDER BY updated_at DESC
    `)
    .all()

  return new Response(
    JSON.stringify({
      ok: true,
      projects: result.results ?? [],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const body = (await request.json()) as CreateProjectBody
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const name = String(body.name ?? 'Untitled Project').trim() || 'Untitled Project'
    const fileName = String(body.fileName ?? '').trim() || null
    const projectData = body.projectData ?? null

    await env.DB
      .prepare(`
        INSERT INTO projects (id, name, file_name, created_at, updated_at, project_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        name,
        fileName,
        now,
        now,
        JSON.stringify(projectData),
      )
      .run()

    return new Response(
      JSON.stringify({
        ok: true,
        id,
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Failed to create project.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}