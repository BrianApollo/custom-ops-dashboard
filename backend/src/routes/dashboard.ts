import { Router } from 'express'
import { currentUser, type AuthUser } from '../auth/session'
import { listStatement, parseListQuery, project } from '../data/read'
import { getTable } from '../data/registry'
import { batch, sql, type Row } from '../lib/d1'
import { invalid } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { ruleFor } from '../permissions'

export const dashboardRouter = Router()

// Each count is one grouped query that an index answers. `table` is the table
// a role must be able to read to be given that count.
const COUNTS = [
  {
    key: 'unassignedScripts',
    table: 'video_scripts',
    // a script nobody has been given yet: it has no videos
    from: 'video_scripts t WHERE NOT EXISTS (SELECT 1 FROM videos v WHERE v.script_id = t.id)',
  },
  { key: 'availableVideos', table: 'videos', from: `videos t WHERE t.status = 'Available'` },
  { key: 'availableAiVideos', table: 'ai_videos', from: `ai_videos t WHERE t.status = 'Available'` },
  {
    key: 'availableImages',
    table: 'images',
    // an image not yet used in any campaign
    from: 'images t WHERE NOT EXISTS (SELECT 1 FROM campaign_images ci WHERE ci.image_id = t.id)',
  },
  { key: 'activeCampaigns', table: 'campaigns', from: `campaigns t WHERE t.status = 'Launched'` },
]

function countStatements(user: AuthUser, productId?: string) {
  const allowed = COUNTS.filter((count) => ruleFor(user.role, count.table).read)
  const statements = allowed.map((count) =>
    productId
      ? sql(`SELECT t.product_id, count(*) AS n FROM ${count.from} AND t.product_id = ? GROUP BY t.product_id`, productId)
      : sql(`SELECT t.product_id, count(*) AS n FROM ${count.from} GROUP BY t.product_id`),
  )
  return { allowed, statements }
}

function shapeCounts(allowed: typeof COUNTS, results: { results: Row[] }[]) {
  const total: Record<string, number> = {}
  const byProduct: Record<string, Record<string, number>> = {}
  allowed.forEach((count, i) => {
    total[count.key] = 0
    for (const row of results[i].results) {
      const n = row.n as number
      total[count.key] += n
      // rows with no product count toward the total only
      if (row.product_id) (byProduct[row.product_id as string] ??= {})[count.key] = n
    }
  })
  return { total, byProduct }
}

// GET /counts[?productId=rec…] -> { total: { … }, byProduct: { rec…: { … } } }
dashboardRouter.get('/counts', async (req, res) => {
  const productId = req.query.productId
  if (productId !== undefined && (typeof productId !== 'string' || !RECORD_ID.test(productId))) {
    throw invalid('productId must be a record id', 'productId')
  }
  const { allowed, statements } = countStatements(currentUser(res), productId)
  const results = statements.length ? await batch(statements) : []
  res.set('Cache-Control', 'private, no-cache')
  res.json(shapeCounts(allowed, results))
})

// Everything the dashboard needs to start, in one round trip to the database:
// the current user, all products, user names and roles, and the counts
dashboardRouter.get('/bootstrap', async (_req, res) => {
  const user = currentUser(res)
  const products = getTable('products')
  const users = getTable('users')
  const productQuery = parseListQuery(products, user, {})
  const productProjection = project(products, productQuery.fields)
  const userQuery = parseListQuery(users, user, { fields: 'Name,Role' })
  const userProjection = project(users, userQuery.fields)
  const { allowed, statements } = countStatements(user)

  const lists = []
  if (ruleFor(user.role, 'products').read) lists.push(listStatement(products, productProjection, productQuery))
  if (ruleFor(user.role, 'users').read) lists.push(listStatement(users, userProjection, userQuery))
  const results = await batch([...lists, ...statements])

  const next = () => results.shift()!.results
  res.set('Cache-Control', 'private, no-cache')
  res.json({
    user: { id: user.id, email: user.email, role: user.roleLabel },
    products: ruleFor(user.role, 'products').read ? next().map(productProjection.decode) : [],
    users: ruleFor(user.role, 'users').read ? next().map(userProjection.decode) : [],
    counts: shapeCounts(allowed, results),
  })
})
