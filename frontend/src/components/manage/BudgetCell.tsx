import { Check, Pencil, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { button, Tip } from '../ui'

interface Props {
  campaign: { id: string; name: string; daily_budget?: string; lifetime_budget?: string }
  // whose token changes the budget on Facebook
  cred: string
  // our record of the campaign, kept in step with Facebook when there is one
  recordId?: string
  // the budget changed; the list should be read again
  onSaved: () => void
}

const dollars = (amount: number) => amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

// A campaign's budget, and for a daily budget an edit button that turns it into a box.
// The new amount takes effect on Facebook as soon as it is saved.
export function BudgetCell({ campaign, cred, recordId, onSaved }: Props) {
  const cents = Number(campaign.daily_budget) || 0
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (!cents) {
    if (Number(campaign.lifetime_budget)) {
      return <span className="tabular-nums">{dollars(Number(campaign.lifetime_budget) / 100)} lifetime</span>
    }
    // the budget is then set on each ad set, not here
    return <span className="text-neutral-400">On ad sets</span>
  }

  function start() {
    setValue((cents / 100).toFixed(2))
    setError(undefined)
    setEditing(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const next = Math.round(Number(value) * 100)
    if (!Number.isFinite(next) || next <= 0) {
      setError('Enter an amount above $0.')
      return
    }
    if (next === cents) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await api(`/facebook/campaigns/${campaign.id}`, { method: 'PATCH', body: { cred, dailyBudgetCents: next } })
      // Facebook has the new budget; our own copy is only kept in step, so a failure here is not the user's problem
      if (recordId) await api(`/data/campaigns/${recordId}`, { method: 'PATCH', body: { fields: { Budget: next / 100 } } }).catch(() => undefined)
      setEditing(false)
      onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        <span className="tabular-nums">{dollars(cents / 100)} / day</span>
        <Tip label="Change the daily budget">
          <button aria-label={`Change the daily budget of ${campaign.name}`} onClick={start} className={`${button.icon} -my-1 size-7`}>
            <Pencil className="size-3.5" />
          </button>
        </Tip>
      </span>
    )
  }

  return (
    <form onSubmit={save} className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1">
        <span className="relative">
          <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-sm text-neutral-500">$</span>
          <input
            autoFocus
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            aria-label={`New daily budget for ${campaign.name}, in dollars`}
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
            }}
            className="h-8 w-28 rounded-md border border-neutral-300 bg-white pr-2 pl-5 text-right text-sm tabular-nums outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
          />
        </span>
        <Tip label="Save to Facebook">
          <button type="submit" aria-label="Save the new budget" disabled={busy} className={`${button.icon} size-8 text-emerald-700`}>
            <Check className="size-4" />
          </button>
        </Tip>
        <Tip label="Cancel">
          <button type="button" aria-label="Cancel" disabled={busy} onClick={() => setEditing(false)} className={`${button.icon} size-8`}>
            <X className="size-4" />
          </button>
        </Tip>
      </span>
      {busy && <span className="text-xs text-neutral-500">Saving to Facebook…</span>}
      {error && (
        <span role="alert" className="max-w-56 text-right text-xs whitespace-normal text-red-700">
          {error}
        </span>
      )}
    </form>
  )
}
