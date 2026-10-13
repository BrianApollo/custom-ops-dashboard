import { addDays } from './dates'

// The arithmetic behind the Overview page. Nothing here touches the database,
// so the rules can be checked against a fixed set of videos.

export interface DoneVideo {
  editorId: string
  scriptId: string
  scriptName: string
  // ISO timestamp of the last (else first) upload; null when the video has none
  uploadedAt: string | null
  // seconds; null when missing or not above zero
  duration: number | null
}

const LONG_MINUTES = 3

// the calendar day of a moment, as someone in `timeZone` sees it
export function dayIn(timeZone: string, iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

// 0 = Sunday … 6 = Saturday
export const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()
const isWeekend = (date: string) => [0, 6].includes(dayOfWeek(date))
const mondayOf = (date: string) => addDays(date, -((dayOfWeek(date) + 6) % 7))
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

// 2026-W41: the ISO week, whose year is that of its Thursday
export function isoWeek(date: string) {
  const thursday = addDays(mondayOf(date), 3)
  const year = thursday.slice(0, 4)
  const days = (Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / 86_400_000
  return `${year}-W${String(Math.floor(days / 7) + 1).padStart(2, '0')}`
}

function group<T>(items: T[], key: (item: T) => string) {
  const out = new Map<string, T[]>()
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item])
  return out
}

interface CompletedScript {
  scriptId: string
  scriptName: string
  completionDate: string
  avgDurationMin: number
  videoCount: number
}

// One editor's daily target tracker. `videos` are that editor's done videos
// that have a script.
export function editorKpi(videos: DoneVideo[], timeZone: string) {
  // a script is completed by this editor once every one of their done videos for it has an upload date
  const completed: CompletedScript[] = []
  for (const [scriptId, own] of group(videos, (v) => v.scriptId)) {
    if (own.some((v) => !v.uploadedAt)) continue
    const durations = own.flatMap((v) => (v.duration ? [v.duration] : []))
    completed.push({
      scriptId,
      scriptName: own[0].scriptName,
      completionDate: own.map((v) => dayIn(timeZone, v.uploadedAt!)).sort().at(-1)!,
      avgDurationMin: durations.length ? Math.round((mean(durations) / 60) * 10) / 10 : 0,
      videoCount: own.length,
    })
  }
  if (!completed.length) return null

  // a day's target is 3 scripts, or 2 when one of them was long
  const byDay = group(completed, (s) => s.completionDate)
  const dates = [...byDay.keys()].sort()
  const days = []
  for (let date = dates[0]; date <= dates.at(-1)!; date = addDays(date, 1)) {
    const scripts = (byDay.get(date) ?? []).sort((a, b) => a.scriptName.localeCompare(b.scriptName))
    // a weekday with nothing done counts against the editor; a weekend only appears if worked
    if (!scripts.length && isWeekend(date)) continue
    const target = scripts.some((s) => s.avgDurationMin > LONG_MINUTES) ? 2 : 3
    days.push({
      date,
      dayOfWeek: dayOfWeek(date),
      scriptsCompleted: scripts.length,
      target,
      passed: scripts.length >= target,
      deficit: target - scripts.length,
      scripts: scripts.map(({ scriptId, scriptName, avgDurationMin, videoCount }) => ({ scriptId, scriptName, avgDurationMin, videoCount })),
    })
  }

  // days fall into their month, then into Monday-to-Sunday weeks inside it, so
  // a week that crosses a month end shows as two part-weeks
  let cumulativeDeficit = 0
  const months = [...group(days, (d) => d.date.slice(0, 7))].map(([key, monthDays]) => {
    const weeks = [...group(monthDays, (d) => mondayOf(d.date))].map(([weekStart, weekDays], i) => {
      const scriptsCompleted = weekDays.reduce((n, d) => n + d.scriptsCompleted, 0)
      const target = weekDays.reduce((n, d) => n + d.target, 0)
      return { weekNumber: i + 1, weekStart, weekEnd: addDays(weekStart, 6), scriptsCompleted, target, deficit: target - scriptsCompleted, days: weekDays }
    })
    const scriptsCompleted = weeks.reduce((n, w) => n + w.scriptsCompleted, 0)
    const target = weeks.reduce((n, w) => n + w.target, 0)
    cumulativeDeficit += target - scriptsCompleted
    return { key, scriptsCompleted, target, deficit: target - scriptsCompleted, cumulativeDeficit, weeks }
  })

  return { totalScripts: completed.length, cumulativeDeficit, months: months.reverse() }
}

// Completed scripts per month or ISO week. `videos` are done videos that have
// a script and an upload date, from every editor being counted.
export function scriptsPerPeriod(videos: DoneVideo[], granularity: 'monthly' | 'weekly', timeZone: string, today: string) {
  const periods = new Map<string, { short: number; long: number; durations: number[] }>()
  for (const own of group(videos, (v) => v.scriptId).values()) {
    const durations = own.flatMap((v) => (v.duration ? [v.duration] : []))
    // a script with no measured video cannot be called short or long
    if (!durations.length) continue
    const latest = own.map((v) => dayIn(timeZone, v.uploadedAt!)).sort().at(-1)!
    const key = granularity === 'monthly' ? latest.slice(0, 7) : isoWeek(latest)
    const period = periods.get(key) ?? periods.set(key, { short: 0, long: 0, durations: [] }).get(key)!
    if (mean(durations) / 60 > LONG_MINUTES) period.long++
    else period.short++
    period.durations.push(...durations)
  }

  let keys = [...periods.keys()]
  if (granularity === 'weekly') {
    // every week of this ISO year so far, whether or not anything was finished in it
    const current = isoWeek(today)
    keys = Array.from({ length: Number(current.slice(6)) }, (_, i) => `${current.slice(0, 4)}-W${String(i + 1).padStart(2, '0')}`)
  }
  return keys
    .sort()
    .reverse()
    .map((key) => {
      const period = periods.get(key)
      return {
        key,
        shortScripts: period?.short ?? 0,
        longScripts: period?.long ?? 0,
        total: (period?.short ?? 0) + (period?.long ?? 0),
        // of every video in the period, not of the scripts' averages
        avgDurationSec: period ? mean(period.durations) : 0,
      }
    })
}
