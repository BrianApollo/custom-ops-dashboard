import { settings } from '../env'
import { nowIso, sql } from '../lib/d1'

// Puts a video's score back to "checking" (or to empty when it has no file).
// Goes in the same batch as the change to its file.
export const resetScore = (videoId: string, hasFile: boolean) =>
  sql(
    'UPDATE videos SET score = NULL, score_notes = NULL, score_status = ?, scored_at = NULL WHERE id = ?',
    hasFile ? 'checking' : null,
    videoId,
  )

// Starts the check for a video whose score was just reset to "checking".
// `uploadedAt` is its creative_link_updated_at, which ties the result to this file.
// Never throws: a check that cannot start is shown as failed, and an admin can run it again.
export async function startCheck(videoId: string, uploadedAt: string | null) {
  try {
    await settings.VIDEO_CHECK.create({ params: { videoId, uploadedAt } })
  } catch (err) {
    console.error('video check could not be started', videoId, err)
    await sql(
      `UPDATE videos SET score_status = 'failed', score_notes = ?, scored_at = ?
       WHERE id = ? AND score_status = 'checking'`,
      `Check failed: it could not be started (${String((err as Error)?.message ?? err)})`,
      nowIso(),
      videoId,
    )
      .run()
      .catch(() => undefined)
  }
}
