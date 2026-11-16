// Checks the structured Videos fields (copy lists, angle, landing page, batch, pipeline, persona, source system,
// generation, library assets) against a LOCAL dashboard over HTTP.
//
//   LOCAL_SEED_PASSWORD='…' node backend/scripts/local-check-adlab-fields.mjs --base http://localhost:8787
//
// Creates one video as admin with every new field (name starts with ZZ-CHECK-, assigned to the test editor), reads it
// back as admin and as the editor, confirms the editor may not change any new field (and may still change Notes on
// the same video), prints one PASS/FAIL line per check and deletes the video at the end. Refuses any base that is not
// localhost or 127.0.0.1. Exits 0 only when every check passed.

const args = process.argv.slice(2)
const baseArg = args[args.indexOf('--base') + 1]
if (!args.includes('--base') || !baseArg) {
  console.error('Usage: LOCAL_SEED_PASSWORD=… node backend/scripts/local-check-adlab-fields.mjs --base http://localhost:PORT')
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
    headers: { 'Content-Type': 'application/json', origin: base.origin },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.token) throw new Error(`Login as ${email} failed (${response.status})`)
  return { token: data.token, id: data.user.id }
}

const NEW = {
  'Primary Texts': JSON.stringify(['First primary text', 'Second primary text']),
  Headlines: JSON.stringify(['A headline']),
  Descriptions: JSON.stringify(['A description']),
  Angle: 'Check angle',
  'Landing Page': '/landing/',
  Batch: `${TAG}-batch`,
  Pipeline: 'faceless',
  Persona: 'Check persona',
  'Source System': 'check',
  Generation: JSON.stringify({ tool: 'check', duration_seconds: 12.5, batch_level: { usd_total: 1.25, tools: ['tts'] } }),
  'Library Assets': JSON.stringify(['ma_check_1', 'ma_check_2']),
}

let videoId

async function main(admin) {
  const editor = await login('editor@example.test')

  let answer = await call(admin.token, 'POST', '/data/videos', {
    fields: { 'Video Name': `${TAG} video`, Editor: [editor.id], Status: 'To Do', Notes: 'check', ...NEW },
  })
  videoId = answer.data?.id
  report('admin creates a video with every new field', answer.status === 200 && Boolean(videoId), `${answer.status} ${JSON.stringify(answer.data?.error ?? '')}`)
  if (!videoId) return

  const differs = (fields) => Object.keys(NEW).filter((k) => fields?.[k] !== NEW[k])
  answer = await call(admin.token, 'GET', `/data/videos/${videoId}`)
  let bad = differs(answer.data?.fields)
  report('admin reads every new field back unchanged', answer.status === 200 && bad.length === 0, bad.join(', '))

  answer = await call(editor.token, 'GET', `/data/videos/${videoId}`)
  bad = differs(answer.data?.fields)
  report('editor reads every new field', answer.status === 200 && bad.length === 0, bad.join(', '))

  const fieldsParam = new URLSearchParams({ limit: '1', fields: 'Primary Texts', 'where[Batch]': NEW.Batch })
  answer = await call(editor.token, 'GET', `/data/videos?${fieldsParam}`)
  report('a list read naming a new field works and filters on Batch', answer.status === 200 && answer.data?.total === 1, String(answer.status))

  const refused = []
  for (const [k, v] of Object.entries(NEW)) {
    const r = await call(editor.token, 'PATCH', `/data/videos/${videoId}`, { fields: { [k]: v } })
    if (r.status !== 403) refused.push(`${k}=${r.status}`)
  }
  report('editor may not change any new field on their own video (403 each)', refused.length === 0, refused.join(', '))

  answer = await call(editor.token, 'PATCH', `/data/videos/${videoId}`, { fields: { Notes: 'editor note' } })
  report('editor may still change Notes on the same video', answer.status === 200, String(answer.status))

  answer = await call(admin.token, 'GET', `/data/videos/${videoId}`)
  bad = differs(answer.data?.fields)
  report('the new fields are unchanged after the refused editor writes', bad.length === 0, bad.join(', '))

  answer = await call(admin.token, 'PATCH', `/data/videos/${videoId}`, { fields: { Persona: null, 'Library Assets': '[]' } })
  report(
    'admin can clear and change new fields',
    answer.status === 200 && !answer.data?.fields?.Persona && answer.data?.fields?.['Library Assets'] === '[]',
    String(answer.status),
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
  if (admin && videoId) {
    const { status } = await call(admin.token, 'DELETE', `/data/videos/${videoId}`)
    if (status !== 200) console.log(`WARN  could not delete the check video ${videoId} (${status})`)
  }
}
console.log(failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
