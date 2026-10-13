import { useEffect, useState, type ReactNode } from 'react'
import { DeficitChip, monthLabel, plural, RichTip } from '../../pages/overview/parts'
import { Select } from '../ui'
import { useServerList } from '../videos/ServerTable'

// GET /overview/editor-kpi?editorId=…, the parts this card reads. Which scripts count as
// completed, in which month, and the target are all worked out by the API.
interface Month {
  // YYYY-MM
  key: string
  scriptsCompleted: number
  target: number
  deficit: number
  weeks: { days: { scripts: { scriptId: string; scriptName: string }[] }[] }[]
}

interface Kpi {
  currentMonthKey: string
  // one entry for the editor asked for, none while they have no completed script
  editors: { months: Month[] }[]
}

// what an editor is expected to finish on a working day
const SCRIPTS_PER_DAY = 3

// Monday to Friday in a month given as YYYY-MM
function workingDays(key: string) {
  const [year, month] = key.split('-').map(Number)
  let count = 0
  for (let day = 1; day <= new Date(Date.UTC(year, month, 0)).getUTCDate(); day++) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    if (weekday >= 1 && weekday <= 5) count++
  }
  return count
}

function Row({ label, tip, children }: { label: string; tip: ReactNode; children: ReactNode }) {
  return (
    <RichTip content={tip}>
      <div tabIndex={0} className="flex items-baseline justify-between gap-4 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
        <dt className="text-neutral-600">{label}</dt>
        <dd className="flex items-center gap-2 font-semibold tabular-nums">{children}</dd>
      </div>
    </RichTip>
  )
}

interface Props {
  editorId: string
  // goes up each time one of the editor's videos changes, so the numbers are read again
  version: number
}

// One editor's month: what is expected of them and how many scripts they have completed
export function MonthlyStats({ editorId, version }: Props) {
  // the API keeps these numbers for a minute; after a change they are asked for afresh
  const { data, error, reload } = useServerList<Kpi>(`/overview/editor-kpi?editorId=${editorId}${version ? '&fresh=1' : ''}`)
  // undefined until a month is chosen, so the card opens on the current one
  const [picked, setPicked] = useState<string>()

  useEffect(() => {
    // the first change alters the path, which loads by itself
    if (version > 1) reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  const frame = 'w-full max-w-sm rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm'
  if (!data) {
    return <p className={`${frame} ${error ? 'text-red-700' : 'text-neutral-500'}`}>{error ? `Could not load the monthly numbers: ${error.message}` : 'Loading…'}</p>
  }

  const months = data.editors[0]?.months ?? []
  const keys = [...new Set([data.currentMonthKey, ...months.map((month) => month.key)])].sort().reverse()
  const key = picked ?? data.currentMonthKey
  const month = months.find((m) => m.key === key)
  const days = workingDays(key)
  const expected = days * SCRIPTS_PER_DAY
  const completed = month?.scriptsCompleted ?? 0
  const names = (month?.weeks ?? [])
    .flatMap((week) => week.days.flatMap((day) => day.scripts.map((script) => script.scriptName || 'Untitled script')))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const percent = expected > 0 ? Math.min(100, (completed / expected) * 100) : 0

  return (
    <section aria-label="Monthly numbers" className={frame}>
      <Select
        label="Month"
        value={key}
        options={keys.map((k) => ({ value: k, label: monthLabel(k) }))}
        onValueChange={setPicked}
        className="w-44"
      />
      <dl className="mt-2 space-y-1.5">
        <Row label="Working days" tip={`Monday to Friday in ${monthLabel(key)}`}>
          {days}
        </Row>
        <Row label="Expected scripts" tip={`${plural(days, 'working day')} × ${SCRIPTS_PER_DAY}`}>
          {expected}
        </Row>
        <Row
          label="Completed scripts"
          tip={
            names.length ? (
              <ol className="max-h-72 list-inside list-decimal space-y-0.5 overflow-y-auto">
                {names.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ol>
            ) : (
              'No completed scripts this month'
            )
          }
        >
          {completed}
        </Row>
        <Row
          label="Target so far"
          tip={
            <div className="max-w-56 space-y-0.5">
              <p>3 scripts for each weekday worked or missed up to the last completed script, 2 on a day with a script longer than 3 minutes.</p>
              <p>The chip says how far ahead or behind that target the month is.</p>
            </div>
          }
        >
          {month?.target ?? 0}
          <DeficitChip deficit={month?.deficit ?? 0} />
        </Row>
      </dl>
      <div
        role="progressbar"
        aria-label="Completed scripts against the month's expected scripts"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200"
      >
        <div className={`h-full rounded-full ${percent >= 100 ? 'bg-emerald-600' : 'bg-blue-700'}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-right text-xs text-neutral-500 tabular-nums">
        {completed} / {expected} scripts ({Math.round(percent)}%)
      </p>
    </section>
  )
}
