import { describe, expect, it } from 'vitest'
import { MIN_BUDGET, newBudget, parseAction, parseCondition, roasMatches } from '../src/executor/ruleText'

describe('parseCondition', () => {
  it('reads the sentence the Rules page writes', () => {
    expect(parseCondition('ROAS is under 1.5 for 3 days')).toEqual({ operator: 'under', value: 1.5, days: 3 })
    expect(parseCondition('If roas is OVER 2 for 1 day')).toEqual({ operator: 'over', value: 2, days: 1 })
  })

  it('rejects invalid input', () => {
    expect(parseCondition('ROAS is above 1.5 for 3 days')).toBeNull()
    expect(parseCondition('ROAS is under 1.5 for 0 days')).toBeNull()
    expect(parseCondition('ROAS is under 1.5')).toBeNull()
    expect(parseCondition('')).toBeNull()
    expect(parseCondition(null)).toBeNull()
    expect(parseCondition(42)).toBeNull()
  })

  it('accepts a value that only parseFloat can make sense of', () => {
    // characterisation: `[\d.]+` lets "1.2.3" through and parseFloat reads 1.2
    expect(parseCondition('ROAS is over 1.2.3 for 2 days')).toEqual({ operator: 'over', value: 1.2, days: 2 })
  })
})

describe('parseAction', () => {
  it('reads turn off, case-insensitively, as the whole text', () => {
    expect(parseAction('Turn Off')).toEqual({ type: 'turn_off' })
    expect(parseAction('  turn off  ')).toEqual({ type: 'turn_off' })
    expect(parseAction('turn off now')).toBeNull()
  })

  it('reads budget increases', () => {
    expect(parseAction('Increase budget by 1.5x')).toEqual({ type: 'increase_budget', value: 1.5 })
    expect(parseAction('increase budget by 0x')).toBeNull()
  })

  it('reads budget reductions between 0 and 100 percent', () => {
    expect(parseAction('Reduce by 20%')).toEqual({ type: 'reduce_budget', value: 20 })
    expect(parseAction('reduce by 100%')).toBeNull()
    expect(parseAction('reduce by 0%')).toBeNull()
  })

  it('rejects anything else', () => {
    expect(parseAction('pause it')).toBeNull()
    expect(parseAction('')).toBeNull()
    expect(parseAction(undefined)).toBeNull()
  })
})

describe('roasMatches', () => {
  const dates = ['2026-01-01', '2026-01-02']
  const over = { operator: 'over' as const, value: 1, days: 2 }
  const under = { operator: 'under' as const, value: 1, days: 2 }

  it('needs every day to pass', () => {
    const daily = new Map([
      ['2026-01-01', 1.5],
      ['2026-01-02', 2],
    ])
    expect(roasMatches(over, daily, dates)).toBe(true)
    expect(roasMatches(under, daily, dates)).toBe(false)
  })

  it('compares strictly', () => {
    const daily = new Map([
      ['2026-01-01', 1],
      ['2026-01-02', 1],
    ])
    expect(roasMatches(over, daily, dates)).toBe(false)
    expect(roasMatches(under, daily, dates)).toBe(false)
  })

  it('is false when a day or the whole map is missing', () => {
    expect(roasMatches(over, new Map([['2026-01-01', 5]]), dates)).toBe(false)
    expect(roasMatches(over, undefined, dates)).toBe(false)
  })

  it('is true for an empty date list when data exists', () => {
    expect(roasMatches(over, new Map(), [])).toBe(true)
  })
})

describe('newBudget', () => {
  it('multiplies and rounds on increase', () => {
    expect(newBudget(1000, { type: 'increase_budget', value: 1.5 })).toBe(1500)
    expect(newBudget(333, { type: 'increase_budget', value: 1.5 })).toBe(500)
  })

  it('reduces by a percentage but never below MIN_BUDGET', () => {
    expect(MIN_BUDGET).toBe(100)
    expect(newBudget(1000, { type: 'reduce_budget', value: 20 })).toBe(800)
    expect(newBudget(110, { type: 'reduce_budget', value: 50 })).toBe(MIN_BUDGET)
  })

  it('returns null for turn off', () => {
    expect(newBudget(1000, { type: 'turn_off' })).toBeNull()
  })
})
