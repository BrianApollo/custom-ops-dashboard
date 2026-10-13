import { X } from 'lucide-react'
import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { api, text, type ApiRecord } from '../../lib/api'
import { button, Combobox, input, Select } from '../ui'
import {
  BUDGET_ACTIONS,
  buildIf,
  buildThen,
  campaignIds,
  CHECK_AT,
  formOf,
  MAX_DAYS,
  OPERATORS,
  RULE_TYPES,
  SCOPES,
  UNSUPPORTED_TYPE,
  type ActionKind,
  type RuleForm,
} from './ruleText'

interface Props {
  // the rule being edited; none for a new rule
  rule?: ApiRecord
  // the scope a new rule starts with
  scope: string
  // every campaign, to name the ones a rule already links to
  campaigns: ApiRecord[]
  onClose: () => void
  onSaved: () => void
}

const number = `${input} w-24 tabular-nums`

export function RuleDialog({ rule, campaigns, onClose, onSaved, ...props }: Props) {
  const [name, setName] = useState(rule ? text(rule, 'Name') : '')
  const [scope, setScope] = useState(rule ? text(rule, 'Rule Scope') || SCOPES[0] : props.scope)
  const [appliesTo, setAppliesTo] = useState(rule ? campaignIds(rule) : [])
  const [form, setForm] = useState<RuleForm>(() => formOf(rule))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const scoped = scope === 'Scoped'
  const type = form.action === 'off' ? 'Status Change' : 'Budget Change'
  const condition = buildIf(form)
  const action = buildThen(form)
  const problem = !name.trim()
    ? 'Give the rule a name.'
    : scoped && appliesTo.length === 0
      ? 'Choose at least one campaign, or make the rule global.'
      : (condition.error ?? action.error)

  const names = new Map(campaigns.map((campaign) => [campaign.id, text(campaign, 'Name') || text(campaign, 'FB Campaign ID') || campaign.id]))
  // the job only acts on campaigns that are live on Facebook, so only launched ones are offered
  const options = campaigns
    .filter((campaign) => text(campaign, 'FB Campaign ID') && !appliesTo.includes(campaign.id))
    .map((campaign) => ({ value: campaign.id, label: `${names.get(campaign.id)} (${text(campaign, 'FB Campaign ID')})` }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const set = (changes: Partial<RuleForm>) => setForm((current) => ({ ...current, ...changes }))

  function setType(next: string) {
    if (next === type) return
    set(next === 'Status Change' ? { action: 'off' } : { action: 'increase', amount: '2' })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (problem) return
    setBusy(true)
    setError(undefined)
    const fields = {
      Name: name.trim(),
      'Rule Scope': scope,
      Select: type,
      'Check At': CHECK_AT,
      If: condition.text,
      Then: action.text,
      'Execute Action At': CHECK_AT,
      // record ids of the linked campaigns; a global rule has none
      'Applies to [Campaigns]': scoped ? appliesTo : [],
    }
    try {
      if (rule) await api(`/data/scaling_rules/${rule.id}`, { method: 'PATCH', body: { fields } })
      else await api('/data/scaling_rules', { method: 'POST', body: { fields } })
      onSaved()
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
          className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
        >
          <Dialog.Title className="text-base font-semibold">{rule ? 'Edit rule' : 'Add rule'}</Dialog.Title>
          <form onSubmit={submit} className="mt-5 space-y-4">
            {rule && text(rule, 'Select') === UNSUPPORTED_TYPE && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                This rule was saved as "{UNSUPPORTED_TYPE}", which the scheduled job cannot run. Saving replaces it with the rule below.
              </p>
            )}

            <div>
              <Label.Root htmlFor="rule-name" className="text-sm font-medium">
                Rule name
              </Label.Root>
              <input id="rule-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1.5`} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label.Root htmlFor="rule-scope" className="text-sm font-medium">
                  Scope
                </Label.Root>
                <Select
                  id="rule-scope"
                  value={scope}
                  options={[
                    { value: 'Global', label: 'Global (every active campaign)' },
                    { value: 'Scoped', label: 'Scoped (chosen campaigns)' },
                  ]}
                  onValueChange={setScope}
                  className="mt-1.5 h-9 w-full"
                />
              </div>
              <div>
                <Label.Root htmlFor="rule-type" className="text-sm font-medium">
                  Rule type
                </Label.Root>
                <Select id="rule-type" value={type} options={RULE_TYPES} onValueChange={setType} className="mt-1.5 h-9 w-full" />
              </div>
            </div>

            {scoped && (
              <div>
                <Label.Root htmlFor="rule-campaign" className="text-sm font-medium">
                  Applies to
                </Label.Root>
                <Combobox
                  id="rule-campaign"
                  value=""
                  options={options}
                  placeholder="Add a campaign…"
                  noun="campaigns"
                  onValueChange={(id) => id && setAppliesTo([...appliesTo, id])}
                  className="mt-1.5 h-9"
                />
                {appliesTo.length > 0 && (
                  <ul aria-label="Campaigns this rule applies to" className="mt-2 flex flex-wrap gap-1.5">
                    {appliesTo.map((id) => (
                      <li key={id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-neutral-100 py-0.5 pr-1 pl-2 text-xs text-neutral-800">
                        <span className="truncate">{names.get(id) ?? id}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${names.get(id) ?? id}`}
                          onClick={() => setAppliesTo(appliesTo.filter((other) => other !== id))}
                          className="flex size-5 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700"
                        >
                          <X className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <fieldset>
              <legend className="text-sm font-medium">If</legend>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                <span>ROAS is</span>
                <Select label="Comparison" value={form.operator} options={OPERATORS} onValueChange={(operator) => set({ operator })} className="h-9" />
                <input
                  aria-label="ROAS"
                  type="number"
                  min={0}
                  step={0.1}
                  required
                  inputMode="decimal"
                  value={form.value}
                  onChange={(e) => set({ value: e.target.value })}
                  className={number}
                />
                <span>for</span>
                <input
                  aria-label="Days"
                  type="number"
                  min={1}
                  max={MAX_DAYS}
                  step={1}
                  required
                  inputMode="numeric"
                  value={form.days}
                  onChange={(e) => set({ days: e.target.value })}
                  className={number}
                />
                <span>days</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Facebook's purchase ROAS must be strictly {form.operator} this on every one of those days, ending yesterday. A day with no data
                does not count.
              </p>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium">Then</legend>
              {form.action === 'off' ? (
                <p className="mt-1.5 text-sm">Turn off the campaign (it is paused on Facebook).</p>
              ) : (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
                  <Select
                    label="Action"
                    value={form.action}
                    options={BUDGET_ACTIONS}
                    // each action has its own unit, so the amount starts again from that action's usual value
                    onValueChange={(next) => set({ action: next as ActionKind, amount: next === 'increase' ? '2' : '50' })}
                    className="h-9"
                  />
                  <input
                    aria-label={form.action === 'increase' ? 'Multiplier' : 'Percent'}
                    type="number"
                    min={0}
                    step={form.action === 'increase' ? 0.5 : 5}
                    required
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(e) => set({ amount: e.target.value })}
                    className={number}
                  />
                  <span>{BUDGET_ACTIONS.find((option) => option.value === form.action)?.suffix}</span>
                </div>
              )}
              <p className="mt-1 text-xs text-neutral-500">
                {form.action === 'off'
                  ? 'Nothing turns the campaign back on.'
                  : 'Changes the daily budget; campaigns without one are skipped. A budget is never reduced below $1.'}
              </p>
            </fieldset>

            <p className="rounded-md bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
              Checked every night at midnight (GMT+7), and the action is applied straight away.
              {condition.text && action.text && (
                <span className="mt-1 block font-mono text-neutral-800">
                  {condition.text} → {action.text}
                </span>
              )}
            </p>

            {(error || problem) && (
              <p role={error ? 'alert' : undefined} className={`text-sm ${error ? 'text-red-700' : 'text-neutral-600'}`}>
                {error ?? problem}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close type="button" className={button.secondary}>
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy || Boolean(problem)} className={button.primary}>
                {busy ? 'Saving…' : rule ? 'Save changes' : 'Create rule'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
