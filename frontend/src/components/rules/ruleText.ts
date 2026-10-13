import { text, type ApiRecord } from '../../lib/api'

// A rule's condition and action are stored as English sentences in `If` and `Then`.
// The scheduled job (workers/scheduled-executor/src/rule-types.ts, parseCondition and
// parseAction) reads them back with exactly these patterns, and a rule whose text
// matches none of them fails every night with "no parseable condition or action":
//
//   If:    raw.match(/roas\s+is\s+(over|under)\s+([\d.]+)\s+for\s+(\d+)\s+day/i)
//   Then:  raw.toLowerCase().trim() === 'turn off'
//          raw.match(/increase\s+budget\s+by\s+([\d.]+)x/i)
//          raw.match(/reduce\s+by\s+([\d.]+)%/i)
//
// The numbers go through parseFloat / parseInt, so they must be plain digits with at
// most one decimal point: no sign, no exponent, no thousands separator.
// There is no pattern for a dollar amount, which is why "Maximum Global Budget" is not offered.
const IF_PATTERN = /roas\s+is\s+(over|under)\s+([\d.]+)\s+for\s+(\d+)\s+day/i
const INCREASE_PATTERN = /increase\s+budget\s+by\s+([\d.]+)x/i
const REDUCE_PATTERN = /reduce\s+by\s+([\d.]+)%/i
const TURN_OFF = 'Turn Off'

export const SCOPES = ['Global', 'Scoped']
// `Select` in the table. The job also knows 'Maximum Global Budget' but cannot read its amount.
export const RULE_TYPES = ['Budget Change', 'Status Change']
export const UNSUPPORTED_TYPE = 'Maximum Global Budget'
export const OPERATORS = ['over', 'under']
// the only time the job checks rules; it applies the action in the same run
export const CHECK_AT = 'Midnight'
export const MAX_DAYS = 365

export type ActionKind = 'increase' | 'reduce' | 'off'

export const BUDGET_ACTIONS: { value: ActionKind; label: string; suffix: string }[] = [
  { value: 'increase', label: 'Increase budget by', suffix: 'x' },
  { value: 'reduce', label: 'Reduce budget by', suffix: '%' },
]

export interface RuleForm {
  operator: string
  // as typed
  value: string
  days: string
  action: ActionKind
  amount: string
}

export const DEFAULT_FORM: RuleForm = { operator: 'over', value: '1', days: '3', action: 'increase', amount: '2' }

// What was typed as the digits the job's parseFloat reads back unchanged, or null.
// String(1e-7) is '1e-7' and String(1e21) is '1e+21', so those are refused here.
function decimal(raw: string) {
  const out = String(Number(raw.trim()))
  return raw.trim() !== '' && /^\d+(\.\d+)?$/.test(out) ? out : null
}

// The `If` sentence, or what is wrong with the numbers
export function buildIf(form: RuleForm): { text?: string; error?: string } {
  const value = decimal(form.value)
  if (value === null) return { error: 'ROAS must be a number of 0 or more.' }
  const days = Number(form.days.trim())
  if (!/^\d+$/.test(form.days.trim()) || days < 1 || days > MAX_DAYS) {
    return { error: `Days must be a whole number from 1 to ${MAX_DAYS}.` }
  }
  return { text: `Roas is ${form.operator === 'under' ? 'under' : 'over'} ${value} for ${days} days` }
}

// The `Then` sentence, or what is wrong with the amount
export function buildThen(form: RuleForm): { text?: string; error?: string } {
  if (form.action === 'off') return { text: TURN_OFF }
  const amount = decimal(form.amount)
  // the job replaces a zero amount with its own default (2x or 50%), so zero is never written
  if (form.action === 'increase') {
    if (amount === null || Number(amount) <= 1) return { error: 'The multiplier must be more than 1 (2 doubles the budget).' }
    return { text: `Increase Budget by ${amount}x` }
  }
  if (amount === null || Number(amount) <= 0 || Number(amount) > 100) return { error: 'The reduction must be more than 0 and at most 100 percent.' }
  return { text: `Reduce by ${amount}%` }
}

// The job tests 'turn off' first, then the increase pattern, then the reduce pattern
function parseThen(raw: string): Pick<RuleForm, 'action' | 'amount'> | null {
  if (raw.toLowerCase().trim() === 'turn off') return { action: 'off', amount: '' }
  const increase = raw.match(INCREASE_PATTERN)
  if (increase) return { action: 'increase', amount: increase[1] }
  const reduce = raw.match(REDUCE_PATTERN)
  if (reduce) return { action: 'reduce', amount: reduce[1] }
  return null
}

// A saved rule as form values; parts the job could not read fall back to the defaults
export function formOf(record: ApiRecord | undefined): RuleForm {
  if (!record) return DEFAULT_FORM
  const condition = text(record, 'If').match(IF_PATTERN)
  return {
    ...DEFAULT_FORM,
    ...(condition && { operator: condition[1].toLowerCase(), value: condition[2], days: condition[3] }),
    ...parseThen(text(record, 'Then')),
  }
}

export const campaignIds = (record: ApiRecord) => (record.fields['Applies to [Campaigns]'] as string[] | undefined) ?? []

// Why the scheduled job would fail on, or never act on, this rule; undefined when it can run
export function problem(record: ApiRecord): string | undefined {
  if (text(record, 'Select') === UNSUPPORTED_TYPE) return 'The scheduled job cannot read a maximum budget amount, so this rule fails every run.'
  const condition = text(record, 'If').match(IF_PATTERN)
  if (!condition || Number.isNaN(parseFloat(condition[2]))) return 'The scheduled job cannot read this condition.'
  if (!parseThen(text(record, 'Then'))) return 'The scheduled job cannot read this action.'
  if (text(record, 'Rule Scope') === 'Scoped' && campaignIds(record).length === 0) return 'No campaigns are chosen, so this rule applies to nothing.'
  return undefined
}
