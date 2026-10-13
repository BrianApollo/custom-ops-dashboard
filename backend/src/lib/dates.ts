// Calendar dates as the team sees them, not as UTC does: at 03:00 in Bangkok
// the UTC date is still yesterday.

const DAY_MS = 86_400_000

export function today(timeZone: string, now = new Date()) {
  // en-CA formats a date as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

export const RANGE_PRESETS = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_30d'] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

// The same days Facebook means by these names: `last_7d` is the seven full
// days ending yesterday, so figures from both sources cover the same period.
export function presetRange(preset: RangePreset, timeZone: string, now = new Date()) {
  const date = today(timeZone, now)
  if (preset === 'today') return { dateFrom: date, dateTo: date }
  if (preset === 'yesterday') return { dateFrom: addDays(date, -1), dateTo: addDays(date, -1) }
  const days = Number(preset.slice(5, -1))
  return { dateFrom: addDays(date, -days), dateTo: addDays(date, -1) }
}
