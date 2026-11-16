// The shape of one rule in rules.ts

// The facts the check works from: the video's format and what the browser
// read from the file at upload (the record's Video Data)
export interface VideoFacts {
  format?: string
  durationSeconds?: number
  width?: number
  height?: number
  fileSizeBytes?: number
}

export interface RuleResult {
  ok: boolean
  detail: string
}

export interface Rule {
  name: string
  // points taken off the score when the rule fails
  penalty: number
  check: (video: VideoFacts) => RuleResult
}

export const pass = (detail: string): RuleResult => ({ ok: true, detail })
export const fail = (detail: string): RuleResult => ({ ok: false, detail })
