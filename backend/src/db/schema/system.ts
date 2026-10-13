import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './tables'

// Tables the backend needs for itself; none of these exist in Airtable.

export const sessions = sqliteTable(
  'sessions',
  {
    // SHA-256 of the session token, so a database leak does not expose live sessions
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('idx_sessions_user_id').on(t.userId), index('idx_sessions_expires_at').on(t.expiresAt)],
)

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: text('at').notNull(),
    // no foreign key: the log outlives the user
    userId: text('user_id'),
    action: text('action').notNull(),
    tableName: text('table_name'),
    recordId: text('record_id'),
    detail: text('detail'),
  },
  (t) => [index('idx_audit_log_at').on(t.at)],
)

// failed login counters, keyed `ip:<address>` or `email:<address>`
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: text('window_start').notNull(),
})

// Work that outlasts one request, such as waiting for Facebook to process a
// video. Each poll of the job moves it one step on.
export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  // processing, finishing, done or failed
  status: text('status').notNull(),
  // JSON: what was asked for, and what has been learned so far
  input: text('input').notNull(),
  result: text('result'),
  error: text('error'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// lets a repeated create request return the records the first one made
export const idempotencyKeys = sqliteTable('idempotency_keys', {
  key: text('key').primaryKey(),
  userId: text('user_id').notNull(),
  tableName: text('table_name').notNull(),
  recordIds: text('record_ids').notNull(),
  createdAt: text('created_at').notNull(),
})
