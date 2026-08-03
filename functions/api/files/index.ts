import { json, requireAdmin, type Env } from '../../lib/auth'

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-160) || 'upload.bin'
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response) return auth.response

  const result = await env.DB
    .prepare(`
      SELECT id, original_name, content_type, size_bytes, uploaded_by, created_at
      FROM files
      ORDER BY created_at DESC
    `)
    .all()

  return json({ ok: true, files: result.results ?? [] })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireAdmin(request, env)
  if (auth.response || !auth.user) return auth.response

  try {
    const formData = await request.formData()
    const value = formData.get('file')
    if (!(value instanceof File)) {
      return json({ ok: false, error: 'File is required.' }, 400)
    }

    const id = crypto.randomUUID()
    const name = value.name || 'upload.bin'
    const r2Key = `uploads/${auth.user.id}/${id}-${safeFileName(name)}`
    const createdAt = new Date().toISOString()

    await env.FILES.put(r2Key, value.stream(), {
      httpMetadata: {
        contentType: value.type || 'application/octet-stream',
      },
      customMetadata: {
        originalName: name,
        uploadedBy: auth.user.id,
      },
    })

    await env.DB
      .prepare(`
        INSERT INTO files (
          id, r2_key, original_name, content_type, size_bytes, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        r2Key,
        name,
        value.type || 'application/octet-stream',
        value.size,
        auth.user.id,
        createdAt,
      )
      .run()

    return json({
      ok: true,
      file: {
        id,
        originalName: name,
        contentType: value.type || 'application/octet-stream',
        sizeBytes: value.size,
        createdAt,
      },
    }, 201)
  } catch (error) {
    console.error('Upload failed', error)
    return json({ ok: false, error: 'Failed to upload file.' }, 500)
  }
}
