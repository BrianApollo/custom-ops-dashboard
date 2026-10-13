import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const DELAY_MS = 2000

// Saves the campaign's fields two seconds after the last edit. `version` goes up
// with every edit; nothing is written until the first one, so opening the page
// changes nothing. `save()` writes at once and resolves to whether the record is up to date.
export function useAutosave(campaignId: string, fields: Record<string, unknown>, version: number, paused: boolean) {
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string>()
  const latest = useRef(fields)
  latest.current = fields
  const timer = useRef<number | undefined>(undefined)
  const running = useRef<Promise<boolean> | null>(null)
  // there are edits the record does not have yet
  const dirty = useRef(false)

  const save = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current)
    // one write at a time, so an older save can never land on top of a newer one
    while (running.current) await running.current
    if (!dirty.current) return true
    dirty.current = false
    setState('saving')
    const run = api(`/data/campaigns/${campaignId}`, { method: 'PATCH', body: { fields: latest.current } })
      .then(
        () => {
          setState(dirty.current ? 'pending' : 'saved')
          return true
        },
        (err: Error) => {
          dirty.current = true
          setError(err.message)
          setState('error')
          return false
        },
      )
      .finally(() => {
        running.current = null
      })
    running.current = run
    return run
  }, [campaignId])

  useEffect(() => {
    if (version === 0 || paused) return
    dirty.current = true
    setState('pending')
    timer.current = window.setTimeout(() => void save(), DELAY_MS)
    return () => window.clearTimeout(timer.current)
  }, [version, paused, save])

  // leaving the page inside the two seconds still saves the last edit
  useEffect(
    () => () => {
      if (dirty.current) void save()
    },
    [save],
  )

  return { state, error, save }
}
