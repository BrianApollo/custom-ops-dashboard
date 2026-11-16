import type { VideoFacts } from './rule'
import { RULES, START_SCORE } from './rules'

export interface CheckResult {
  // 1 to 10
  score: number
  notes: string
}

const MIN_SCORE = 1
const MAX_SCORE = 10

// Scores one video. This is the only function the rest of the app calls, so
// the real skill replaces this file's body and nothing around it.
export async function checkVideo(video: VideoFacts): Promise<CheckResult> {
  const results = RULES.map((rule) => ({ rule, result: rule.check(video) }))
  const lost = results.reduce((sum, { rule, result }) => sum + (result.ok ? 0 : rule.penalty), 0)
  const score = Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(START_SCORE - lost)))
  const passed = results.filter(({ result }) => result.ok).length
  const notes = [
    `Placeholder check: ${passed} of ${results.length} passed.`,
    ...results.map(({ rule, result }) => `${result.ok ? '✓' : '✗'} ${rule.name}: ${result.detail}`),
  ].join('\n')
  return { score, notes }
}

// Video Data is JSON text written by the browser; anything unreadable counts as unknown
export function factsFrom(format: unknown, videoData: unknown): VideoFacts {
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = typeof videoData === 'string' ? JSON.parse(videoData) : null
    if (typeof parsed === 'object' && parsed !== null) data = parsed as Record<string, unknown>
  } catch {
    // left empty
  }
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  return {
    format: typeof format === 'string' && format ? format : undefined,
    durationSeconds: number(data.durationSeconds),
    width: number(data.width),
    height: number(data.height),
    fileSizeBytes: number(data.fileSizeBytes),
  }
}
