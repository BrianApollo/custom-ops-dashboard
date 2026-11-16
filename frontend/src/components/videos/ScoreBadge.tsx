import { useEffect, useRef } from 'react'

// The automatic check's result for a scripted video (backend/src/scoring). Admins only.

export type ScoreStatus = 'checking' | 'done' | 'failed'

const POLL_MS = 5000

function tone(score: number) {
  if (score >= 8) return 'bg-emerald-50 text-emerald-800 ring-emerald-600/20'
  if (score >= 5) return 'bg-amber-50 text-amber-800 ring-amber-600/20'
  return 'bg-red-50 text-red-800 ring-red-600/20'
}

const badge = 'inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset'

export function ScoreBadge({ score, status }: { score?: number | null; status?: string | null }) {
  if (status === 'checking') return <span className={`${badge} bg-neutral-50 text-neutral-600 ring-neutral-500/20`}>Checking…</span>
  if (status === 'failed') return <span className={`${badge} bg-red-50 text-red-800 ring-red-600/20`}>Check failed</span>
  if (typeof score !== 'number') return <span className="text-neutral-400">—</span>
  return (
    <span className={`${badge} tabular-nums ${tone(score)}`} aria-label={`Score ${score} out of 10`}>
      {score}/10
    </span>
  )
}

// Calls `reload` every few seconds while `active` is true, until the check finishes
export function usePollWhile(active: boolean, reload: () => void) {
  const latest = useRef(reload)
  useEffect(() => {
    latest.current = reload
  })
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => latest.current(), POLL_MS)
    return () => clearInterval(timer)
  }, [active])
}
