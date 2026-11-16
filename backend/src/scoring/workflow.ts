import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers'
import { nowIso, rows, sql } from '../lib/d1'
import { checkVideo, factsFrom } from './check'

// One video check, run by Cloudflare Workflows after an upload so it outlives
// the request and is retried on failure:
//   read the video -> checkVideo (check.ts) -> save Score and Score Notes
// The result is saved only if the video still has the file that was checked,
// so a check overtaken by a newer upload changes nothing.

export interface VideoCheckJob {
  videoId: string
  // the video's creative_link_updated_at when the check was started
  uploadedAt: string | null
}

const RETRY: WorkflowStepConfig = { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' }, timeout: '5 minutes' }

export class VideoCheckWorkflow extends WorkflowEntrypoint<Env, VideoCheckJob> {
  async run(event: WorkflowEvent<VideoCheckJob>, step: WorkflowStep) {
    const { videoId, uploadedAt } = event.payload

    let result: { score: number; notes: string } | null
    try {
      result = await step.do('check video', RETRY, async () => {
        const [video] = await rows(
          sql('SELECT format, video_data, creative_link_updated_at AS at FROM videos WHERE id = ?', videoId),
        )
        // deleted, or replaced by a newer upload with its own check
        if (!video || video.at !== uploadedAt) return null
        const checked = await checkVideo(factsFrom(video.format, video.video_data))
        if (!Number.isInteger(checked.score) || checked.score < 1 || checked.score > 10) {
          throw new Error(`The check gave a score of ${checked.score}; it must be a whole number from 1 to 10`)
        }
        return checked
      })
    } catch (err) {
      const message = String((err as Error)?.message ?? err)
      await step.do('save failure', RETRY, () => saveResult(videoId, uploadedAt, 'failed', null, `Check failed: ${message}`))
      return { saved: false, error: message }
    }

    if (!result) return { saved: false, reason: 'stale' }
    const saved = result
    await step.do('save score', RETRY, () => saveResult(videoId, uploadedAt, 'done', saved.score, saved.notes))
    return { saved: true, score: saved.score }
  }
}

async function saveResult(videoId: string, uploadedAt: string | null, status: string, score: number | null, notes: string) {
  await sql(
    `UPDATE videos SET score = ?, score_notes = ?, score_status = ?, scored_at = ?
     WHERE id = ? AND creative_link_updated_at IS ? AND score_status = 'checking'`,
    score,
    notes,
    status,
    nowIso(),
    videoId,
    uploadedAt,
  ).run()
}
