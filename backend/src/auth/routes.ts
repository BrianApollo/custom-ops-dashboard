import { eq, inArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { Router } from 'express'
import { db } from '../db/client'
import { auditLog, rateLimits, sessions, users } from '../db/schema'
import { ApiError, badRequest } from '../lib/errors'
import { hashPassword, isHash, verifyPassword } from './password'
import {
  authenticate,
  currentUser,
  forgetSession,
  newToken,
  SESSION_COOKIE,
  SESSION_SECONDS,
  sessionId,
  toAuthUser,
} from './session'

export const authRouter = Router()

// Failed attempts allowed per window before logins are refused
const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_EMAIL = 5
const MAX_PER_IP = 20

type Batch = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]

const cookie = (token: string, maxAge: number) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`

// compared against when the email is unknown, so both cases take the same time
let dummyHash: Promise<string> | undefined

authRouter.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!email || !password) throw badRequest('email and password are required')

  const now = new Date()
  const nowIso = now.toISOString()
  const cutoff = new Date(now.getTime() - WINDOW_MS).toISOString()
  const ipKey = `ip:${req.get('cf-connecting-ip') ?? 'unknown'}`
  const emailKey = `email:${email}`

  const [limits, found] = await db.batch([
    db.select().from(rateLimits).where(inArray(rateLimits.key, [ipKey, emailKey])),
    db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1),
  ])

  for (const limit of limits) {
    const max = limit.key === ipKey ? MAX_PER_IP : MAX_PER_EMAIL
    if (limit.windowStart > cutoff && limit.count >= max) {
      const retryAfter = Math.ceil((Date.parse(limit.windowStart) + WINDOW_MS - now.getTime()) / 1000)
      res.set('Retry-After', String(retryAfter))
      throw new ApiError(429, 'rate_limited', 'Too many login attempts. Try again later.')
    }
  }

  const user = found[0]
  const check = await verifyPassword(password, user?.password || (await (dummyHash ??= hashPassword(newToken()))))

  if (!user?.password || !check.ok || !user.active) {
    const bump = (key: string) =>
      db
        .insert(rateLimits)
        .values({ key, count: 1, windowStart: nowIso })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            count: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoff} THEN 1 ELSE ${rateLimits.count} + 1 END`,
            windowStart: sql`CASE WHEN ${rateLimits.windowStart} <= ${cutoff} THEN ${nowIso} ELSE ${rateLimits.windowStart} END`,
          },
        })
    await db.batch([
      bump(ipKey),
      bump(emailKey),
      db.insert(auditLog).values({ at: nowIso, userId: user?.id ?? null, action: 'login_failed', detail: email }),
    ])
    throw new ApiError(401, 'invalid_credentials', 'Invalid email or password')
  }

  const token = newToken()
  const writes: Batch = [
    db.insert(sessions).values({
      id: await sessionId(token),
      userId: user.id,
      createdAt: nowIso,
      expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000).toISOString(),
    }),
    db.delete(rateLimits).where(inArray(rateLimits.key, [ipKey, emailKey])),
    db.insert(auditLog).values({ at: nowIso, userId: user.id, action: 'login' }),
  ]
  // a password that matched as plain text is replaced by its hash
  if (check.plaintext) {
    writes.push(db.update(users).set({ password: await hashPassword(password), updatedAt: nowIso }).where(eq(users.id, user.id)))
  }
  await db.batch(writes)

  if (check.plaintext) {
    const all = await db.select({ password: users.password }).from(users)
    const remaining = all.filter((u) => u.password && !isHash(u.password)).length
    console.log(`Upgraded one plaintext password; ${remaining} remaining`)
  }

  const { id, roleLabel } = toAuthUser(user)
  res.set('Set-Cookie', cookie(token, SESSION_SECONDS))
  res.json({ user: { id, email: user.email, role: roleLabel }, token })
})

authRouter.get('/me', (req, res, next) => {
  // the frontend expects `{ user: null }` here instead of the error envelope
  Promise.resolve(authenticate(req, res, next)).catch(() => res.status(401).json({ user: null }))
}, (_req, res) => {
  const user = currentUser(res)
  res.json({ user: { id: user.id, email: user.email, role: user.roleLabel } })
})

authRouter.post('/logout', authenticate, async (_req, res) => {
  const id = await sessionId(res.locals.token)
  const nowIso = new Date().toISOString()
  await db.update(sessions).set({ revokedAt: nowIso }).where(eq(sessions.id, id))
  forgetSession(id)
  res.set('Set-Cookie', cookie('', 0))
  res.json({ success: true })
})
