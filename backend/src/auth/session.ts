import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { RequestHandler, Response } from 'express'
import { db } from '../db/client'
import { sessions, users } from '../db/schema'
import { settings } from '../env'
import { unauthorized } from '../lib/errors'
import { roleSlug, type Role } from '../permissions'

export interface AuthUser {
  id: string
  email: string | null
  name: string | null
  role: Role
  // the role as the frontend knows it today, e.g. `video editor`
  roleLabel: string
}

export const SESSION_COOKIE = 'ops_session'
export const SESSION_SECONDS = 24 * 60 * 60

const SERVICE_USER: AuthUser = { id: 'service', email: null, name: 'Service', role: 'service', roleLabel: 'service' }

// Saves a database read on every request. A logout or deactivation made
// through another Worker instance takes up to this long to be noticed here.
const CACHE_MS = 30_000
const CACHE_MAX = 2_000
const cache = new Map<string, { user: AuthUser; until: number }>()

export async function sessionId(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Buffer.from(digest).toString('hex')
}

export const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')

export const toAuthUser = (row: { id: string; email: string | null; name: string | null; role: string | null }): AuthUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: roleSlug(row.role),
  roleLabel: (row.role ?? '').trim().toLowerCase(),
})

export const forgetSession = (id: string) => cache.delete(id)

async function resolveSession(token: string): Promise<AuthUser | null> {
  const id = await sessionId(token)
  const hit = cache.get(id)
  if (hit && hit.until > Date.now()) return hit.user

  const row = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      active: users.active,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
    .get()

  if (!row || !row.active || row.expiresAt <= new Date().toISOString()) {
    cache.delete(id)
    return null
  }
  const user = toAuthUser(row)
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(id, { user, until: Math.min(Date.now() + CACHE_MS, Date.parse(row.expiresAt)) })
  return user
}

function readToken(header: { authorization?: string; cookie?: string }) {
  if (header.authorization?.startsWith('Bearer ')) return header.authorization.slice(7).trim()
  for (const part of (header.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === SESSION_COOKIE) return value.join('=')
  }
  return null
}

function isServiceToken(token: string) {
  const expected = settings.SERVICE_TOKEN
  if (!expected) return false
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const authenticate: RequestHandler = async (req, res, next) => {
  const token = readToken(req.headers)
  if (!token) throw unauthorized()
  const user = isServiceToken(token) ? SERVICE_USER : await resolveSession(token)
  if (!user) throw unauthorized()
  res.locals.user = user
  res.locals.token = token
  next()
}

export const currentUser = (res: Response) => res.locals.user as AuthUser
