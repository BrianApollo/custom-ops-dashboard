import { settings } from '../env'
import { ApiError } from '../lib/errors'

// fal.ai's queue: a request is submitted, its status polled, its result read.
// The status and result addresses come back from the submit call.

// The dashboard's model choice -> fal's Nano Banana image-edit endpoints
export const FAL_MODELS: Record<string, string> = {
  'nanobanana-1': 'fal-ai/nano-banana/edit',
  'nanobanana-2': 'fal-ai/nano-banana-pro/edit',
}

export interface FalRequest {
  requestId: string
  statusUrl: string
  responseUrl: string
}

async function fal(url: string, init: RequestInit = {}) {
  const key = settings.FAL_KEY
  if (!key) throw new ApiError(503, 'not_configured', 'FAL_KEY is not set on the server')
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json', ...init.headers },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`fal answered ${response.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

// Below this many USD a job is refused before it starts (FAL_MIN_BALANCE_USD, default 5)
export const minBalance = () => {
  const value = Number(settings.FAL_MIN_BALANCE_USD ?? 5)
  return Number.isFinite(value) && value >= 0 ? value : 5
}

export interface FalBalance {
  balance: number
  currency: string
}

const BALANCE_CACHE_MS = 30_000
let balanceCache: { until: number; value: FalBalance } | undefined

// fal's credit balance. Reading it needs a key with billing access
// (FAL_ADMIN_KEY; FAL_KEY when that is an admin key too).
export async function falBalance(): Promise<FalBalance> {
  if (balanceCache && balanceCache.until > Date.now()) return balanceCache.value
  const key = settings.FAL_ADMIN_KEY || settings.FAL_KEY
  if (!key) throw new ApiError(503, 'not_configured', 'FAL_ADMIN_KEY is not set on the server')

  const response = await fetch('https://api.fal.ai/v1/account/billing?expand=credits', {
    headers: { Authorization: `Key ${key}` },
  })
  const body = (await response.json().catch(() => null)) as {
    credits?: { current_balance?: unknown; currency?: unknown }
    error?: { message?: string }
  } | null
  const balance = body?.credits?.current_balance
  if (!response.ok || typeof balance !== 'number') {
    const reason = body?.error?.message ?? `fal answered ${response.status}`
    throw new ApiError(502, 'fal_balance_unavailable', `Could not read the fal.ai credit balance: ${reason}`)
  }
  const value = { balance, currency: typeof body?.credits?.currency === 'string' ? body.credits.currency : 'USD' }
  balanceCache = { until: Date.now() + BALANCE_CACHE_MS, value }
  return value
}

export async function submitImage(input: {
  model: string
  prompt: string
  imageUrls: string[]
  aspectRatio: string
  outputFormat: string
}): Promise<FalRequest> {
  const body = await fal(`https://queue.fal.run/${input.model}`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt,
      image_urls: input.imageUrls,
      aspect_ratio: input.aspectRatio,
      output_format: input.outputFormat,
      num_images: 1,
    }),
  })
  if (!body.request_id) throw new Error(`fal accepted no request: ${JSON.stringify(body).slice(0, 500)}`)
  return { requestId: body.request_id, statusUrl: body.status_url, responseUrl: body.response_url }
}

// The image's fal-hosted URL once it is ready, or null while fal is still working
export async function imageResult(request: FalRequest): Promise<string | null> {
  const status = await fal(request.statusUrl)
  if (status.status !== 'COMPLETED') return null
  const result = await fal(request.responseUrl)
  const url = result.images?.[0]?.url
  if (!url) throw new Error(`fal finished without an image: ${JSON.stringify(result).slice(0, 500)}`)
  return url as string
}
