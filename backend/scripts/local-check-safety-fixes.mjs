// Checks the editor Status rules, editor upload links and Add Ads Used marking against a LOCAL dashboard over HTTP.
//
//   LOCAL_SEED_PASSWORD='…' node backend/scripts/local-check-safety-fixes.mjs --base http://localhost:8787
//
// Logs in as the two seeded test users, creates its own rows as admin (every
// name starts with ZZ-CHECK-), prints one PASS/FAIL line per check, and deletes
// those rows at the end. It writes to no other row and refuses any base that is
// not localhost or 127.0.0.1. Exits 0 only when every check passed.

const args = process.argv.slice(2)
const baseArg = args[args.indexOf('--base') + 1]
if (!args.includes('--base') || !baseArg) {
  console.error('Usage: LOCAL_SEED_PASSWORD=… node backend/scripts/local-check-safety-fixes.mjs --base http://localhost:PORT')
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

async function call(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
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
const created = { campaigns: [], videos: [], products: [] }

async function create(admin, table, fields) {
  const { status, data } = await call(admin.token, 'POST', `/data/${table}`, { fields })
  if (status !== 200 || !data?.id) throw new Error(`Could not create a ${table} row (${status}): ${JSON.stringify(data?.error ?? data)}`)
  created[table].push(data.id)
  return data
}

const fieldOf = (record, name) => record?.fields?.[name]
const codeOf = (answer) => answer.data?.error?.code ?? ''

async function statusOf(admin, id) {
  const { data } = await call(admin.token, 'GET', `/data/videos/${id}`)
  return fieldOf(data, 'Status')
}

async function cleanUp(admin) {
  for (const table of ['campaigns', 'videos', 'products']) {
    if (!created[table].length) continue
    const { status } = await call(admin.token, 'DELETE', `/data/${table}`, { ids: created[table] })
    if (status !== 200) console.log(`WARN  could not delete the ${table} rows this run created (${status}): ${created[table].join(', ')}`)
  }
}

// A presign that got past the ownership check: 200 with a link, or, in local
// mode without storage keys, the 503 not_configured that comes after the check
function presignAllowed(answer) {
  if (answer.status === 200) return { ok: typeof answer.data?.uploadUrl === 'string', detail: '200 with uploadUrl' }
  if (answer.status === 503 && codeOf(answer) === 'not_configured') {
    return { ok: true, detail: '503 not_configured: past the ownership check, but no storage keys are set locally, so no uploadUrl' }
  }
  return { ok: false, detail: `${answer.status} ${codeOf(answer)}` }
}

async function main(admin) {
  const editor = await login('editor@example.test')

  const product = await create(admin, 'products', { 'Product Name': `${TAG} product`, Status: 'Active' })
  const video = (name, status, editorId) =>
    create(admin, 'videos', {
      'Video Name': `${TAG} ${name}`,
      Product: [product.id],
      Status: status,
      ...(editorId ? { Editor: [editorId] } : {}),
    })

  // Fix 2: editors set only editor-side statuses
  const own = await video('editor status', 'To Do', editor.id)
  const patch = (who, id, fields) => call(who.token, 'PATCH', `/data/videos/${id}`, { fields })

  let answer = await patch(editor, own.id, { Status: 'Review' })
  report('fix2 editor sets own video to Review -> 200', answer.status === 200, String(answer.status))
  answer = await patch(editor, own.id, { Status: 'Available' })
  report('fix2 editor sets own video to Available -> 403', answer.status === 403, String(answer.status))
  answer = await patch(editor, own.id, { Status: 'Used' })
  report('fix2 editor sets own video to Used -> 403', answer.status === 403, String(answer.status))

  const used = await video('editor used', 'Used', editor.id)
  answer = await patch(editor, used.id, { Status: 'To Do' })
  const after = await statusOf(admin, used.id)
  report('fix2 editor moves a Used video to To Do -> 403, still Used', answer.status === 403 && after === 'Used', `${answer.status}, status ${after}`)

  answer = await patch(admin, own.id, { Status: 'Available' })
  report('fix2 admin sets Available -> 200', answer.status === 200, String(answer.status))

  // Fix 3: editor upload links only for their own videos
  const mine = await video('upload mine', 'To Do', editor.id)
  const nobodys = await video('upload nobody', 'To Do', null)
  const others = await video('upload other', 'To Do', admin.id)
  const presign = (who, fileName) =>
    call(who.token, 'POST', '/storage/presign', { kind: 'video', productId: product.id, fileName, contentType: 'video/mp4', contentLength: 1000 })
  const fileOf = (record) => `${fieldOf(record, 'Video Name')}.mp4`

  let allowed = presignAllowed(await presign(editor, fileOf(mine)))
  report('fix3 editor presign for own assigned video -> allowed', allowed.ok, allowed.detail)
  answer = await presign(editor, fileOf(nobodys))
  report('fix3 editor presign for a video assigned to nobody -> 403', answer.status === 403, String(answer.status))
  answer = await presign(editor, fileOf(others))
  report('fix3 editor presign for a video assigned to another user -> 403', answer.status === 403, String(answer.status))
  answer = await presign(editor, `${TAG} anything.mp4`)
  report('fix3 editor presign with an arbitrary file name -> 403', answer.status === 403, String(answer.status))
  allowed = presignAllowed(await presign(admin, fileOf(nobodys)))
  report('fix3 admin presign for the same -> allowed', allowed.ok, allowed.detail)
  allowed = presignAllowed(await presign(admin, `${TAG} anything.mp4`))
  report('fix3 admin presign with an arbitrary file name -> allowed', allowed.ok, allowed.detail)

  // Fix 4: Add Ads marks videos Used in the same transaction
  const campaign = await create(admin, 'campaigns', { Name: `${TAG} campaign`, Product: [product.id], Status: 'Preparing' })
  const first = await video('media 1', 'Available', null)
  const second = await video('media 2', 'Available', null)
  answer = await call(admin.token, 'POST', `/campaigns/${campaign.id}/media`, { videoIds: [first.id, second.id], markUsed: true })
  const statuses = [await statusOf(admin, first.id), await statusOf(admin, second.id)]
  let linked = fieldOf((await call(admin.token, 'GET', `/data/campaigns/${campaign.id}`)).data, 'Videos Used In This Campaign') ?? []
  report(
    'fix4 markUsed: both videos Used and linked',
    answer.status === 200 && statuses.every((s) => s === 'Used') && [first.id, second.id].every((id) => linked.includes(id)),
    `${answer.status}, statuses ${statuses.join('/')}, linked ${linked.length}`,
  )
  const marked = answer.data?.markedUsed?.videos ?? []
  report('fix4 markUsed: answer lists both ids as markedUsed', [first.id, second.id].every((id) => marked.includes(id)), JSON.stringify(answer.data?.markedUsed))

  const third = await video('media 3', 'Available', null)
  answer = await call(admin.token, 'POST', `/campaigns/${campaign.id}/media`, { videoIds: [third.id] })
  const untouched = await statusOf(admin, third.id)
  linked = fieldOf((await call(admin.token, 'GET', `/data/campaigns/${campaign.id}`)).data, 'Videos Used In This Campaign') ?? []
  report(
    'fix4 without markUsed: linked, status untouched',
    answer.status === 200 && untouched === 'Available' && linked.includes(third.id),
    `${answer.status}, status ${untouched}`,
  )
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
