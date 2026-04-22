type Env = {
  APP_UNLOCK_CODE: string
  DB: D1Database
  FILES: R2Bucket
}

type UpdateProjectBody = {
  name?: string
  fileName?: string
  projectData?: unknown
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id)

  const row = await env.DB
    .prepare(`
      SELECT id, name, file_name, created_at, updated_at, project_json
      FROM projects
      WHERE id = ?
    `)
    .bind(id)
    .first()

  if (!row) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Project not found.' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  let projectData = null
  try {
    projectData = row.project_json ? JSON.parse(String(row.project_json)) : null
  } catch {
    projectData = null
  }

  return new Response(
    JSON.stringify({
      ok: true,
      project: {
        id: row.id,
        name: row.name,
        fileName: row.file_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        projectData,
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    const id = String(params.id)
    const body = (await request.json()) as UpdateProjectBody
    const now = new Date().toISOString()
    const name = String(body.name ?? 'Untitled Project').trim() || 'Untitled Project'
    const fileName = String(body.fileName ?? '').trim() || null
    const projectData = body.projectData ?? null

    const existing = await env.DB
      .prepare('SELECT id FROM projects WHERE id = ?')
      .bind(id)
      .first()

    if (!existing) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Project not found.' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    await env.DB
      .prepare(`
        UPDATE projects
        SET name = ?, file_name = ?, updated_at = ?, project_json = ?
        WHERE id = ?
      `)
      .bind(
        name,
        fileName,
        now,
        JSON.stringify(projectData),
        id,
      )
      .run()

    return new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Failed to update project.' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}