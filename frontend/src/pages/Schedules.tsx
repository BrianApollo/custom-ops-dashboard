import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Dialog, Label, Tabs, ToggleGroup } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { DataTable, type Column } from '../components/DataTable'
import { ConfirmDialog } from '../components/rules/ConfirmDialog'
import { button, input, StatusBadge, Tip } from '../components/ui'
import { useRecords } from '../data'
import { api, text, type ApiRecord } from '../lib/api'

const TYPES = ['Budget Change', 'Status Change']
// what the scheduled job is given for a status change, and how each is shown
const TARGET_STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
]
// the scheduled job runs each action just after midnight in this zone, at the start of its date
const RUN_TIME = '12:01 AM (GMT+7)'

const campaignName = (record: ApiRecord) => (record.fields['Name (from Linked Campaign)'] as string[] | undefined)?.[0] ?? ''

function execute(record: ApiRecord) {
  const value = text(record, 'Execute')
  if (text(record, 'Type') !== 'Budget Change' || !Number.isFinite(Number(value))) {
    return TARGET_STATUSES.find((status) => status.value === value)?.label ?? value
  }
  return `$${Number(value).toLocaleString()} / day`
}

// today's date in the browser's zone as YYYY-MM-DD, moved by `days`
function localDate(days = 0) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const segment =
  'flex-1 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=on]:bg-blue-50 data-[state=on]:text-blue-800'

// Two or three choices side by side, exactly one of them on
function Segmented({ label, value, options, onValueChange }: { label: string; value: string; options: { value: string; label: string }[]; onValueChange: (value: string) => void }) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      // clicking the chosen one again leaves it chosen
      onValueChange={(next) => next && onValueChange(next)}
      className="mt-1.5 flex divide-x divide-neutral-300 overflow-hidden rounded-md border border-neutral-300"
    >
      {options.map((option) => (
        <ToggleGroup.Item key={option.value} value={option.value} className={segment}>
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

interface DialogProps {
  // the campaign to schedule for, when opened from a campaign's row
  fbCampaignId?: string
  onClose: () => void
  onScheduled: () => void
}

export function ScheduleDialog({ onClose, onScheduled, ...props }: DialogProps) {
  // launched campaigns, offered as suggestions; any Facebook campaign id may be typed
  const campaigns = useRecords('campaigns', { fields: 'Name,FB Campaign ID', 'whereNotEmpty[FB Campaign ID]': '1' })
  const [type, setType] = useState(TYPES[0])
  const [fbCampaignId, setFbCampaignId] = useState(props.fbCampaignId ?? '')
  const [budget, setBudget] = useState('')
  const [status, setStatus] = useState(TARGET_STATUSES[1].value)
  const [date, setDate] = useState(localDate(1))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const isBudget = type === 'Budget Change'
  const known = campaigns.records?.find((record) => text(record, 'FB Campaign ID') === fbCampaignId.trim())
  const valid = fbCampaignId.trim() !== '' && date !== '' && (!isBudget || Number(budget) > 0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api('/schedule', {
        method: 'POST',
        // a budget is sent in whole dollars, as typed
        body: { fbCampaignId: fbCampaignId.trim(), type, execute: isBudget ? String(Number(budget)) : status, scheduledAt: date },
      })
      onScheduled()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        >
          <Dialog.Title className="text-base font-semibold">Schedule action</Dialog.Title>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <span className="text-sm font-medium">Type</span>
              <Segmented label="Type" value={type} options={TYPES.map((value) => ({ value, label: value }))} onValueChange={setType} />
            </div>

            <div>
              <Label.Root htmlFor="schedule-campaign" className="text-sm font-medium">
                Facebook campaign ID
              </Label.Root>
              <input
                id="schedule-campaign"
                required
                autoFocus
                list="schedule-campaigns"
                inputMode="numeric"
                placeholder="Type an ID or a campaign name"
                value={fbCampaignId}
                onChange={(e) => setFbCampaignId(e.target.value)}
                className={`${input} mt-1.5`}
              />
              <datalist id="schedule-campaigns">
                {campaigns.records?.map((record) => (
                  <option key={record.id} value={text(record, 'FB Campaign ID')}>
                    {text(record, 'Name')}
                  </option>
                ))}
              </datalist>
              <p className="mt-1 text-xs text-neutral-500">
                {known ? `Campaign: ${text(known, 'Name')}` : fbCampaignId.trim() ? 'Not one of the campaigns launched from here.' : 'Launched campaigns are suggested as you type.'}
              </p>
            </div>

            {isBudget ? (
              <div>
                <Label.Root htmlFor="schedule-budget" className="text-sm font-medium">
                  Daily budget (USD)
                </Label.Root>
                <div className="relative mt-1.5">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-neutral-500">$</span>
                  <input
                    id="schedule-budget"
                    type="number"
                    min={1}
                    required
                    inputMode="decimal"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className={`${input} pl-7`}
                  />
                </div>
                <p className="mt-1 text-xs text-neutral-500">The new amount per day, in dollars.</p>
              </div>
            ) : (
              <div>
                <span className="text-sm font-medium">Target status</span>
                <Segmented label="Target status" value={status} options={TARGET_STATUSES} onValueChange={setStatus} />
              </div>
            )}

            <div>
              <Label.Root htmlFor="schedule-date" className="text-sm font-medium">
                Takes effect on
              </Label.Root>
              <input
                id="schedule-date"
                type="date"
                required
                min={localDate()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={`${input} mt-1.5`}
              />
              <p className="mt-1 text-xs text-neutral-500">
                Runs at {RUN_TIME}, at the very start of that date. Choosing the 11th means the change is in place just after midnight on the night
                of the 10th.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close type="button" className={button.secondary}>
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy || !valid} className={button.primary}>
                {busy ? 'Scheduling…' : 'Schedule'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const COLUMNS: Column<ApiRecord>[] = [
  {
    header: 'Campaign',
    cell: (record) => (
      <>
        {campaignName(record) || 'Unknown campaign'}
        <span className="block text-xs font-normal text-neutral-500 tabular-nums">{text(record, 'Campaign Id')}</span>
      </>
    ),
  },
  { header: 'Type', cell: (record) => text(record, 'Type') },
  { header: 'Execute', cell: execute },
  { header: 'Scheduled for', cell: (record) => <span className="tabular-nums">{text(record, 'Scheduled At')}</span> },
  { header: 'Source', cell: (record) => text(record, 'Source') },
]

const LOG_COLUMNS: Column<ApiRecord>[] = [
  ...COLUMNS,
  { header: 'Status', cell: (record) => <StatusBadge status={text(record, 'Status')} /> },
  { header: 'Executed', cell: (record) => <span className="tabular-nums">{text(record, 'Executed At')}</span> },
  {
    header: 'Response',
    cell: (record) => (
      <span className="block max-w-xs truncate font-mono text-xs" title={text(record, 'Response')}>
        {text(record, 'Response')}
      </span>
    ),
  },
]

export function Schedules() {
  const { records, error, loading, reload } = useRecords('schedule', {
    fields: 'Campaign Id,Name (from Linked Campaign),Type,Execute,Scheduled At,Status,Source,Executed At,Response',
  })
  const [tab, setTab] = useState('upcoming')
  const [scheduling, setScheduling] = useState(false)
  // the pending action being cancelled, while the question is open
  const [cancelling, setCancelling] = useState<ApiRecord>()
  // the backend lets only admins delete a scheduled action
  const admin = useAuth().user?.role === 'admin'

  const upcomingColumns: Column<ApiRecord>[] = admin
    ? [
        ...COLUMNS,
        {
          header: '',
          key: 'cancel',
          align: 'right',
          cell: (record) => (
            <Tip label="Cancel this action">
              <button
                onClick={() => setCancelling(record)}
                aria-label={`Cancel the ${text(record, 'Type').toLowerCase()} for ${campaignName(record) || text(record, 'Campaign Id')}`}
                className={button.icon}
              >
                <Trash2 className="size-4" />
              </button>
            </Tip>
          ),
        },
      ]
    : COLUMNS

  // soonest first for what is still to run, latest first for what already has
  const upcoming = (records ?? [])
    .filter((record) => text(record, 'Status') === 'Pending')
    .sort((a, b) => text(a, 'Scheduled At').localeCompare(text(b, 'Scheduled At')))
  const log = (records ?? [])
    .filter((record) => text(record, 'Status') !== 'Pending')
    .sort((a, b) => text(b, 'Scheduled At').localeCompare(text(a, 'Scheduled At')))

  const trigger =
    '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=active]:border-blue-700 data-[state=active]:text-blue-800'
  const empty = (none: string) => (error ? `Could not load schedules: ${error}` : records ? none : 'Loading…')

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
          <p className="mt-1 text-sm text-neutral-600">Budget and status changes queued for Facebook campaigns.</p>
        </div>
        <div className="flex items-center gap-2">
          <Tip label="Refresh">
            <button onClick={reload} disabled={loading} aria-label="Refresh" className={button.icon}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tip>
          <button onClick={() => setScheduling(true)} className={button.primary}>
            <Plus className="size-4" />
            Schedule Action
          </button>
        </div>
      </div>

      <Tabs.Root value={tab} onValueChange={setTab} className="mt-6">
        <Tabs.List aria-label="Schedules" className="flex gap-1 border-b border-neutral-200">
          <Tabs.Trigger value="upcoming" className={trigger}>
            Upcoming ({upcoming.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="log" className={trigger}>
            Log ({log.length})
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="upcoming" className="pt-4 outline-none">
          <DataTable
            columns={upcomingColumns}
            rows={upcoming}
            rowKey={(record) => record.id}
            empty={empty('No actions are scheduled.')}
            emptyIsError={Boolean(error)}
          />
        </Tabs.Content>
        <Tabs.Content value="log" className="pt-4 outline-none">
          <DataTable
            columns={LOG_COLUMNS}
            rows={log}
            rowKey={(record) => record.id}
            empty={empty('No actions have run yet.')}
            emptyIsError={Boolean(error)}
          />
        </Tabs.Content>
      </Tabs.Root>

      {scheduling && (
        <ScheduleDialog
          onClose={() => setScheduling(false)}
          onScheduled={() => {
            setScheduling(false)
            setTab('upcoming')
            reload()
          }}
        />
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancel this scheduled action?"
          confirmLabel="Cancel action"
          cancelLabel="Keep it"
          onClose={() => setCancelling(undefined)}
          onConfirm={async () => {
            // there is no cancelled status: a cancelled action is removed, as it always was
            await api(`/data/schedule/${cancelling.id}`, { method: 'DELETE' })
            setCancelling(undefined)
            reload()
          }}
        >
          {text(cancelling, 'Type')} to {execute(cancelling)} for {campaignName(cancelling) || `campaign ${text(cancelling, 'Campaign Id')}`} on{' '}
          {text(cancelling, 'Scheduled At')} will not run. It is removed and cannot be brought back.
        </ConfirmDialog>
      )}
    </>
  )
}
