import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers'
import { settings } from '../env'
import { nowIso, sql } from '../lib/d1'
import { recordId } from '../lib/ids'
import { publicUrl } from '../lib/storage'
import { imageResult, submitImage } from './fal'
import { PROMPT_BATCH_SIZE, writePromptBatch, type PromptPair } from './prompts'

// One image-generation job, run by Cloudflare Workflows so it outlives the
// request that started it:
//   advertorial -> GPT prompts -> Claude refinement (in batches)
//   -> per prompt: fal Nano Banana image -> R2 ({product}/Images/{id}) -> a Temp Images row
// Each step's result is saved, so a retry never repeats a finished step and
// one failed image does not stop the others.

export interface ImageJob {
  productId: string
  productName: string
  advertorial: string
  gptInstruction: string
  claudeInstruction: string
  count: number
  falModel: string
  imageUrls: string[]
  aspectRatio: string
  outputFormat: string
}

const RETRY: WorkflowStepConfig = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' }
const PROMPTS: WorkflowStepConfig = { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '10 minutes' }
// a check polls for about a minute, then fails so the step retries: 12 retries is about 15 minutes
const WAIT: WorkflowStepConfig = { retries: { limit: 12, delay: '10 seconds', backoff: 'constant' }, timeout: '2 minutes' }
const POLL_MS = 5000
const EXTENSIONS: Record<string, string> = { png: 'png', jpeg: 'jpg' }
const POLLS_PER_CHECK = 12

export class ImageGenerationWorkflow extends WorkflowEntrypoint<Env, ImageJob> {
  async run(event: WorkflowEvent<ImageJob>, step: WorkflowStep) {
    const job = event.payload

    const sizes: number[] = []
    for (let left = job.count; left > 0; left -= PROMPT_BATCH_SIZE) sizes.push(Math.min(PROMPT_BATCH_SIZE, left))
    const batches = await Promise.all(
      sizes.map((count, b) =>
        step.do(`write prompts ${b + 1}`, PROMPTS, () =>
          writePromptBatch({
            advertorial: job.advertorial,
            gptInstruction: job.gptInstruction,
            claudeInstruction: job.claudeInstruction,
            count,
          }),
        ),
      ),
    )

    const outcomes = await Promise.allSettled(
      batches.flat().map((pair, i) => this.makeImage(step, job, pair, i + 1, event.instanceId)),
    )
    const failed = outcomes.flatMap((outcome, i) =>
      outcome.status === 'rejected' ? [{ image: i + 1, error: String(outcome.reason?.message ?? outcome.reason) }] : [],
    )
    if (failed.length === outcomes.length) throw new Error(`Every image failed. First error: ${failed[0]?.error}`)
    return { saved: outcomes.length - failed.length, failed }
  }

  private async makeImage(step: WorkflowStep, job: ImageJob, pair: PromptPair, n: number, jobId: string) {
    const request = await step.do(`submit image ${n}`, RETRY, () =>
      submitImage({
        model: job.falModel,
        prompt: pair.claudePrompt,
        imageUrls: job.imageUrls,
        aspectRatio: job.aspectRatio,
        outputFormat: job.outputFormat,
      }),
    )

    const falUrl = await step.do(`wait for image ${n}`, WAIT, async () => {
      for (let poll = 0; poll < POLLS_PER_CHECK; poll++) {
        const url = await imageResult(request)
        if (url) return url
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      }
      throw new Error(`fal is still generating image ${n}`)
    })

    // the file is named after its Temp Images row, which the next step creates
    const stored = await step.do(`store image ${n}`, RETRY, async () => {
      const source = await fetch(falUrl)
      if (!source.ok) throw new Error(`The image could not be downloaded from fal (${source.status})`)
      const contentType = (source.headers.get('Content-Type') ?? '').split(';')[0] || `image/${job.outputFormat}`
      const id = recordId()
      const key = `${job.productName}/Images/${id}.${EXTENSIONS[job.outputFormat] ?? job.outputFormat}`
      await settings.BUCKET.put(key, await source.arrayBuffer(), { httpMetadata: { contentType } })
      return { id, url: publicUrl(key) }
    })

    await step.do(`save image ${n}`, RETRY, async () => {
      // the id is fixed by the step above, so a retried insert adds nothing
      await sql(
        `INSERT OR IGNORE INTO temp_images (id, name, image_drive_link, product_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
        stored.id,
        `${job.productName}_Generated_${jobId.slice(0, 8)}_${n}`,
        stored.url,
        job.productId,
        nowIso(),
      ).run()
    })
  }
}
