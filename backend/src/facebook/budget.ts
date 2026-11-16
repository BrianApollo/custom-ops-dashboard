// A daily budget above this many cents needs an explicit confirmation from the
// launcher, so a typed extra zero is caught before Facebook spends it
export const MAX_DAILY_BUDGET_CENTS = 50_000

export const BUDGET_CONFIRM_MESSAGE = 'Daily budget is above $500. Confirm it to launch.'

export const budgetNeedsConfirm = (dailyBudgetCents: number, allowHighBudget: unknown) =>
  dailyBudgetCents > MAX_DAILY_BUDGET_CENTS && allowHighBudget !== true
