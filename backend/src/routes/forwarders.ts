import { Router, type Response } from 'express'
import { currentUser } from '../auth/session'
import { settings } from '../env'
import { IN_LIST, list, rows, sql } from '../lib/d1'
import { presetRange, RANGE_PRESETS } from '../lib/dates'
import { ApiError, forbidden, invalid, notFound } from '../lib/errors'
import { isAdmin, ruleFor } from '../permissions'

// Calls to outside services whose keys and URLs must stay on the server
export const forwardersRouter = Router()

const notConfigured = (name: string) => new ApiError(503, 'not_configured', `${name} is not set on the server`)

async function relay(res: Response, upstream: globalThis.Response) {
  res.status(upstream.status)
  res.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json')
  res.send(await upstream.text())
}

// Starts an image-generation job. The body is passed on unchanged; its `model`
// picks the webhook. The job later creates Temp Images rows by itself.
forwardersRouter.post('/image-generation', async (req, res) => {
  if (!ruleFor(currentUser(res).role, 'temp_images').create) throw forbidden()

  const v2 = String(req.body?.model ?? '').toLowerCase() === 'nanobanana-2'
  const name = v2 ? 'IMAGE_GENERATION_V2_WEBHOOK_URL' : 'IMAGE_GENERATION_WEBHOOK_URL'
  const url = settings[name]
  if (!url) throw notConfigured(name)

  await relay(
    res,
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    }),
  )
})

const REDTRACK = 'https://api.redtrack.io'

// The only RedTrack calls the dashboard makes; anything else is refused
const REDTRACK_ROUTES: [methods: string[], path: RegExp][] = [
  [['GET', 'POST'], /^(v1\/)?campaigns$/],
  [['GET', 'PUT'], /^campaigns\/[^/]+$/],
  [['GET'], /^campaigns\/[^/]+\/(tracking|stats)$/],
  [['POST'], /^campaigns\/[^/]+\/integrations\/facebook$/],
  [['POST'], /^streams$/],
  [['GET'], /^(landings|offers)\/[^/]+$/],
  [['GET'], /^report$/],
]

// Reports and the campaign list are slow and asked for repeatedly
const CACHED = /^(report|campaigns)$/
const CACHE_MS = 60_000
const CACHE_MAX = 200
const cache = new Map<string, { until: number; type: string; body: string }>()

forwardersRouter.all('/redtrack/*path', async (req, res) => {
  if (!isAdmin(currentUser(res).role)) throw forbidden()
  const key = settings.REDTRACK_API_KEY
  if (!key) throw notConfigured('REDTRACK_API_KEY')

  const path = (req.params.path as unknown as string[]).join('/')
  if (!REDTRACK_ROUTES.some(([methods, pattern]) => methods.includes(req.method) && pattern.test(path))) {
    throw notFound(`RedTrack route ${req.method} /${path}`)
  }

  const query = new URLSearchParams(req.originalUrl.split('?')[1] ?? '')
  // the client never supplies the key
  query.delete('api_key')
  const cacheKey = req.method === 'GET' && CACHED.test(path) ? `${path}?${query}` : null
  const hit = cacheKey ? cache.get(cacheKey) : undefined
  if (hit && hit.until > Date.now()) {
    res.set('Content-Type', hit.type).send(hit.body)
    return
  }

  const headers: Record<string, string> = {}
  if (req.get('X-Redtrack-Auth-Mode') === 'bearer') headers.Authorization = `Bearer ${key}`
  else query.set('api_key', key)
  const hasBody = req.method !== 'GET' && req.body !== undefined
  if (hasBody) headers['Content-Type'] = 'application/json'

  const upstream = await fetch(`${REDTRACK}/${path}?${query}`, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body) : undefined,
  })
  const type = upstream.headers.get('Content-Type') ?? 'application/json'
  const body = await upstream.text()
  if (cacheKey && upstream.ok) {
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(cacheKey, { until: Date.now() + CACHE_MS, type, body })
  }
  res.status(upstream.status).set('Content-Type', type).send(body)
})

const ROAS_CHUNK = 50
const REDTRACK_ID = /^[0-9a-f]{24}$/i
// roas per RedTrack campaign and date range; null means RedTrack had no figure
const roasCache = new Map<string, { until: number; roas: number | null }>()

// The ROAS column of the Manage page: maps Facebook campaigns to their
// RedTrack campaigns and asks RedTrack for the figures, in one request.
//
// POST /manage/roas { fbCampaignIds, datePreset } or { fbCampaignIds, dateFrom, dateTo }
forwardersRouter.post('/manage/roas', async (req, res) => {
  if (!isAdmin(currentUser(res).role)) throw forbidden()
  const key = settings.REDTRACK_API_KEY
  if (!key) throw notConfigured('REDTRACK_API_KEY')

  const { fbCampaignIds, datePreset, dateFrom, dateTo } = req.body ?? {}
  if (!Array.isArray(fbCampaignIds) || fbCampaignIds.length > 1000 || fbCampaignIds.some((id) => typeof id !== 'string')) {
    throw invalid('fbCampaignIds must be a list of up to 1000 ids', 'fbCampaignIds')
  }
  const timeZone = settings.TEAM_TIME_ZONE ?? 'Asia/Bangkok'
  let range: { dateFrom: string; dateTo: string }
  if (datePreset !== undefined) {
    if (!RANGE_PRESETS.includes(datePreset)) throw invalid(`datePreset must be one of: ${RANGE_PRESETS.join(', ')}`, 'datePreset')
    range = presetRange(datePreset, timeZone)
  } else {
    const isDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    if (!isDate(dateFrom) || !isDate(dateTo) || dateFrom > dateTo) {
      throw invalid('Give datePreset, or dateFrom and dateTo as YYYY-MM-DD', 'dateFrom')
    }
    range = { dateFrom, dateTo }
  }

  // when two campaigns carry the same Facebook id, the most recently created one counts
  const wanted = [...new Set(fbCampaignIds as string[])]
  const linked = new Map<string, string | null>()
  const found = await rows(
    sql(
      `SELECT fb_campaign_id AS fb, redtrack_campaign_id AS rt FROM campaigns
       WHERE fb_campaign_id IN ${IN_LIST} ORDER BY created_at DESC, id DESC`,
      list(wanted),
    ),
  )
  for (const row of found) {
    if (linked.has(row.fb as string)) console.warn(`More than one campaign has FB Campaign ID ${row.fb}; using the newest`)
    else linked.set(row.fb as string, (row.rt as string | null) || null)
  }

  // RedTrack ignores an `ids` filter it cannot read and answers with every
  // campaign, so only well-formed ids are sent and the answer is matched by id
  const stamp = `${range.dateFrom}:${range.dateTo}`
  const roas = new Map<string, number | null>()
  const toFetch: string[] = []
  for (const id of new Set([...linked.values()].filter((id): id is string => Boolean(id)))) {
    const hit = roasCache.get(`${id}:${stamp}`)
    if (hit && hit.until > Date.now()) roas.set(id, hit.roas)
    else if (REDTRACK_ID.test(id)) toFetch.push(id)
  }

  for (let i = 0; i < toFetch.length; i += ROAS_CHUNK) {
    const chunk = toFetch.slice(i, i + ROAS_CHUNK)
    const query = new URLSearchParams({
      ids: chunk.join(','),
      date_from: range.dateFrom,
      date_to: range.dateTo,
      total_stat: 'true',
      // the days are the team's days, whatever time zone the RedTrack account is set to
      timezone: timeZone,
      api_key: key,
    })
    const upstream = await fetch(`${REDTRACK}/campaigns?${query}`).catch(() => null)
    const body: unknown = upstream ? await upstream.json().catch(() => null) : null
    if (!upstream?.ok || !Array.isArray(body)) {
      const message = String((body as { error?: unknown } | null)?.error ?? 'RedTrack did not answer with campaign data')
      throw new ApiError(502, 'redtrack_error', `RedTrack: ${message}`, null, {
        redtrack: { status: upstream?.status ?? null, message },
      })
    }
    const byId = new Map(body.map((campaign: { id: string; stat?: { roas?: unknown } }) => [campaign.id, campaign]))
    if (roasCache.size > 5000) roasCache.clear()
    for (const id of chunk) {
      const value = byId.get(id)?.stat?.roas
      const figure = typeof value === 'number' ? value : null
      roas.set(id, figure)
      roasCache.set(`${id}:${stamp}`, { until: Date.now() + CACHE_MS, roas: figure })
    }
  }

  res.json({
    ...range,
    timeZone,
    results: wanted.flatMap((fb) => {
      const rt = linked.get(fb)
      return rt ? [{ fbCampaignId: fb, redtrackCampaignId: rt, roas: roas.get(rt) ?? null }] : []
    }),
    unlinked: wanted.filter((fb) => !linked.get(fb)),
  })
})
