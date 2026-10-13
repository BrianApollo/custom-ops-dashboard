import { ChevronRight } from 'lucide-react'
import { Collapsible, Popover } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { button } from '../../components/ui'
import { useFetch } from '../../data'
import { addDays, Chip, dayLabel, DeficitChip, monthLabel, PassIcon, plural, rangeLabel, RichTip, Segmented, tone, weekdayLabel } from './parts'

// GET /overview/editor-kpi. Targets, deficits and the grouping into months and
// weeks are all worked out by the API; this file only draws them.
interface Script {
  scriptId: string
  scriptName: string
  avgDurationMin: number
  videoCount: number
}

interface Day {
  date: string
  // 0 = Sunday … 6 = Saturday
  dayOfWeek: number
  scriptsCompleted: number
  target: number
  passed: boolean
  deficit: number
  scripts: Script[]
}

interface Week {
  weekNumber: number
  // the Monday and Sunday of the whole week, even when the month holds only part of it
  weekStart: string
  weekEnd: string
  scriptsCompleted: number
  target: number
  deficit: number
  days: Day[]
}

interface Month {
  key: string
  scriptsCompleted: number
  target: number
  deficit: number
  weeks: Week[]
}

interface Editor {
  editorId: string
  editorName: string | null
  totalScripts: number
  cumulativeDeficit: number
  // newest first
  months: Month[]
}

interface Kpi {
  currentMonthKey: string
  editors: Editor[]
}

type View = 'calendar' | 'bars'

// An ordinary day's target. The API lowers it on a day with a long script, and
// the calendar marks such a day with how much was taken off.
const FULL_DAY = 3
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const isWeekend = (day: Day) => day.dayOfWeek === 0 || day.dayOfWeek === 6
const reduction = (day: Day) => Math.max(0, FULL_DAY - day.target)
const signed = (deficit: number) => (deficit > 0 ? `-${deficit}` : deficit < 0 ? `+${-deficit}` : '0')

export function EditorsTab() {
  const { data, error } = useFetch<Kpi>('/overview/editor-kpi')
  const [view, setView] = useState<View>('calendar')

  if (error) return <p className="text-sm text-red-700">Could not load the editors' targets: {error.message}</p>
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Segmented
          label="View"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'calendar', label: 'Calendar' },
            { value: 'bars', label: 'Progress Bars' },
          ]}
        />
      </div>
      {data.editors.length === 0 && (
        <p className="rounded-lg border border-neutral-200 bg-white px-4 py-10 text-center text-sm text-neutral-500">No script data found.</p>
      )}
      {data.editors.map((editor) => (
        <EditorCard key={editor.editorId} editor={editor} currentMonthKey={data.currentMonthKey} view={view} />
      ))}
    </div>
  )
}

const trigger = 'group flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-blue-700'
const chevron = 'size-4 shrink-0 text-neutral-500 group-data-[state=open]:rotate-90'

function EditorCard({ editor, currentMonthKey, view }: { editor: Editor; currentMonthKey: string; view: View }) {
  // an editor with nothing this month reads 0/0 and On Target
  const current = editor.months.find((month) => month.key === currentMonthKey)
  return (
    <Collapsible.Root className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <Collapsible.Trigger className={`${trigger} px-4 py-3 text-sm`}>
        <ChevronRight className={chevron} />
        <span className="text-base font-semibold">{editor.editorName || 'Unnamed editor'}</span>
        <span className="text-neutral-600">
          This Month{' '}
          <span className="font-semibold text-neutral-900 tabular-nums">
            {current?.scriptsCompleted ?? 0}/{current?.target ?? 0}
          </span>{' '}
          Scripts
        </span>
        <DeficitChip deficit={current?.deficit ?? 0} />
        <span className="ml-auto text-neutral-600">
          Total Scripts <span className="font-semibold text-neutral-900 tabular-nums">{editor.totalScripts.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-2 text-neutral-600">
          Cumulative Deficit <DeficitChip deficit={editor.cumulativeDeficit} />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="space-y-2 border-t border-neutral-200 bg-neutral-50/60 p-3">
        {editor.months.map((month) => (
          <MonthSection key={month.key} month={month} current={month.key === currentMonthKey} view={view} />
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}

function MonthSection({ month, current, view }: { month: Month; current: boolean; view: View }) {
  return (
    <Collapsible.Root defaultOpen={current} className="overflow-hidden rounded-md border border-neutral-200 bg-white">
      <Collapsible.Trigger className={`${trigger} px-3 py-2 text-sm`}>
        <ChevronRight className={chevron} />
        <span className="font-medium">{monthLabel(month.key)}</span>
        {current && <Chip color="blue">Current</Chip>}
        <span className="ml-auto text-neutral-600 tabular-nums">
          {month.scriptsCompleted}/{month.target} Scripts
        </span>
        <PassIcon passed={month.scriptsCompleted >= month.target} />
        <DeficitChip deficit={month.deficit} />
      </Collapsible.Trigger>
      <Collapsible.Content className="border-t border-neutral-200 p-3">
        {view === 'calendar' ? (
          <MonthCalendar month={month} />
        ) : (
          <div className="space-y-2">
            {month.weeks.map((week) => (
              <WeekBar key={week.weekStart} week={week} />
            ))}
          </div>
        )}
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
            <th className="pb-1 pl-3 text-left font-medium">Week</th>
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week) => (
            <tr key={week.weekStart}>
              {WEEKDAYS.map((name, i) => {
                // no entry: a day of another month, a day outside the editor's tracked range, or a weekend not worked
                const day = week.days.find((d) => d.date === addDays(week.weekStart, i))
                return <td key={name}>{day ? <DayCell day={day} /> : <div className="h-15 w-20 rounded-md bg-neutral-100" />}</td>
              })}
              <td className="pl-3 whitespace-nowrap">
                <WeekTotals week={week} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DayCell({ day }: { day: Day }) {
  const reduced = reduction(day)
  const label = `${dayLabel(day.date)}: ${day.scriptsCompleted} of ${plural(day.target, 'script')}, target ${day.passed ? 'met' : 'missed'}${reduced ? `, target reduced by ${reduced}` : ''}`
  const box = `relative flex h-15 w-20 items-center justify-center gap-1 rounded-md border ${day.passed ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`
  const inside = (
    <>
      <span className="absolute top-1 left-1.5 text-[11px] text-neutral-500 tabular-nums">{day.date.slice(8)}</span>
      {reduced > 0 && <span className="absolute top-1 right-1.5 text-[11px] font-semibold text-amber-700">-{reduced}</span>}
      <span className="text-base font-semibold tabular-nums">{day.scriptsCompleted}</span>
      <PassIcon passed={day.passed} />
    </>
  )
  // only a day with scripts has anything more to show
  if (day.scriptsCompleted === 0) {
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

// The scripts finished on one day
function DayPopover({ day, children }: { day: Day; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} className="z-50 w-72 rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-lg">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{dayLabel(day.date)}</p>
            {/* a weekend is extra work, so it is not judged on its own */}
            {!isWeekend(day) && <Chip color={day.passed ? 'green' : 'red'}>{day.passed ? 'Passed' : 'Missed'}</Chip>}
          </div>
          {!isWeekend(day) && (
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              {[
                ['Completed', day.scriptsCompleted],
                ['Target', day.target],
                ['Deficit', signed(day.deficit)],
              ].map(([name, value]) => (
                <div key={name} className="rounded-md bg-neutral-50 py-1.5">
                  <dd className="font-semibold tabular-nums">{value}</dd>
                  <dt className="text-xs text-neutral-500">{name}</dt>
                </div>
              ))}
            </dl>
          )}
          {day.scripts.length === 0 ? (
            <p className="mt-2 text-neutral-500">No scripts completed</p>
          ) : (
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
              {day.scripts.map((script) => (
                <li key={script.scriptId} className="border-l-2 border-emerald-500 pl-2">
                  <p className="font-medium wrap-break-word">{script.scriptName || 'Untitled script'}</p>
                  <p className="text-xs text-neutral-500">
                    {script.avgDurationMin ? `${script.avgDurationMin} min avg` : 'No duration'} • {plural(script.videoCount, 'video')}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// A week's count against its target, with the deficit
function WeekTotals({ week }: { week: Week }) {
  const weekdays = week.days.filter((day) => !isWeekend(day))
  const weekend = week.days.filter(isWeekend)
  const reducedDays = weekdays.filter((day) => reduction(day) > 0)
  const { deficit } = week

  // how the API's target for the week is made up
  const breakdown = (
    <div className="space-y-0.5">
      <p className="font-semibold">Weekly Target Breakdown</p>
      <p>
        Base target ({plural(weekdays.length, 'day')}): {FULL_DAY * weekdays.length}
      </p>
      {reducedDays.length > 0 && (
        <p>
          Long scripts ({plural(reducedDays.length, 'day')}): −{reducedDays.reduce((n, day) => n + reduction(day), 0)}
        </p>
      )}
      {weekend.length > 0 && (
        <p>
          Makeup days ({weekend.length}): +{weekend.reduce((n, day) => n + day.target, 0)}
        </p>
      )}
      <p className="font-semibold">Total target: {week.target}</p>
    </div>
  )
  const standing =
    deficit > 0 ? (
      <div>
        <p className="font-semibold">Behind Target</p>
        <p>
          Completed {week.scriptsCompleted} of {plural(week.target, 'Script')}
        </p>
        <p>Short by {plural(deficit, 'Script')}</p>
      </div>
    ) : deficit === 0 ? (
      'Exactly on target this week'
    ) : (
      <div>
        <p className="font-semibold">Ahead of Target</p>
        <p>+{plural(-deficit, 'extra Script')}</p>
      </div>
    )

  return (
    <span className="inline-flex items-center gap-2">
      <RichTip content={breakdown}>
        <span tabIndex={0} className="rounded tabular-nums focus-visible:outline-2 focus-visible:outline-blue-700">
          {week.scriptsCompleted}/{week.target} Scripts
        </span>
      </RichTip>
      <PassIcon passed={week.scriptsCompleted >= week.target} />
      <RichTip content={standing}>
        <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-blue-700">
          <DeficitChip deficit={deficit} />
        </span>
      </RichTip>
    </span>
  )
}

function WeekBar({ week }: { week: Week }) {
  const percent = week.target > 0 ? Math.min(100, (week.scriptsCompleted / week.target) * 100) : 100
  const fill = percent >= 80 ? 'bg-emerald-500' : percent >= 50 ? 'bg-amber-500' : 'bg-red-500'
  const weekdays = week.days.filter((day) => !isWeekend(day))

  const daily = (
    <div className="space-y-0.5">
      <p className="font-semibold">Daily Breakdown</p>
      {weekdays.length === 0 && <p>No weekdays in this part of the week</p>}
      {weekdays.map((day) => (
        <p key={day.date} className="flex items-center gap-2 tabular-nums">
          <span className="w-8">{weekdayLabel(day.date)}</span>
          {day.scriptsCompleted} / {day.target}
          {reduction(day) > 0 && <span className="text-amber-300">long</span>}
          <span className="ml-auto">{day.passed ? '✓' : '✗'}</span>
        </p>
      ))}
    </div>
  )

  return (
    <Collapsible.Root className="text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Collapsible.Trigger aria-label={`Days of week ${week.weekNumber}`} className={`group ${button.icon}`}>
          <ChevronRight className="size-4 group-data-[state=open]:rotate-90" />
        </Collapsible.Trigger>
        <span className="w-14 font-medium">Week {week.weekNumber}</span>
        <span className="w-32 text-neutral-500">{rangeLabel(week.weekStart, week.weekEnd)}</span>
        <RichTip content={daily}>
          <div
            role="progressbar"
            tabIndex={0}
            aria-label={`Week ${week.weekNumber}: ${week.scriptsCompleted} of ${plural(week.target, 'script')}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
          </div>
        </RichTip>
        <WeekTotals week={week} />
      </div>
      <Collapsible.Content className="flex flex-wrap gap-2 pt-2 pl-11">
        {week.days.map((day) => (
          <DayPopover key={day.date} day={day}>
            <button
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700 ${day.passed ? tone.green : tone.red}`}
            >
              {weekdayLabel(day.date)} {plural(day.scriptsCompleted, 'script')}
              <PassIcon passed={day.passed} />
            </button>
          </DayPopover>
        ))}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
