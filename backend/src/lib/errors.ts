import type { ErrorRequestHandler } from 'express'

export class ApiError extends Error {
  status: number
  code: string
  field: string | null
  // further keys for the error object, such as Facebook's own error under `facebook`
  extra: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    field: string | null = null,
    extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.status = status
    this.code = code
    this.field = field
    this.extra = extra
  }
}

export const badRequest = (message: string, field: string | null = null) =>
  new ApiError(400, 'bad_request', message, field)
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Not logged in')
export const forbidden = (message = 'Not allowed', field: string | null = null) =>
  new ApiError(403, 'forbidden', message, field)
// the current frontend looks for the text `404` in not-found messages
export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found (404)`)
export const conflict = (message: string) => new ApiError(409, 'conflict', message)
export const invalid = (message: string, field: string | null = null) =>
  new ApiError(422, 'validation_failed', message, field)

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let error: ApiError
  if (err instanceof ApiError) {
    error = err
  } else if (err?.type === 'entity.parse.failed') {
    error = badRequest('Request body is not valid JSON')
  } else if (err?.type === 'entity.too.large') {
    error = new ApiError(413, 'too_large', 'Request body is too large')
  } else if (/FOREIGN KEY constraint failed/.test(String(err?.message))) {
    error = invalid('A linked record does not exist')
  } else {
    console.error(err)
    error = new ApiError(500, 'internal_error', 'Something went wrong')
  }
  res
    .status(error.status)
    .json({ error: { code: error.code, message: error.message, field: error.field, ...error.extra } })
}
