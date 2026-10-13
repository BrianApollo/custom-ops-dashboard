import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { Router } from 'express'
import { TABLES } from '@ops/shared'
import { db } from '../db/client'

export const healthRouter = Router()

healthRouter.get('/', async (_req, res) => {
  await db.run(sql`select 1`)
  await env.BUCKET.head('healthcheck')
  res.json({ ok: true, d1: true, r2: true, mappedTables: TABLES.length })
})
