import { ChevronRight } from 'lucide-react'
import { Collapsible, Popover } from 'radix-ui'
import type { ReactNode } from 'react'
import { useFetch } from '../../data'
import { addDays, Chip, dayLabel, monthLabel, plural } from './parts'

// GET /overview/editor-kpi. Only what each editor uploaded, day by day, is shown here;
// the targets and deficits the API also sends are left out on purpose.
interface Script {
  scriptId: string
  scriptName: string
  avgDurationMin: number
  videoCount: number
}

interface Day {
  date: string
  scriptsCompleted: number
  scripts: Script[]
}

interface Week {
  // the Monday of the whole week, even when the month holds only part of it
  weekStart: string
  days: Day[]
}

interface Month {
  // YYYY-MM
  key: string
  scriptsCompleted: number
  weeks: Week[]
}

interface Editor {
  editorId: string
  editorName: string | null
  totalScripts: number
  // newest first
  months: Month[]
}

interface Kpi {
  currentMonthKey: string
  editors: Editor[]
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function EditorsTab() {
  const { data, error } = useFetch<Kpi>('/overview/editor-kpi')

  if (error) return <p className="text-sm text-red-700">Could not load the editors' uploads: {error.message}</p>
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>

  return (
    <div className="space-y-3">
      {data.editors.length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-500">No uploads yet.</p>
      )}
      {data.editors.map((editor) => (
        <EditorCard key={editor.editorId} editor={editor} currentMonthKey={data.currentMonthKey} />
      ))}
    </div>
  )
}

const trigger = 'group flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-blue-700'
const chevron = 'size-4 shrink-0 text-neutral-500 group-data-[state=open]:rotate-90'

function EditorCard({ editor, currentMonthKey }: { editor: Editor; currentMonthKey: string }) {
  const current = editor.months.find((month) => month.key === currentMonthKey)
  return (
    <Collapsible.Root className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <Collapsible.Trigger className={`${trigger} px-4 py-3 text-sm`}>
        <ChevronRight className={chevron} />
        <span className="text-base font-semibold">{editor.editorName || 'Unnamed editor'}</span>
        <span className="text-neutral-600">
          This month <span className="font-semibold text-neutral-900 tabular-nums">{current?.scriptsCompleted ?? 0}</span>
        </span>
        <span className="ml-auto text-neutral-600">
          Total <span className="font-semibold text-neutral-900 tabular-nums">{editor.totalScripts.toLocaleString()}</span>
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-2 border-t border-neutral-200 bg-neutral-50/60 p-3">
        {editor.months.map((month) => (
          <MonthSection key={month.key} month={month} current={month.key === currentMonthKey} />
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function MonthSection({ month, current }: { month: Month; current: boolean }) {
  return (
    <Collapsible.Root defaultOpen={current} className="overflow-hidden rounded-md border border-neutral-200 bg-white">
      <Collapsible.Trigger className={`${trigger} px-3 py-2 text-sm`}>
        <ChevronRight className={chevron} />
        <span className="font-medium">{monthLabel(month.key)}</span>
        {current && <Chip color="blue">Current</Chip>}
        <span className="ml-auto text-neutral-600 tabular-nums">{plural(month.scriptsCompleted, 'script')} uploaded</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="border-t border-neutral-200 p-3">
        <MonthCalendar month={month} />
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function MonthCalendar({ month }: { month: Month }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-sm">
        <thead className="text-xs tracking-wide text-neutral-600 uppercase">
          <tr>
            {WEEKDAYS.map((name) => (
              <th key={name} className="w-20 pb-1 text-center font-medium">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week) => (
            <tr key={week.weekStart}>
              {WEEKDAYS.map((name, i) => {
                const date = addDays(week.weekStart, i)
                // days of the neighbouring months stay blank
                if (!date.startsWith(month.key)) return <td key={name}><div className="h-15 w-20" /></td>
                // a day the API does not list had no uploads
                const day = week.days.find((d) => d.date === date) ?? { date, scriptsCompleted: 0, scripts: [] }
                return (
                  <td key={name}>
                    <DayCell day={day} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DayCell({ day }: { day: Day }) {
  const label = `${dayLabel(day.date)}: ${plural(day.scriptsCompleted, 'script')} uploaded`
  const some = day.scriptsCompleted > 0
  const box = `relative flex h-15 w-20 items-center justify-center rounded-md border ${some ? 'border-blue-200 bg-blue-50' : 'border-neutral-200 bg-white'}`
  const inside = (
    <>
      <span className="absolute top-1 left-1.5 text-[11px] text-neutral-500 tabular-nums">{day.date.slice(8)}</span>
      <span className={`text-base font-semibold tabular-nums ${some ? '' : 'text-neutral-300'}`}>{day.scriptsCompleted}</span>
    </>
  )
  // only a day with uploads has anything more to show
  if (!some) {
    return (
      <div role="img" aria-label={label} className={box}>
        {inside}
      </div>
    )
  }
  return (
    <DayPopover day={day}>
      <button aria-label={label} className={`${box} hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700`}>
        {inside}
      </button>
    </DayPopover>
  )
}

// The scripts uploaded on one day
function DayPopover({ day, children }: { day: Day; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} className="z-50 w-72 rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-lg">
          <p className="font-semibold">
            {dayLabel(day.date)} · {plural(day.scriptsCompleted, 'script')}
          </p>
          <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
            {day.scripts.map((script) => (
              <li key={script.scriptId} className="border-l-2 border-blue-500 pl-2">
                <p className="font-medium wrap-break-word">{script.scriptName || 'Untitled script'}</p>
                <p className="text-xs text-neutral-500">{plural(script.videoCount, 'video')}</p>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
