// Seeds the LOCAL D1 (backend/.wrangler/local-state) with two users and a little
// sample data so the screens are not empty. Safe to run again: rows have fixed
// ids and are upserted. A user's password is only replaced when
// LOCAL_SEED_PASSWORD is set; otherwise a new user gets a generated password
// that is printed once.
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashPassword } from '../src/auth/password.ts'
import { localDir, wrangler } from './local-lib.mjs'

const USERS = [
  { id: 'recLocalAdmin0001', name: 'Local Admin', email: 'admin@example.test', role: 'Admin' },
  { id: 'recLocalEditor001', name: 'Local Editor', email: 'editor@example.test', role: 'Video Editor' },
]
const PRODUCT = { id: 'recLocalProduct01', name: 'Sample Product' }
const SCRIPT = { id: 'recLocalScript001', name: 'Sample Script 1' }
const VIDEOS = [
  { id: 'recLocalVideo0001', name: 'Sample Video 1 - Vertical', status: 'To Do', editor: 'recLocalEditor001' },
  { id: 'recLocalVideo0002', name: 'Sample Video 2 - Square', status: 'Available', editor: null },
]

const q = (value) => (value === null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`)

const out = wrangler(
  ['d1', 'execute', 'DB', '--json', '--command', `SELECT id FROM users WHERE id IN (${USERS.map((u) => q(u.id)).join(', ')})`],
  { capture: true },
)
const existing = new Set(JSON.parse(out)[0].results.map((row) => row.id))

const fromEnv = process.env.LOCAL_SEED_PASSWORD
if (fromEnv !== undefined && fromEnv.length < 8) {
  console.error('LOCAL_SEED_PASSWORD must be at least 8 characters')
  process.exit(1)
}
const needsNew = USERS.some((u) => !existing.has(u.id))
const password = fromEnv ?? (needsNew ? randomBytes(12).toString('base64url') : null)
const hash = password ? await hashPassword(password) : null

const now = new Date().toISOString()
const statements = []

for (const user of USERS) {
  const setPassword = fromEnv !== undefined || !existing.has(user.id)
  const updatePassword = fromEnv !== undefined ? ', password = excluded.password' : ''
  statements.push(
    `INSERT INTO users (id, name, email, password, role, active, created_at, updated_at) VALUES (${q(user.id)}, ${q(user.name)}, ${q(user.email)}, ${setPassword ? q(hash) : 'NULL'}, ${q(user.role)}, 1, ${q(now)}, ${q(now)}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, role = excluded.role, active = 1, updated_at = excluded.updated_at${updatePassword};`,
  )
}

statements.push(
  `INSERT INTO products (id, product_name, status, created_at, updated_at) VALUES (${q(PRODUCT.id)}, ${q(PRODUCT.name)}, 'Active', ${q(now)}, ${q(now)}) ON CONFLICT(id) DO UPDATE SET product_name = excluded.product_name, status = excluded.status, updated_at = excluded.updated_at;`,
  `INSERT INTO video_scripts (id, name, product_id, author_id, script_content, hook, body, created_at, updated_at) VALUES (${q(SCRIPT.id)}, ${q(SCRIPT.name)}, ${q(PRODUCT.id)}, ${q(USERS[0].id)}, 'Sample hook. Sample body.', 'Sample hook.', 'Sample body.', ${q(now)}, ${q(now)}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, product_id = excluded.product_id, updated_at = excluded.updated_at;`,
)
for (const video of VIDEOS) {
  statements.push(
    `INSERT INTO videos (id, video_name, product_id, script_id, editor_id, format, status, created_at, updated_at) VALUES (${q(video.id)}, ${q(video.name)}, ${q(PRODUCT.id)}, ${q(SCRIPT.id)}, ${q(video.editor)}, 'Vertical', ${q(video.status)}, ${q(now)}, ${q(now)}) ON CONFLICT(id) DO UPDATE SET video_name = excluded.video_name, editor_id = excluded.editor_id, status = excluded.status, updated_at = excluded.updated_at;`,
  )
}

const file = join(localDir, 'seed.sql')
writeFileSync(file, statements.join('\n') + '\n')
try {
  wrangler(['d1', 'execute', 'DB', '--file', file], { capture: true })
} finally {
  rmSync(file, { force: true })
}

console.log('Seeded local database: 2 users, 1 product, 1 script, 2 videos')
for (const user of USERS) {
  const changed = fromEnv !== undefined || !existing.has(user.id)
  console.log(`  ${user.role.padEnd(12)} ${user.email}  ${changed ? 'password set' : 'password unchanged'}`)
}
if (password && fromEnv === undefined) {
  console.log(`  Generated password (shown once): ${password}`)
} else if (fromEnv !== undefined) {
  console.log('  Password: the value of LOCAL_SEED_PASSWORD')
}
