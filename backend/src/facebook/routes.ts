import { Router } from 'express'
import { currentUser } from '../auth/session'
import { forbidden } from '../lib/errors'
import { isAdmin } from '../permissions'
import { jobsRouter } from './jobs'
import { launchRouter } from './launch'
import { readRouter } from './read'
import { snapshotRouter } from './snapshot'
import { syncRouter } from './sync'
import { tokensRouter } from './tokens'
import { writeRouter } from './write'

// Everything the dashboard does on Facebook goes through here. The browser
// names a credential; the token and the Graph call stay on the server.
export const facebookRouter = Router()

facebookRouter.use((_req, res, next) => {
  if (!isAdmin(currentUser(res).role)) throw forbidden()
  // answers describe live ad accounts; nothing here is kept by the browser
  res.set('Cache-Control', 'no-store')
  next()
})

facebookRouter.use(tokensRouter)
// before the read routes, so /campaigns/{id}/import-snapshot is not taken for a campaign id
facebookRouter.use(snapshotRouter)
facebookRouter.use(readRouter)
facebookRouter.use(syncRouter)
facebookRouter.use(writeRouter)
facebookRouter.use(launchRouter)
facebookRouter.use(jobsRouter)
