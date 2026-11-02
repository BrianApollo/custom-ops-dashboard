import { Buffer } from 'node:buffer'
import { settings } from '../env'
import { ApiError } from './errors'

// The one place the backend talks to Facebook. Every call goes out with the
// fixed API version and an appsecret_proof, POSTs are form-encoded, lists are
// read to the last page, and Facebook's errors become ours.

type Params = Record<string, unknown>
export type FbObject = Record<string, any>

// tests point this at a stand-in server; it is not set anywhere else
const graph = () => settings.FACEBOOK_GRAPH_URL ?? 'https://graph.facebook.com'
const MAX_PARALLEL = 5
const MAX_PAGES = 100

export const TOKEN_INVALID = 'facebook_token_invalid'

function app() {
  const { FACEBOOK_APP_ID: id, FACEBOOK_APP_SECRET: secret } = settings
  if (!id || !secret) throw new ApiError(503, 'not_configured', 'The Facebook app is not set on the server')
  return { id, secret, version: settings.FACEBOOK_API_VERSION ?? 'v21.0' }
}

export const facebookConfig = () => ({
  appId: app().id,
  apiVersion: app().version,
  // null when the system user login is not set up for this app
  systemUserConfigId: settings.FACEBOOK_SYSTEM_USER_CONFIG_ID || null,
})

async function proof(token: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))).toString('hex')
}

// nested values travel as JSON strings, the way Facebook expects in a form body
function encode(params: Params) {
  const out = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    out.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value))
  }
  return out
}

// Facebook reports failure in the body, whatever the HTTP status says
function failure(error: FbObject) {
  const facebook = {
    type: error.type,
    code: error.code,
    error_subcode: error.error_subcode,
    fbtrace_id: error.fbtrace_id,
  }
  const message = String(error.error_user_msg ?? error.message ?? 'Facebook rejected the request')
  // 190: the token expired or was revoked
  return error.code === 190
    ? new ApiError(409, TOKEN_INVALID, message, null, { facebook })
    : new ApiError(502, 'facebook_error', message, null, { facebook })
}

async function send(url: string, init?: RequestInit) {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new ApiError(502, 'facebook_error', 'Facebook could not be reached')
  }
  const body = (await response.json().catch(() => null)) as FbObject | null
  if (!body) throw new ApiError(502, 'facebook_error', `Facebook answered ${response.status} with no data`)
  if (body.error) throw failure(body.error)
  return { body, response }
}

// Calls made as the app itself, with no user token: token exchange and inspection
export async function exchangeToken(shortLived: string) {
  const { id, secret, version } = app()
  const query = encode({ grant_type: 'fb_exchange_token', client_id: id, client_secret: secret, fb_exchange_token: shortLived })
  const { body } = await send(`${graph()}/${version}/oauth/access_token?${query}`)
  // Facebook leaves expires_in out for some tokens; 60 days is what they last
  return { token: body.access_token as string, expiresIn: (body.expires_in as number | undefined) ?? 5_184_000 }
}

// The code a Facebook Login for Business popup hands back, for the token it
// stands for. With a system-user configuration that is the business's system
// user token; Facebook sets no expiry on it unless the configuration says so.
export async function exchangeCode(code: string) {
  const { id, secret, version } = app()
  const query = encode({ client_id: id, client_secret: secret, code })
  const { body } = await send(`${graph()}/${version}/oauth/access_token?${query}`)
  if (typeof body.access_token !== 'string') throw new ApiError(502, 'facebook_error', 'Facebook answered the login code with no token')
  return { token: body.access_token as string, expiresIn: (body.expires_in as number | undefined) ?? null }
}

export async function inspectToken(token: string) {
  const { id, secret, version } = app()
  const query = encode({ input_token: token, access_token: `${id}|${secret}` })
  const { body } = await send(`${graph()}/${version}/debug_token?${query}`)
  const data = (body.data ?? {}) as FbObject
  return {
    isValid: data.is_valid === true,
    // Unix seconds; 0 or missing means no expiry
    expiresAt: (data.expires_at as number | undefined) || null,
    dataAccessExpiresAt: (data.data_access_expires_at as number | undefined) || null,
    scopes: (data.scopes as string[] | undefined) ?? [],
    // each permission with the ids it was granted for, when Facebook narrows it
    granularScopes: (data.granular_scopes as { scope: string; target_ids?: string[] }[] | undefined) ?? [],
    userId: (data.user_id as string | undefined) ?? null,
    type: (data.type as string | undefined) ?? null,
  }
}

export interface BatchItem {
  method: 'GET' | 'POST'
  relative_url: string
  body?: string
}

export class FacebookClient {
  // highest of Facebook's three usage percentages seen on this client's calls
  rate = 0
  private running = 0
  private waiting: (() => void)[] = []
  private signature: Promise<string> | undefined

  constructor(private token: string) {}

  // at most five calls in flight for one token
  private async slot<T>(work: () => Promise<T>) {
    if (this.running >= MAX_PARALLEL) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.running++
    try {
      return await work()
    } finally {
      this.running--
      this.waiting.shift()?.()
    }
  }

  private async call(method: 'GET' | 'POST', path: string, params: Params) {
    const { secret, version } = app()
    const signed = encode({
      ...params,
      access_token: this.token,
      appsecret_proof: await (this.signature ??= proof(this.token, secret)),
    })
    const url = `${graph()}/${version}/${path.replace(/^\//, '')}`
    const { body, response } = await this.slot(() =>
      method === 'GET' ? send(`${url}?${signed}`) : send(url, { method: 'POST', body: signed }),
    )
    try {
      const usage = JSON.parse(response.headers.get('x-app-usage') ?? '{}') as Record<string, number>
      this.rate = Math.max(this.rate, usage.call_count ?? 0, usage.total_cputime ?? 0, usage.total_time ?? 0)
    } catch {
      // the header is advisory
    }
    return body
  }

  get = (path: string, params: Params = {}) => this.call('GET', path, params)
  post = (path: string, params: Params = {}) => this.call('POST', path, params)

  // every item of a list, following the cursor to the end
  async list(path: string, params: Params = {}) {
    const items: FbObject[] = []
    let after: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.get(path, after ? { ...params, after } : params)
      items.push(...((body.data as FbObject[] | undefined) ?? []))
      after = body.paging?.next ? body.paging.cursors?.after : undefined
      if (!after) break
    }
    return items
  }

  // Up to 50 calls in one request. Each result is that call's own outcome:
  // its parsed body, or the error Facebook gave for it.
  async batch(items: BatchItem[]) {
    const results = (await this.post('', { batch: items })) as unknown as ({ code: number; body: string } | null)[]
    return results.map((result) => {
      let body: FbObject | null = null
      try {
        body = result ? (JSON.parse(result.body) as FbObject) : null
      } catch {
        // left as null
      }
      const error = !body ? 'Facebook returned no result' : body.error ? String(body.error.error_user_msg ?? body.error.message) : null
      return { body: error ? null : body, error }
    })
  }
}

// accept `act_123` or `123`; `id` is the form Facebook's paths take
export function adAccount(input: string) {
  const accountId = input.replace(/^act_/, '')
  if (!/^\d+$/.test(accountId)) throw new ApiError(422, 'validation_failed', 'Not an ad account id', 'adAccountId')
  return { id: `act_${accountId}`, accountId }
}

export function graphId(input: unknown, name: string) {
  if (typeof input !== 'string' || !/^\d+$/.test(input)) throw new ApiError(422, 'validation_failed', `${name} is not a Facebook id`, name)
  return input
}
