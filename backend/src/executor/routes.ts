import { Router } from 'express'
import { currentUser } from '../auth/session'
import { forbidden, invalid } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { isAdmin } from '../permissions'
import { runScheduledActions } from './actions'
import { runScalingRules } from './rules'

// Runs the nightly work on demand. `?dry=true` on the rule routes records what
// would happen without changing anything on Facebook.
export const executorRouter = Router()

executorRouter.use((_req, res, next) => {
  const { role } = currentUser(res)
  if (!isAdmin(role) && role !== 'service') throw forbidden()
  next()
})

const dry = (value: unknown) => value === 'true' || value === '1'

executorRouter.post('/run-actions', async (_req, res) => {
  res.json(await runScheduledActions())
})

executorRouter.post('/run-rules', async (req, res) => {
  res.json(await runScalingRules({ dryRun: dry(req.query.dry) }))
})

executorRouter.post('/run-rules/:id', async (req, res) => {
  if (!RECORD_ID.test(req.params.id)) throw invalid('Not a record id', 'id')
  res.json(await runScalingRules({ ruleId: req.params.id, dryRun: dry(req.query.dry) }))
})
