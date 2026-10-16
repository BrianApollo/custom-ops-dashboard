// A rule's condition and action are English sentences in `If` and `Then`.
// The Rules page writes them with the same patterns
// (frontend/src/components/rules/ruleText.ts); change both together.

export interface Condition {
  operator: 'over' | 'under'
  value: number
  days: number
}

export type Action = { type: 'turn_off' } | { type: 'increase_budget'; value: number } | { type: 'reduce_budget'; value: number }

const IF_PATTERN = /roas\s+is\s+(over|under)\s+([\d.]+)\s+for\s+(\d+)\s+day/i
const INCREASE_PATTERN = /increase\s+budget\s+by\s+([\d.]+)x/i
const REDUCE_PATTERN = /reduce\s+by\s+([\d.]+)%/i

// cents; Facebook refuses a daily budget below about $1
export const MIN_BUDGET = 100

export function parseCondition(raw: unknown): Condition | null {
  const match = typeof raw === 'string' ? raw.match(IF_PATTERN) : null
  if (!match) return null
  const value = parseFloat(match[2])
  const days = parseInt(match[3], 10)
  if (!Number.isFinite(value) || days < 1) return null
  return { operator: match[1].toLowerCase() as Condition['operator'], value, days }
}

export function parseAction(raw: unknown): Action | null {
  if (typeof raw !== 'string') return null
  if (raw.trim().toLowerCase() === 'turn off') return { type: 'turn_off' }
  const increase = raw.match(INCREASE_PATTERN)
  if (increase) {
    const value = parseFloat(increase[1])
    return value > 0 ? { type: 'increase_budget', value } : null
  }
  const reduce = raw.match(REDUCE_PATTERN)
  if (reduce) {
    const value = parseFloat(reduce[1])
    return value > 0 && value < 100 ? { type: 'reduce_budget', value } : null
  }
  return null
}

// true only when every day has data and passes the threshold
export function roasMatches(condition: Condition, daily: Map<string, number> | undefined, dates: string[]) {
  if (!daily) return false
  return dates.every((date) => {
    const roas = daily.get(date)
    if (roas === undefined) return false
    return condition.operator === 'over' ? roas > condition.value : roas < condition.value
  })
}

export function newBudget(currentCents: number, action: Action) {
  if (action.type === 'increase_budget') return Math.round(currentCents * action.value)
  if (action.type === 'reduce_budget') return Math.max(MIN_BUDGET, Math.round(currentCents * (1 - action.value / 100)))
  return null
}
