import { Router } from 'express'
import { currentUser } from '../auth/session'
import { settings } from '../env'
import { rows, sql } from '../lib/d1'
import { ApiError, forbidden, invalid, notFound } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { publicUrl } from '../lib/storage'
import { ruleFor } from '../permissions'
import { FAL_MODELS, falBalance, minBalance } from './fal'
import { DEFAULT_CLAUDE_INSTRUCTION, DEFAULT_GPT_INSTRUCTION } from './prompts'
import type { ImageJob } from './workflow'

export const generationRouter = Router()

const MAX_IMAGES = 20
const ASPECT_RATIOS = ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16']
const FORMATS: Record<string, string> = { png: 'png', jpeg: 'jpeg', jpg: 'jpeg' }

const optionalText = (value: unknown, field: string) => {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw invalid(`${field} must be text`, field)
  return value.trim()
}

// fal.ai's credit balance and whether it is under the threshold jobs need.
//
// GET /image-generation/balance -> { balance, currency, minimum, low }
generationRouter.get('/image-generation/balance', async (req, res) => {
  if (!ruleFor(currentUser(res).role, 'temp_images').create) throw forbidden()
  const { balance, currency } = await falBalance()
  const minimum = minBalance()
  res.json({ balance, currency, minimum, low: balance < minimum })
})

// Starts an image-generation job for one product. It runs in the background
// and adds each finished image as a Temp Images row (New on the Images page).
// The product's logo is the reference image. Instructions are optional; the
// standing ones are used when left out. A job is refused while fal.ai's
// credit balance is under FAL_MIN_BALANCE_USD.
//
// POST /image-generation { model, advertorial, image_count, image_size, output_format,
//                          product_id, gpt_instruction?, claude_instruction? } -> 202 { jobId, balanceCheck }
generationRouter.post('/image-generation', async (req, res) => {
  if (!ruleFor(currentUser(res).role, 'temp_images').create) throw forbidden()
  const body = req.body ?? {}

  const falModel = FAL_MODELS[String(body.model ?? '').toLowerCase()]
  if (!falModel) throw invalid(`model must be one of: ${Object.keys(FAL_MODELS).join(', ')}`, 'model')
  if (typeof body.advertorial !== 'string' || !body.advertorial.trim()) throw invalid('advertorial is required', 'advertorial')
  const count = Number(body.image_count)
  if (!Number.isInteger(count) || count < 1 || count > MAX_IMAGES) {
    throw invalid(`image_count must be a whole number from 1 to ${MAX_IMAGES}`, 'image_count')
  }
  const aspectRatio = String(body.image_size ?? '1:1').toLowerCase()
  if (!ASPECT_RATIOS.includes(aspectRatio)) throw invalid(`image_size must be one of: ${ASPECT_RATIOS.join(', ')}`, 'image_size')
  const outputFormat = FORMATS[String(body.output_format ?? 'png').toLowerCase()]
  if (!outputFormat) throw invalid(`output_format must be one of: ${Object.keys(FORMATS).join(', ')}`, 'output_format')
  const productId = body.product_id
  if (typeof productId !== 'string' || !RECORD_ID.test(productId)) throw invalid('product_id must be a record id', 'product_id')

  const [product] = await rows(
    sql(
      `SELECT p.product_name,
              (SELECT a.r2_key FROM attachments a
               WHERE a.table_name = 'products' AND a.record_id = p.id AND a.field_name = 'product_logo'
               ORDER BY a.position LIMIT 1) AS logo_key
       FROM products p WHERE p.id = ?`,
      productId,
    ),
  )
  if (!product) throw notFound(`Product ${productId}`)
  // the product name is the folder the images are stored in
  if (!product.product_name) throw invalid('The product has no name', 'product_id')
  if (!product.logo_key) throw invalid('The product has no Product Logo to use as the reference image', 'product_id')

  // checked last, so a request with bad fields is not slowed by the call to fal.
  // A balance that cannot be read (wrong key, fal down) does not stop the job;
  // the answer says the check was skipped and why.
  let balanceCheck = 'passed'
  const minimum = minBalance()
  const { balance, currency } = await falBalance().catch((error: Error) => {
    console.warn('[generation] fal balance check skipped:', error.message)
    balanceCheck = `skipped: ${error.message}`
    return { balance: Infinity, currency: 'USD' }
  })
  if (balance < minimum) {
    throw new ApiError(
      402,
      'fal_low_balance',
      `fal.ai credits are low: ${balance.toFixed(2)} ${currency} left, at least ${minimum.toFixed(2)} is needed. Top up at https://fal.ai/dashboard/billing`,
      null,
      { balance, currency, minimum },
    )
  }

  const job: ImageJob = {
    productId,
    productName: product.product_name as string,
    advertorial: body.advertorial.trim(),
    gptInstruction: optionalText(body.gpt_instruction, 'gpt_instruction') || DEFAULT_GPT_INSTRUCTION,
    claudeInstruction: optionalText(body.claude_instruction, 'claude_instruction') || DEFAULT_CLAUDE_INSTRUCTION,
    count,
    falModel,
    imageUrls: [publicUrl(product.logo_key as string)],
    aspectRatio,
    outputFormat,
  }
  const instance = await settings.IMAGE_GENERATION.create({ params: job })
  res.status(202).json({ jobId: instance.id, balanceCheck })
})

// GET /image-generation/{jobId} -> the job's progress, as Cloudflare Workflows reports it:
// { status: queued | running | complete | errored | ..., output: { saved, failed }, error }
generationRouter.get('/image-generation/:jobId', async (req, res) => {
  if (!ruleFor(currentUser(res).role, 'temp_images').read) throw forbidden()
  const instance = await settings.IMAGE_GENERATION.get(req.params.jobId).catch(() => null)
  if (!instance) throw notFound(`Image-generation job ${req.params.jobId}`)
  const { status, output, error } = await instance.status()
  res.json({ status, output: output ?? null, error: error ?? null })
})
