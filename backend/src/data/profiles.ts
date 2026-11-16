import { forbidden } from '../lib/errors'
import type { WritePlan } from './write'

// Profile Hub rule: what a profile arrived with (`Original Data`) is written
// once. The first write stamps `received_locked_at`; after that neither field
// can be changed through the data routes, so the Received column stays what
// the supplier delivered while the live credentials are rotated.

export const RECEIVED_COLUMNS = ['original_data', 'received_locked_at']

export function lockReceived(plan: WritePlan, lockedAt: unknown, now: string) {
  const touches = RECEIVED_COLUMNS.filter((column) => column in plan.columns)
  if (touches.length === 0) return
  if (lockedAt) throw forbidden('The received data is locked and cannot be changed', 'Original Data')
  if (plan.columns.original_data) plan.columns.received_locked_at = now
}
