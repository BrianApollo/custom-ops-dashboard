// Checks the script scores and media assets tables against a LOCAL dashboard over HTTP.
//
//   LOCAL_SEED_PASSWORD='…' node backend/scripts/local-check-scores-assets.mjs --base http://localhost:8787
//
// Logs in as the two seeded test users, creates its own rows as admin (every
// name, key and hash starts with ZZ-CHECK-), prints one PASS/FAIL line per
// check, and deletes those rows at the end. It writes to no other row and
// refuses any base that is not localhost or 127.0.0.1. Exits 0 only when every
// check passed.

const args = process.argv.slice(2)
const baseArg = args[args.indexOf('--base') + 1]
if (!args.includes('--base') || !baseArg) {
  console.error('Usage: LOCAL_SEED_PASSWORD=… node backend/scripts/local-check-scores-assets.mjs --base http://localhost:PORT')
  process.exit(2)
}
let base
try {
  base = new URL(baseArg)
} catch {
  console.error(`Not a URL: ${baseArg}`)
  process.exit(2)
}
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname)) {
  console.error(`Refusing ${baseArg}: only http://localhost or http://127.0.0.1 is allowed`)
  process.exit(2)
}
const password = process.env.LOCAL_SEED_PASSWORD
if (!password) {
  console.error('Set LOCAL_SEED_PASSWORD to the password of the local test logins')
  process.exit(2)
}
const API = `${base.origin}/api/v1`
const TAG = `ZZ-CHECK-${Date.now().toString(36)}`

let failures = 0
function report(name, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function call(token, method, path, body, headers = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function login(email) {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.token) throw new Error(`Login as ${email} failed (${response.status})`)
  return { token: data.token, id: data.user.id }
}

// rows this run created, deleted at the end in this order
const created = { script_scores: [], media_assets: [], video_scripts: [] }

async function create(admin, table, fields) {
  const { status, data } = await call(admin.token, 'POST', `/data/${table}`, { fields })
  if (status !== 200 || !data?.id) throw new Error(`Could not create a ${table} row (${status}): ${JSON.stringify(data?.error ?? data)}`)
  created[table].push(data.id)
  return data
}

const fieldOf = (record, name) => record?.fields?.[name]
const q = (params) => new URLSearchParams(params).toString()

async function cleanUp(admin) {
  for (const table of ['script_scores', 'media_assets', 'video_scripts']) {
    const ids = [...new Set(created[table])]
    if (!ids.length) continue
    const { status } = await call(admin.token, 'DELETE', `/data/${table}`, { ids })
    if (status !== 200) console.log(`WARN  could not delete the ${table} rows this run created (${status}): ${ids.join(', ')}`)
  }
}

function asset(n, extra = {}) {
  return {
    'Asset Key': `${TAG}-asset-${n}`,
    Hash: `${TAG}-hash-${n}`,
    Niche: 'pet',
    Kind: 'clip',
    Phase: 'solution',
    'Product Visible': false,
    'Source System': 'check',
    'Source ID': `${TAG}/${n}`,
    Rights: 'own',
    'Tag Source': 'source',
    ...extra,
  }
}

async function main(admin) {
  const editor = await login('editor@example.test')

  // video_scripts accepts and returns Hook Family
  const script = await create(admin, 'video_scripts', { Name: `${TAG} script`, 'Hook Family': 'check-family', 'Script Source': 'editor' })
  const readScript = (await call(admin.token, 'GET', `/data/video_scripts/${script.id}`)).data
  report(
    'video_scripts accepts and returns Hook Family and Script Source',
    fieldOf(readScript, 'Hook Family') === 'check-family' && fieldOf(readScript, 'Script Source') === 'editor',
    `${fieldOf(readScript, 'Hook Family')} / ${fieldOf(readScript, 'Script Source')}`,
  )

  // a score row, read back as a winner sorted by rank
  const score = await create(admin, 'script_scores', {
    'Video Script': [script.id],
    'Script Number': 99999,
    Status: 'winner',
    Spend: 1234.5,
    Purchases: 12,
    Revenue: 2345.6,
    'Rank Score': 1e9,
    Fatigued: false,
    'Computed At': new Date().toISOString(),
  })
  let answer = await call(admin.token, 'GET', `/data/script_scores?${q({ 'where[Status]': 'winner', sort: '-Rank Score', limit: '20' })}`)
  const top = answer.data?.records ?? []
  report(
    'script_scores where[Status]=winner&sort=-Rank Score returns the new row first, as {id, fields}',
    answer.status === 200 && top[0]?.id === score.id && fieldOf(top[0], 'Status') === 'winner' && fieldOf(top[0], 'Video Script')?.[0] === script.id,
    `${answer.status}, first ${top[0]?.id}, ${top.length} rows`,
  )
  const ranks = top.map((r) => fieldOf(r, 'Rank Score') ?? -Infinity)
  report('script_scores winners come back in falling Rank Score order', ranks.every((r, i) => i === 0 || r <= ranks[i - 1]), ranks.slice(0, 5).join(', '))

  // a second create for the same script updates that row: one row per script
  answer = await call(admin.token, 'POST', '/data/script_scores', {
    records: [{ fields: { 'Video Script': [script.id], 'Script Number': 99999, Status: 'winner', Spend: 2000, Purchases: 20, Revenue: 4000, 'Rank Score': 1e9, 'Computed At': new Date().toISOString() } }],
  })
  const again = answer.data?.records?.[0]
  if (again?.id) created.script_scores.push(again.id)
  const perScript = await call(admin.token, 'GET', `/data/script_scores?${q({ 'where[Video Script]': script.id })}`)
  report(
    'script_scores: a repeat create for the same script updates the same row',
    answer.status === 200 && again?.id === score.id && perScript.data?.records?.length === 1 && fieldOf(perScript.data.records[0], 'Spend') === 2000,
    `${answer.status}, same id ${again?.id === score.id}, ${perScript.data?.records?.length} rows, spend ${fieldOf(perScript.data?.records?.[0], 'Spend')}`,
  )

  // a media asset, read back by phase
  const first = await create(admin, 'media_assets', asset(1))
  answer = await call(admin.token, 'GET', `/data/media_assets?${q({ 'where[Phase]': 'solution', 'where[Asset Key]': `${TAG}-asset-1` })}`)
  report(
    'media_assets where[Phase]=solution returns the new asset',
    answer.status === 200 && answer.data?.records?.length === 1 && answer.data.records[0].id === first.id,
    `${answer.status}, ${answer.data?.records?.length} rows`,
  )
  answer = await call(admin.token, 'GET', `/data/media_assets?${q({ 'where[Phase]': 'solution', 'where[Product Visible]': '0', 'where[Hash]': `${TAG}-hash-1` })}`)
  report('media_assets where[Product Visible]=0 finds it', answer.data?.records?.[0]?.id === first.id, String(answer.status))

  // a second asset with the same Hash is refused and not stored
  answer = await call(admin.token, 'POST', '/data/media_assets', { fields: asset(2, { Hash: `${TAG}-hash-1` }) })
  if (answer.data?.id) created.media_assets.push(answer.data.id)
  const sameHash = await call(admin.token, 'GET', `/data/media_assets?${q({ 'where[Hash]': `${TAG}-hash-1` })}`)
  report(
    'media_assets refuses a second asset with the same Hash',
    answer.status !== 200 && sameHash.data?.records?.length === 1,
    `${answer.status} ${answer.data?.error?.code ?? ''}, ${sameHash.data?.records?.length} with that hash`,
  )

  // a repeated POST with the same Idempotency-Key returns the first records and makes no new row
  const key = `${TAG}-idem`
  const once = await call(admin.token, 'POST', '/data/media_assets', { records: [{ fields: asset(3) }] }, { 'Idempotency-Key': key })
  const twice = await call(admin.token, 'POST', '/data/media_assets', { records: [{ fields: asset(3) }] }, { 'Idempotency-Key': key })
  for (const r of [...(once.data?.records ?? []), ...(twice.data?.records ?? [])]) created.media_assets.push(r.id)
  const third = await call(admin.token, 'GET', `/data/media_assets?${q({ 'where[Asset Key]': `${TAG}-asset-3` })}`)
  report(
    'a repeat POST with the same Idempotency-Key returns the same record, no duplicate',
    once.status === 200 && twice.status === 200 && once.data?.records?.[0]?.id === twice.data?.records?.[0]?.id && third.data?.records?.length === 1,
    `${once.status}/${twice.status}, ${third.data?.records?.length} stored`,
  )

  // an asset with file keys returns both public addresses; one without returns null for both
  const fileKey = `asset-library/check/${TAG}-asset-5.mp4`
  const thumbKey = `asset-library/check/thumbs/${TAG}-asset-5.webp`
  const withKeys = await create(admin, 'media_assets', asset(5, { 'File Key': fileKey, 'Thumbnail Key': thumbKey }))
  answer = await call(editor.token, 'GET', `/data/media_assets/${withKeys.id}`)
  const fileUrl = fieldOf(answer.data, 'fileUrl')
  const thumbnailUrl = fieldOf(answer.data, 'thumbnailUrl')
  report(
    'media_assets with File Key and Thumbnail Key returns fileUrl and thumbnailUrl',
    answer.status === 200 && typeof fileUrl === 'string' && fileUrl.endsWith(`/${fileKey}`) && typeof thumbnailUrl === 'string' && thumbnailUrl.endsWith(`/${thumbKey}`),
    `${answer.status}, ${fileUrl} / ${thumbnailUrl}`,
  )
  answer = await call(editor.token, 'GET', `/data/media_assets/${first.id}`)
  report(
    'media_assets without keys returns null for fileUrl and thumbnailUrl',
    answer.status === 200 && fieldOf(answer.data, 'fileUrl') === null && fieldOf(answer.data, 'thumbnailUrl') === null,
    `${answer.status}, ${JSON.stringify(fieldOf(answer.data, 'fileUrl'))} / ${JSON.stringify(fieldOf(answer.data, 'thumbnailUrl'))}`,
  )
  answer = await call(admin.token, 'PATCH', `/data/media_assets/${first.id}`, { fields: { fileUrl: 'https://example.test/x.mp4' } })
  report('media_assets refuses a write to fileUrl', answer.status !== 200, String(answer.status))

  // the Library grid's list: its fields only, 60 at a time
  const grid = 'Asset Key,Subject,Kind,Phase,Product,Generic,Product Visible,Duration Ms,Aspect,thumbnailUrl'
  answer = await call(editor.token, 'GET', `/data/media_assets?${q({ fields: grid, limit: '60', offset: '0', sort: 'Asset Key' })}`)
  const gridRows = answer.data?.records ?? []
  const allowed = new Set(grid.split(','))
  report(
    'media_assets grid list (fields=, limit=60) answers with at most 60 rows and only the asked fields',
    answer.status === 200 && gridRows.length <= 60 && gridRows.every((r) => Object.keys(r.fields).every((k) => allowed.has(k))),
    `${answer.status}, ${gridRows.length} rows of ${answer.data?.total}`,
  )

  // an editor reads both tables and writes neither
  for (const table of ['script_scores', 'media_assets']) {
    answer = await call(editor.token, 'GET', `/data/${table}?limit=1`)
    report(`editor reads ${table} -> 200`, answer.status === 200, String(answer.status))
  }
  answer = await call(editor.token, 'POST', '/data/script_scores', {
    fields: { 'Video Script': [script.id], 'Script Number': 1, Status: 'dud', Spend: 0, Purchases: 0, Revenue: 0, 'Computed At': 'x' },
  })
  if (answer.data?.id) created.script_scores.push(answer.data.id)
  report('editor creates a script_scores row -> 403', answer.status === 403, String(answer.status))
  answer = await call(editor.token, 'POST', '/data/media_assets', { fields: asset(4) })
  if (answer.data?.id) created.media_assets.push(answer.data.id)
  report('editor creates a media_assets row -> 403', answer.status === 403, String(answer.status))
  answer = await call(editor.token, 'PATCH', `/data/script_scores/${score.id}`, { fields: { Status: 'dud' } })
  report('editor changes a script_scores row -> 403', answer.status === 403, String(answer.status))
  answer = await call(editor.token, 'PATCH', `/data/media_assets/${first.id}`, { fields: { Approved: true } })
  report('editor changes a media_assets row -> 403', answer.status === 403, String(answer.status))
  answer = await call(editor.token, 'DELETE', `/data/media_assets/${first.id}`)
  report('editor deletes a media_assets row -> 403', answer.status === 403, String(answer.status))
}

let admin
try {
  admin = await login('admin@example.test')
  await main(admin)
} catch (error) {
  failures++
  console.log(`FAIL  run stopped: ${error.message}`)
} finally {
  if (admin) await cleanUp(admin)
}
console.log(failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
