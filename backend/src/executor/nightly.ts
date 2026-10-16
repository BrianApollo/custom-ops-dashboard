import { runScheduledActions } from './actions'
import { runScalingRules } from './rules'

// The cron run at midnight team time (wrangler.template.jsonc). Scheduled
// actions go first, so a rule sees the budgets people asked for. A failure in
// one part does not stop the other.
export async function runNightly() {
  try {
    await runScheduledActions()
  } catch (error) {
    console.error('[executor] scheduled actions did not run:', error)
  }
  try {
    await runScalingRules()
  } catch (error) {
    console.error('[executor] scaling rules did not run:', error)
  }
}
