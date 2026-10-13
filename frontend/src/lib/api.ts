export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// The session travels in an HttpOnly cookie on the same origin, so no token is kept here
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method: init?.method,
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? 'unknown', body?.error?.message ?? `Request failed (${res.status})`)
  }
  return body as T
}

export interface User {
  id: string
  email: string | null
  role: string
}

export interface ApiRecord {
  id: string
  createdTime: string
  updatedTime: string
  fields: Record<string, unknown>
}

export interface Attachment {
  id: string
  filename: string
  url: string
  size: number
  type: string
}

export interface Counts {
  total: Record<string, number>
  byProduct: Record<string, Record<string, number>>
}

export interface Bootstrap {
  user: User
  products: ApiRecord[]
  users: ApiRecord[]
  counts: Counts
}

// a text field as a string, '' when the record has no value for it
export const text = (record: ApiRecord, field: string) => {
  const value = record.fields[field]
  return value === undefined || value === null ? '' : String(value)
}
