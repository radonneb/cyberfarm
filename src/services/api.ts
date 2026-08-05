export type ApiErrorPayload = {
  error?: string
  code?: string
}

export class ApiError extends Error {
  status: number
  code: string | null

  constructor(message: string, status: number, code?: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code ?? null
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method ?? 'GET').toUpperCase()
  const retryable = method === 'GET' || method === 'HEAD'
  const attempts = retryable ? 3 : 1
  let lastError: ApiError | null = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response
    try {
      response = await fetch(path, {
        credentials: 'include',
        ...init,
        headers: {
          ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(init?.headers ?? {}),
        },
      })
    } catch {
      lastError = new ApiError('The cloud connection was interrupted. Press Sync now.', 0, 'NETWORK_ERROR')
      if (attempt < attempts - 1) { await wait(250 * (attempt + 1)); continue }
      throw lastError
    }

    let payload: unknown = null
    try { payload = await response.json() } catch { payload = null }
    if (response.ok) return payload as T

    const errorPayload = payload as ApiErrorPayload | null
    const temporary = response.status === 502 || response.status === 503 || response.status === 504
    const message = errorPayload?.error || (temporary
      ? 'Cloudflare is temporarily unavailable. No data was deleted; press Sync now in a few seconds.'
      : `Request failed (${response.status})`)
    lastError = new ApiError(message, response.status, errorPayload?.code)
    if (temporary && attempt < attempts - 1) {
      await wait(300 * (attempt + 1))
      continue
    }
    throw lastError
  }

  throw lastError ?? new ApiError('Request failed.', 0)
}
