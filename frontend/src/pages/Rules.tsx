import { Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useState } from 'react'
import { useAuth } from '../auth'
import { DataTable, type Column } from '../components/DataTable'
import { ConfirmDialog } from '../components/rules/ConfirmDialog'
import { RuleDialog } from '../components/rules/RuleDialog'
import { RuleLog } from '../components/rules/RuleLog'
import { campaignIds, problem } from '../components/rules/ruleText'
import { button, Tip } from '../components/ui'
import { useFetch, useRecords } from '../data'
import { api, text, type ApiRecord } from '../lib/api'

// the log grows by one row per rule per night; the latest runs are what gets read
const LOG_LIMIT = 500
const LOG_PATH = `/data/rule_execution_log?${new URLSearchParams({ sort: '-Executed At', limit: String(LOG_LIMIT) })}`

const trigger =
  '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=active]:border-blue-700 data-[state=active]:text-blue-800'

export function Rules() {
  // the backend lets only admins read or change rules
  const admin = useAuth().user?.role === 'admin'
  const rules = useRecords('scaling_rules', {
    fields: 'Name,Rule Scope,Select,Check At,If,Then,Applies to [Campaigns]',
    sort: 'Name',
  })
  const campaigns = useRecords('campaigns', { fields: 'Name,FB Campaign ID' })
  const log = useFetch<{ records: ApiRecord[]; total: number }>(LOG_PATH)
  const [tab, setTab] = useState('Global')
  // a rule to edit, or 'new'
  const [editing, setEditing] = useState<ApiRecord | 'new'>()
  const [deleting, setDeleting] = useState<ApiRecord>()

  const campaignNames = new Map((campaigns.records ?? []).map((campaign) => [campaign.id, text(campaign, 'Name') || text(campaign, 'FB Campaign ID')]))
  // a rule with no scope is treated as global, as the scheduled job does
  const scoped = (rules.records ?? []).filter((rule) => text(rule, 'Rule Scope') === 'Scoped')
  const global = (rules.records ?? []).filter((rule) => text(rule, 'Rule Scope') !== 'Scoped')
  const loading = rules.loading || campaigns.loading || log.loading

  function reload() {
    rules.reload()
    campaigns.reload()
    log.reload()
  }

  const columns = (withCampaigns: boolean): Column<ApiRecord>[] => [
    {
      header: 'Name',
      cell: (rule) => {
        const issue = problem(rule)
        return (
          <>
            {text(rule, 'Name') || 'Unnamed rule'}
            {issue && (
              <span className="mt-0.5 flex items-start gap-1 text-xs font-normal text-amber-800">
                <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
                {issue}
              </span>
            )}
          </>
        )
      },
    },
    { header: 'Type', cell: (rule) => text(rule, 'Select') || '—' },
    ...(withCampaigns
      ? [
          {
            header: 'Applies to',
            cell: (rule: ApiRecord) => {
              const ids = campaignIds(rule)
              if (ids.length === 0) return <span className="text-neutral-400">—</span>
              return (
                <ul className="flex max-w-sm flex-wrap gap-1">
                  {ids.map((id) => (
                    <li key={id} className="max-w-full truncate rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-800">
                      {campaignNames.get(id) || (campaigns.records ? 'Deleted campaign' : '…')}
                    </li>
                  ))}
                </ul>
              )
            },
          },
        ]
      : []),
    { header: 'If', cell: (rule) => text(rule, 'If') || '—' },
    { header: 'Then', cell: (rule) => text(rule, 'Then') || '—' },
    { header: 'Checked at', cell: (rule) => text(rule, 'Check At') || '—' },
    ...(admin
      ? [
          {
            header: '',
            key: 'actions',
            align: 'right' as const,
            cell: (rule: ApiRecord) => (
              <span className="inline-flex gap-1">
                <Tip label="Edit">
                  <button onClick={() => setEditing(rule)} aria-label={`Edit ${text(rule, 'Name')}`} className={button.icon}>
                    <Pencil className="size-4" />
                  </button>
                </Tip>
                <Tip label="Delete">
                  <button onClick={() => setDeleting(rule)} aria-label={`Delete ${text(rule, 'Name')}`} className={button.icon}>
                    <Trash2 className="size-4" />
                  </button>
                </Tip>
              </span>
            ),
          },
        ]
      : []),
  ]

  const empty = (none: string) => (rules.error ? `Could not load rules: ${rules.error}` : rules.records ? none : 'Loading…')
  const logRecords = log.data?.records ?? []

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Scaling rules checked against Facebook ROAS every night at midnight (GMT+7). Every rule listed is live; delete a rule to stop it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tip label="Refresh">
            <button onClick={reload} disabled={loading} aria-label="Refresh" className={button.icon}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tip>
          {admin && tab !== 'log' && (
            <button onClick={() => setEditing('new')} className={button.primary}>
              <Plus className="size-4" />
              Add Rule
            </button>
          )}
        </div>
      </div>

      <Tabs.Root value={tab} onValueChange={setTab} className="mt-6">
        <Tabs.List aria-label="Rules" className="flex gap-1 border-b border-neutral-200">
          <Tabs.Trigger value="Global" className={trigger}>
            Global Rules ({global.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="Scoped" className={trigger}>
            Scoped Rules ({scoped.length})
          </Tabs.Trigger>
          <Tabs.Trigger value="log" className={trigger}>
            Log{log.data ? ` (${log.data.total.toLocaleString()})` : ''}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="Global" className="pt-4 outline-none">
          <DataTable
            columns={columns(false)}
            rows={global}
            rowKey={(rule) => rule.id}
            empty={empty('No global rules yet.')}
            emptyIsError={Boolean(rules.error)}
          />
        </Tabs.Content>
        <Tabs.Content value="Scoped" className="pt-4 outline-none">
          <DataTable
            columns={columns(true)}
            rows={scoped}
            rowKey={(rule) => rule.id}
            empty={empty('No scoped rules yet.')}
            emptyIsError={Boolean(rules.error)}
          />
        </Tabs.Content>
        <Tabs.Content value="log" className="pt-4 outline-none">
          <RuleLog
            records={logRecords}
            empty={log.error ? `Could not load the log: ${log.error.message}` : log.data ? 'No rule has run yet.' : 'Loading…'}
            emptyIsError={Boolean(log.error)}
          />
          {log.data && log.data.total > logRecords.length && (
            <p className="mt-2 text-xs text-neutral-500">
              Showing the latest {logRecords.length.toLocaleString()} of {log.data.total.toLocaleString()} runs.
            </p>
          )}
        </Tabs.Content>
      </Tabs.Root>

      {editing && (
        <RuleDialog
          rule={editing === 'new' ? undefined : editing}
          scope={tab === 'Scoped' ? 'Scoped' : 'Global'}
          campaigns={campaigns.records ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined)
            rules.reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete ${text(deleting, 'Name') || 'this rule'}?`}
          confirmLabel="Delete"
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            await api(`/data/scaling_rules/${deleting.id}`, { method: 'DELETE' })
            setDeleting(undefined)
            rules.reload()
          }}
        >
          The rule stops running and cannot be brought back. Its past runs stay in the log.
        </ConfirmDialog>
      )}
    </>
  )
}
