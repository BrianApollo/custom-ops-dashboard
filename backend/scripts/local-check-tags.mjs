// Checks the asset tag tables, the tags map and the Library tag filter against a LOCAL dashboard over HTTP.
//
//   LOCAL_SEED_PASSWORD='…' node backend/scripts/local-check-tags.mjs --base http://localhost:8787
//
// Needs the tag types pushed first (the library sync), because it tags its
// own assets with shot_type, subjects and has_audio. Creates its own rows as admin
// (asset keys and hashes start with ZZ-CHECK-, the tag type key with zz_check_),
// prints one PASS/FAIL line per check and deletes those rows at the end. Refuses
// any base that is not localhost or 127.0.0.1. Exits 0 only when every check passed.

const args = process.argv.slice(2)
const baseArg = args[args.indexOf('--base') + 1]
if (!args.includes('--base') || !baseArg) {
  console.error('Usage: LOCAL_SEED_PASSWORD=… node backend/scripts/local-check-tags.mjs --base http://localhost:PORT')
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
const RUN = Date.now().toString(36)
const TAG = `ZZ-CHECK-${RUN}`
const TYPE_KEY = `zz_check_${RUN}`

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

const created = { media_asset_tags: [], media_assets: [], tag_types: [] }

async function create(admin, table, fields) {
  const { status, data } = await call(admin.token, 'POST', `/data/${table}`, { fields })
  if (status !== 200 || !data?.id) throw new Error(`Could not create a ${table} row (${status}): ${JSON.stringify(data?.error ?? data)}`)
  created[table].push(data.id)
  return data
}

const q = (params) => {
  const out = new URLSearchParams()
  for (const [k, v] of params) out.append(k, v)
  return out.toString()
}

async function cleanUp(admin) {
  for (const table of ['media_asset_tags', 'media_assets', 'tag_types']) {
    const ids = [...new Set(created[table])]
    if (!ids.length) continue
    const { status } = await call(admin.token, 'DELETE', `/data/${table}`, { ids })
    if (status !== 200) console.log(`WARN  could not delete the ${table} rows this run created (${status}): ${ids.join(', ')}`)
  }
}

function asset(n) {
  return {
    'Asset Key': `${TAG}-asset-${n}`,
    Hash: `${TAG}-hash-${n}`,
    Niche: 'pet',
    Kind: 'clip',
    Phase: 'solution',
    'Source System': 'check',
    'Source ID': `${TAG}/${n}`,
    Rights: 'own',
    'Tag Source': 'source',
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

async function main(admin) {
  const editor = await login('editor@example.test')

  // tag types round-trip: create, read back, change, delete
  const type = await create(admin, 'tag_types', {
    Key: TYPE_KEY, Label: 'Check', Kind: 'choice', Values: ['one', 'two'], Multi: true, Filter: true, Position: 999,
  })
  let answer = await call(editor.token, 'GET', `/data/tag_types/${type.id}`)
  const f = answer.data?.fields ?? {}
  report(
    'tag_types round-trip: what was written reads back the same (as an editor)',
    answer.status === 200 && f.Key === TYPE_KEY && f.Kind === 'choice' && same(f.Values, ['one', 'two']) && f.Multi === true && f.Filter === true && f.Position === 999,
    `${answer.status}, ${JSON.stringify(f)}`,
  )
  answer = await call(admin.token, 'PATCH', `/data/tag_types/${type.id}`, { fields: { Label: 'Check 2', Filter: false } })
  report('tag_types update reads back', answer.status === 200 && answer.data?.fields?.Label === 'Check 2' && !answer.data?.fields?.Filter, String(answer.status))
  answer = await call(admin.token, 'POST', '/data/tag_types', { fields: { Key: `${TYPE_KEY}_bad`, Label: 'x', Kind: 'colour' } })
  if (answer.data?.id) created.tag_types.push(answer.data.id)
  report('tag_types refuses an unknown Kind', answer.status === 422, String(answer.status))
  answer = await call(admin.token, 'POST', '/data/tag_types', { fields: { Key: TYPE_KEY, Label: 'dup', Kind: 'text' } })
  if (answer.data?.id) created.tag_types.push(answer.data.id)
  report('tag_types refuses a second type with the same Key', answer.status !== 200, String(answer.status))
  answer = await call(editor.token, 'POST', '/data/tag_types', { fields: { Key: `${TYPE_KEY}_ed`, Label: 'x', Kind: 'text' } })
  if (answer.data?.id) created.tag_types.push(answer.data.id)
  report('editor creates a tag type -> 403', answer.status === 403, String(answer.status))

  const listed = await call(editor.token, 'GET', `/data/tag_types?${q([['fields', 'Key'], ['limit', '500']])}`)
  const keys = new Set((listed.data?.records ?? []).map((r) => r.fields.Key))
  const needed = ['shot_type', 'subjects', 'has_audio']
  if (!needed.every((k) => keys.has(k))) throw new Error(`tag types ${needed.join(', ')} are not in this dashboard: run the library sync first`)

  // an asset's tags come back as a map
  const a = await create(admin, 'media_assets', asset(1))
  const b = await create(admin, 'media_assets', asset(2))
  const tag = (assetId, key, value) =>
    create(admin, 'media_asset_tags', { Asset: [assetId], 'Tag Key': key, Value: value, Source: 'check', Confidence: 1 })
  await tag(a.id, 'shot_type', 'close')
  await tag(a.id, 'subjects', 'dog')
  await tag(a.id, 'subjects', 'person')
  await tag(a.id, 'has_audio', 'true')
  await tag(b.id, 'shot_type', 'wide')
  await tag(b.id, 'subjects', 'dog')

  answer = await call(admin.token, 'POST', '/data/media_asset_tags', { fields: { Asset: [a.id], 'Tag Key': 'shot_type', Value: 'close' } })
  if (answer.data?.id) created.media_asset_tags.push(answer.data.id)
  report('media_asset_tags refuses the same asset, key and value twice', answer.status !== 200, String(answer.status))

  const wantA = { has_audio: true, shot_type: 'close', subjects: ['dog', 'person'] }
  answer = await call(editor.token, 'GET', `/library/assets?${q([['where[Asset Key]', `${TAG}-asset-1`], ['fields', 'Asset Key,tags'], ['limit', '60']])}`)
  const listedA = answer.data?.records?.[0]?.fields?.tags
  report('Library list: an asset carries its tags as { key: value | [values] }', answer.status === 200 && same(listedA, wantA), `${answer.status}, ${JSON.stringify(listedA)}`)
  answer = await call(editor.token, 'GET', `/data/media_assets/${b.id}`)
  report('one asset read: a multi tag with one value is still a list', answer.status === 200 && same(answer.data?.fields?.tags, { shot_type: 'wide', subjects: ['dog'] }), JSON.stringify(answer.data?.fields?.tags))

  // the tag filter
  const mine = [['search', TAG], ['fields', 'Asset Key,tags'], ['limit', '60']]
  answer = await call(editor.token, 'GET', `/library/assets?${q([['tag[shot_type]', 'close'], ['fields', 'Asset Key,tags'], ['sort', '-createdTime'], ['limit', '60']])}`)
  let rows = answer.data?.records ?? []
  report(
    'tag[shot_type]=close returns only assets tagged close, including the new one, not the wide one',
    answer.status === 200 && rows.length > 0 && rows.every((r) => r.fields.tags?.shot_type === 'close') && rows.some((r) => r.id === a.id) && !rows.some((r) => r.id === b.id),
    `${answer.status}, ${rows.length} of ${answer.data?.total}`,
  )
  answer = await call(editor.token, 'GET', `/library/assets?${q([...mine, ['tag[subjects]', 'dog']])}`)
  rows = answer.data?.records ?? []
  report('tag[subjects]=dog finds both new assets', answer.status === 200 && rows.length === 2, `${rows.length}`)
  answer = await call(editor.token, 'GET', `/library/assets?${q([...mine, ['tag[subjects]', 'dog'], ['tag[subjects]', 'person']])}`)
  rows = answer.data?.records ?? []
  report('tag[subjects]=dog&tag[subjects]=person: an asset must match every pair', answer.status === 200 && rows.length === 1 && rows[0].id === a.id, `${rows.length}`)
  answer = await call(editor.token, 'GET', `/library/assets?${q([...mine, ['tag[shot_type]', 'wide'], ['tag[has_audio]', 'true']])}`)
  report('two different tags that no one asset has return nothing', answer.status === 200 && answer.data?.total === 0, `${answer.data?.total}`)
  answer = await call(editor.token, 'GET', `/library/assets?${q([...mine, ['tag[shot_type]', 'close'], ['where[Kind]', 'clip']])}`)
  report('the tag filter combines with where[...]', answer.status === 200 && answer.data?.total === 1, `${answer.data?.total}`)
  answer = await call(editor.token, 'GET', `/library/assets?${q([['tag[zz_not_a_tag]', 'x'], ['limit', '60']])}`)
  report('an unknown tag key in the filter -> 400', answer.status === 400, String(answer.status))
  answer = await call(editor.token, 'GET', `/library/assets?${q([['tag[shot_type]', 'close']])}`)
  report('the Library list needs a limit -> 400 without one', answer.status === 400, String(answer.status))
  answer = await call(editor.token, 'GET', `/data/media_assets?${q([['tag[shot_type]', 'close'], ['limit', '1']])}`)
  report('the generic data route is unchanged: it still refuses tag[...]', answer.status === 400, String(answer.status))

  // editors read the tags and write none
  answer = await call(editor.token, 'POST', '/data/media_asset_tags', { fields: { Asset: [a.id], 'Tag Key': 'emotion', Value: 'calm' } })
  if (answer.data?.id) created.media_asset_tags.push(answer.data.id)
  report('editor creates a tag -> 403', answer.status === 403, String(answer.status))

  // deleting an asset removes its tags
  answer = await call(admin.token, 'DELETE', `/data/media_assets/${b.id}`)
  if (answer.status === 200) created.media_assets.splice(created.media_assets.indexOf(b.id), 1)
  const left = await call(admin.token, 'GET', `/data/media_asset_tags?${q([['where[Asset]', b.id]])}`)
  report('deleting an asset removes its tags', answer.status === 200 && left.data?.records?.length === 0, `${left.data?.records?.length}`)
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
