export type ApiErrorPayload = {
  error?: string
  code?: string
  [key: string]: unknown
}

export class ApiError extends Error {
  status: number
  code?: string
  payload: ApiErrorPayload | null

  constructor(message: string, status: number, payload: ApiErrorPayload | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = payload?.code
    this.payload = payload
  }
}

const RETRYABLE_READ_STATUSES = new Set([502, 503, 504])

function pause(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = String(init?.method ?? 'GET').toUpperCase()
  const canRetry = method === 'GET' || method === 'HEAD'
  let response: Response | null = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(path, {
        credentials: 'include',
        ...init,
        headers: {
          ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(init?.headers ?? {}),
        },
      })
    } catch (error) {
      if (!canRetry || attempt === 2) throw error
      await pause(250 * (2 ** attempt))
      continue
    }

    if (!canRetry || !RETRYABLE_READ_STATUSES.has(response.status) || attempt === 2) break
    await pause(250 * (2 ** attempt))
  }

  if (!response) throw new Error('The request could not be started.')

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null
    const fallback = response.status === 503
      ? 'Cloud storage is temporarily unavailable (503). Your local map was kept. Use Sync to retry.'
      : `Request failed (${response.status})`
    throw new ApiError(errorPayload?.error || fallback, response.status, errorPayload)
  }

  return payload as T
}
