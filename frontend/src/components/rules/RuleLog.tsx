import { DataTable, type Column } from '../DataTable'
import { StatusBadge } from '../ui'
import { text, type ApiRecord } from '../../lib/api'

// One entry of `Actions Taken`, as the scheduled job writes it (rule-types.ts, ActionResult)
interface ActionTaken {
  campaignId?: string
  campaignName?: string
  action?: string
  // a daily budget in cents, or a campaign status
  previousValue?: number | string
  newValue?: number | string
  success?: boolean
  error?: string
}

const ACTION_LABELS: Record<string, string> = {
  increase_budget: 'Increase budget',
  reduce_budget: 'Reduce budget',
  set_max_budget: 'Cap budget',
  turn_off: 'Turn off',
}

const amount = (value: number | string | undefined) =>
  typeof value === 'number' ? `$${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : (value ?? '—')

// The job has written both a bare date and a full UTC timestamp here
function when(value: string) {
  if (!value.includes('T')) return value
  return `${value.slice(0, 16).replace('T', ' ')}${/Z$/.test(value) ? ' UTC' : ''}`
}

function actionsOf(record: ApiRecord): ActionTaken[] | null {
  const raw = text(record, 'Actions Taken')
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ActionTaken[]) : null
  } catch {
    return null
  }
}

const count = (field: string) => (record: ApiRecord) => <span className="tabular-nums">{text(record, field) || '0'}</span>

const COLUMNS: Column<ApiRecord>[] = [
  { header: 'Executed', cell: (record) => <span className="tabular-nums">{when(text(record, 'Executed At')) || '—'}</span> },
  { header: 'Rule', cell: (record) => text(record, 'Rule Name') || 'Unnamed rule' },
  { header: 'Result', cell: (record) => <StatusBadge status={text(record, 'Status')} /> },
  { header: 'Campaigns checked', align: 'right', cell: count('Campaigns Evaluated') },
  { header: 'Matched', align: 'right', cell: count('Campaigns Matched') },
  {
    header: 'Duration',
    align: 'right',
    cell: (record) => <span className="tabular-nums">{text(record, 'Duration (ms)') ? `${Number(text(record, 'Duration (ms)')).toLocaleString()} ms` : '—'}</span>,
  },
]

function Details({ record }: { record: ApiRecord }) {
  const actions = actionsOf(record)
  const error = text(record, 'Error')
  return (
    <div className="space-y-3 text-sm">
      {error && <p className="text-red-700">{error}</p>}
      {actions === null ? (
        <pre className="max-h-60 overflow-auto rounded-md bg-white p-3 font-mono text-xs whitespace-pre-wrap">{text(record, 'Actions Taken')}</pre>
      ) : actions.length === 0 ? (
        <p className="text-neutral-500">No action was taken on any campaign.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-xs tracking-wide text-neutral-600 uppercase">
            <tr>
              <th className="py-1.5 pr-4 font-medium">Campaign</th>
              <th className="py-1.5 pr-4 font-medium">Action</th>
              <th className="py-1.5 pr-4 font-medium">Before</th>
              <th className="py-1.5 pr-4 font-medium">After</th>
              <th className="py-1.5 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {actions.map((action, i) => (
              <tr key={`${action.campaignId}-${i}`}>
                <td className="py-1.5 pr-4">
                  {action.campaignName || 'Unknown campaign'}
                  <span className="block text-xs text-neutral-500 tabular-nums">{action.campaignId}</span>
                </td>
                <td className="py-1.5 pr-4">{ACTION_LABELS[action.action ?? ''] ?? action.action ?? '—'}</td>
                <td className="py-1.5 pr-4 tabular-nums">{amount(action.previousValue)}</td>
                {/* a failed change was never applied, so its target is not shown as the result */}
                <td className="py-1.5 pr-4 tabular-nums">{action.success ? amount(action.newValue) : '—'}</td>
                <td className="py-1.5">
                  <StatusBadge status={action.success ? 'Success' : 'Failed'} />
                  {action.error && <span className="mt-0.5 block text-xs text-red-700">{action.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// What the scheduled job recorded for each run of each rule, latest first
export function RuleLog({ records, empty, emptyIsError }: { records: ApiRecord[]; empty: string; emptyIsError: boolean }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={records}
      rowKey={(record) => record.id}
      empty={empty}
      emptyIsError={emptyIsError}
      expand={(record) => <Details record={record} />}
    />
  )
}
