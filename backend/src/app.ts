import express, { Router, type RequestHandler } from 'express'
import { authRouter } from './auth/routes'
import { authenticate } from './auth/session'
import { dataRouter } from './data/routes'
import { settings } from './env'
import { executorRouter } from './executor/routes'
import { facebookRouter } from './facebook/routes'
import { generationRouter } from './generation/routes'
import { errorHandler, notFound } from './lib/errors'
import { actionsRouter } from './routes/actions'
import { campaignsRouter } from './routes/campaigns'
import { dashboardRouter } from './routes/dashboard'
import { forwardersRouter } from './routes/forwarders'
import { healthRouter } from './routes/health'
import { imagesRouter } from './routes/images'
import { importRouter } from './routes/import'
import { overviewRouter } from './routes/overview'
import { scriptsRouter } from './routes/scripts'
import { storageRouter } from './routes/storage'
import { usersRouter } from './routes/users'
import { videosRouter } from './routes/videos'

export const app = express()

app.disable('x-powered-by')

// Browsers on the listed dashboard origins may call the API with the session cookie
const cors: RequestHandler = (req, res, next) => {
  const origin = req.get('Origin')
  const allowed = (settings.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim())
  if (origin && allowed.includes(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
      'Access-Control-Expose-Headers': 'X-Request-Id',
      Vary: 'Origin',
    })
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
}

const api = Router()
api.use((req, res, next) => {
  res.set('X-Request-Id', req.get('cf-ray') ?? crypto.randomUUID())
  res.set('Cache-Control', 'no-store')
  next()
})
api.use('/auth', authRouter)
api.use(authenticate)
api.use('/data', dataRouter)
api.use('/users', usersRouter)
api.use('/campaigns', campaignsRouter)
api.use(dashboardRouter)
api.use(actionsRouter)
api.use(forwardersRouter)
api.use(generationRouter)
api.use(storageRouter)
api.use(scriptsRouter)
api.use(videosRouter)
api.use(imagesRouter)
api.use(overviewRouter)
api.use('/import', importRouter)
api.use('/facebook', facebookRouter)
api.use('/executor', executorRouter)

app.use(cors)
// a whole link table arrives in one request during the Airtable import
app.use('/api/v1/import', express.json({ limit: '50mb' }))
// campaign snapshots are large; D1 caps a row at 2 MB
app.use(express.json({ limit: '2mb' }))
app.use('/health', healthRouter)
app.use('/api/v1', api)
app.use((req) => {
  throw notFound(`Route ${req.method} ${req.path}`)
})
app.use(errorHandler)
