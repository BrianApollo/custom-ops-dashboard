import { describe, expect, it } from 'vitest'
import { budgetNeedsConfirm, MAX_DAILY_BUDGET_CENTS } from '../src/facebook/budget'

describe('budgetNeedsConfirm', () => {
  it('passes $500 a day exactly', () => {
    expect(MAX_DAILY_BUDGET_CENTS).toBe(50_000)
    expect(budgetNeedsConfirm(50_000, undefined)).toBe(false)
    expect(budgetNeedsConfirm(100, undefined)).toBe(false)
  })

  it('refuses 50,001 cents without the flag', () => {
    expect(budgetNeedsConfirm(50_001, undefined)).toBe(true)
    expect(budgetNeedsConfirm(300_000, false)).toBe(true)
  })

  it('accepts only a literal true as the flag', () => {
    expect(budgetNeedsConfirm(50_001, true)).toBe(false)
    for (const flag of ['true', 1, 'yes', {}, null]) expect(budgetNeedsConfirm(50_001, flag)).toBe(true)
  })
})
