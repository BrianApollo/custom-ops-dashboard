import { eq } from 'drizzle-orm'
import { Router } from 'express'
import { hashPassword } from '../auth/password'
import { currentUser } from '../auth/session'
import { db } from '../db/client'
import { auditLog, sessions, users } from '../db/schema'
import { forbidden, invalid, notFound } from '../lib/errors'
import { recordId } from '../lib/ids'
import { isAdmin } from '../permissions'

// User management, admin only. Passwords are set here and nowhere else,
// always hashed, and never returned.
export const usersRouter = Router()

// stored as Airtable has them; the frontend filters on these exact values
const ROLES = ['Admin', 'Video Editor']
const MIN_PASSWORD = 8

const publicColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  active: users.active,
  createdTime: users.createdAt,
  updatedTime: users.updatedAt,
}

usersRouter.use((_req, res, next) => {
  if (!isAdmin(currentUser(res).role)) throw forbidden()
  res.set('Cache-Control', 'no-store')
  next()
})

function profileFrom(body: Record<string, unknown>, partial: boolean) {
  const out: { name?: string; email?: string; role?: string; active?: boolean } = {}
  if (body.name !== undefined || !partial) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('name is required', 'name')
    out.name = body.name.trim()
  }
  if (body.email !== undefined || !partial) {
    if (typeof body.email !== 'string' || !/^\S+@\S+\.\S+$/.test(body.email)) throw invalid('email is not valid', 'email')
    out.email = body.email.trim().toLowerCase()
  }
  if (body.role !== undefined || !partial) {
    if (!ROLES.includes(body.role as string)) throw invalid(`role must be one of: ${ROLES.join(', ')}`, 'role')
    out.role = body.role as string
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') throw invalid('active must be true or false', 'active')
    out.active = body.active
  }
  return out
}

function passwordFrom(body: Record<string, unknown>) {
  if (typeof body.password !== 'string' || body.password.length < MIN_PASSWORD) {
    throw invalid(`password must be at least ${MIN_PASSWORD} characters`, 'password')
  }
  return body.password
}

usersRouter.get('/', async (_req, res) => {
  res.json({ users: await db.select(publicColumns).from(users).orderBy(users.name) })
})

usersRouter.post('/', async (req, res) => {
  const body = req.body ?? {}
  const profile = profileFrom(body, false)
  const password = await hashPassword(passwordFrom(body))
  const id = recordId()
  const now = new Date().toISOString()
  const [, , created] = await db.batch([
    db.insert(users).values({ id, ...profile, active: profile.active ?? true, password, createdAt: now, updatedAt: now }),
    db.insert(auditLog).values({ at: now, userId: currentUser(res).id, action: 'user_create', tableName: 'users', recordId: id }),
    db.select(publicColumns).from(users).where(eq(users.id, id)),
  ])
  res.json(created[0])
})

usersRouter.patch('/:id', async (req, res) => {
  const { id } = req.params
  const profile = profileFrom(req.body ?? {}, true)
  const now = new Date().toISOString()
  const [, , , updated] = await db.batch([
    db.update(users).set({ ...profile, updatedAt: now }).where(eq(users.id, id)),
    // a deactivated user is signed out everywhere
    db.update(sessions).set({ revokedAt: now }).where(profile.active === false ? eq(sessions.userId, id) : eq(sessions.id, '')),
    db.insert(auditLog).values({
      at: now,
      userId: currentUser(res).id,
      action: 'user_update',
      tableName: 'users',
      recordId: id,
      detail: JSON.stringify(profile),
    }),
    db.select(publicColumns).from(users).where(eq(users.id, id)),
  ])
  if (!updated[0]) throw notFound(`User ${id}`)
  res.json(updated[0])
})

usersRouter.post('/:id/password', async (req, res) => {
  const { id } = req.params
  const password = await hashPassword(passwordFrom(req.body ?? {}))
  const now = new Date().toISOString()
  const [changed] = await db.batch([
    db.update(users).set({ password, updatedAt: now }).where(eq(users.id, id)).returning({ id: users.id }),
    db.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, id)),
    db.insert(auditLog).values({ at: now, userId: currentUser(res).id, action: 'user_password', tableName: 'users', recordId: id }),
  ])
  if (!changed[0]) throw notFound(`User ${id}`)
  res.json({ success: true })
})
