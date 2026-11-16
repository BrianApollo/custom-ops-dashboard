// Checks language sharing in the Library list, the one-click download route and the remaining-scripts
// route against a LOCAL dashboard over HTTP, plus direct counts from the local database.
//
//   LOCAL_SEED_PASSWORD='…' LOCAL_CHECK_PRODUCT='<product name>' LOCAL_CHECK_VARIANT_PRODUCT='<language version name>' \
//     node backend/scripts/local-check-library-polish.mjs --base http://localhost:8787
//
// Needs the library sync run first (so the shared_products tag and has_speech are in the dashboard).
// LOCAL_CHECK_PRODUCT names a product with clips both with and without speech; LOCAL_CHECK_VARIANT_PRODUCT
// names one of its language versions, which the no-speech clips are shared to.
// Reads only, except one temporary asset (key and hash start with ZZ-CHECK-) that it deletes at the end.
// Refuses any base that is not localhost or 127.0.0.1. Exits 0 only when every check passed.
import { wrangler } from './local-lib.mjs'

const args = process.argv.slice(2)
const baseArg = args[args.indexOf('--base') + 1]
if (!args.includes('--base') || !baseArg) {
  console.error('Usage: LOCAL_SEED_PASSWORD=… LOCAL_CHECK_PRODUCT=… LOCAL_CHECK_VARIANT_PRODUCT=… node backend/scripts/local-check-library-polish.mjs --base http://localhost:PORT')
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
const OWN_PRODUCT = process.env.LOCAL_CHECK_PRODUCT
const VARIANT_PRODUCT = process.env.LOCAL_CHECK_VARIANT_PRODUCT
if (!OWN_PRODUCT || !VARIANT_PRODUCT) {
  console.error('Set LOCAL_CHECK_PRODUCT and LOCAL_CHECK_VARIANT_PRODUCT to a product name and the name of one of its language versions')
  process.exit(2)
}

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
    headers: { 'Content-Type': 'application/json', Origin: base.origin },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.token) throw new Error(`Login as ${email} failed (${response.status})`)
  return { token: data.token, id: data.user.id }
}

const q = (params) => {
  const out = new URLSearchParams()
  for (const [k, v] of params) out.append(k, v)
  return out.toString()
}

// rows of one read-only statement against the local database
function db(statement) {
  if (!/^\s*select\b/i.test(statement)) throw new Error('only SELECT is run against the local database')
  const out = wrangler(['d1', 'execute', 'DB', '--json', '--command', statement], { capture: true })
  return JSON.parse(out)[0].results
}

const created = []

async function productId(token, name) {
  const { data } = await call(token, 'GET', `/data/products?${q([['where[Product Name]', name], ['fields', 'Product Name'], ['limit', '5']])}`)
  const id = data?.records?.find((r) => r.fields['Product Name'] === name)?.id
  if (!id) throw new Error(`product ${name} is not in this dashboard`)
  return id
}

async function libraryTotal(token, params) {
  const { status, data } = await call(token, 'GET', `/library/assets?${q([...params, ['fields', 'Asset Key,tags'], ['limit', '60']])}`)
  return { status, total: data?.total, records: data?.records ?? [] }
}

async function languageSharing(admin, editor) {
  const own = await productId(admin.token, OWN_PRODUCT)
  const variant = await productId(admin.token, VARIANT_PRODUCT)

  const neutral = await libraryTotal(editor.token, [['where[Product]', own], ['tag[has_speech]', 'false'], ['where[Kind]', 'clip']])
  const voiced = await libraryTotal(editor.token, [['where[Product]', own], ['tag[has_speech]', 'true']])
  if (!neutral.records.length || !voiced.records.length) throw new Error(`no ${OWN_PRODUCT} clip with and without speech: run the voice check and the sync first`)
  const neutralKey = neutral.records[0].fields['Asset Key']
  const voicedKey = voiced.records[0].fields['Asset Key']

  let r = await libraryTotal(editor.token, [['product', variant], ['where[Asset Key]', neutralKey]])
  report(`a ${OWN_PRODUCT} clip with no voice is listed for ${VARIANT_PRODUCT}`, r.status === 200 && r.total === 1, `${neutralKey}: ${r.status}, ${r.total}`)
  report(
    'that clip carries the shared_products tag naming the variant',
    Array.isArray(r.records[0]?.fields?.tags?.shared_products) && r.records[0].fields.tags.shared_products.includes(VARIANT_PRODUCT),
    JSON.stringify(r.records[0]?.fields?.tags?.shared_products),
  )
  r = await libraryTotal(editor.token, [['product', variant], ['where[Asset Key]', voicedKey]])
  report(`a ${OWN_PRODUCT} asset with speech is not listed for ${VARIANT_PRODUCT}`, r.status === 200 && r.total === 0, `${voicedKey}: ${r.status}, ${r.total}`)
  r = await libraryTotal(editor.token, [['product', variant], ['tag[has_speech]', 'true']])
  report(`no asset with speech is listed for ${VARIANT_PRODUCT}`, r.status === 200 && r.total === 0, `${r.total}`)

  const ownBefore = await libraryTotal(editor.token, [['where[Product]', own]])
  const ownNow = await libraryTotal(editor.token, [['product', own]])
  report(`${OWN_PRODUCT} own list is unchanged in count (product= vs where[Product]=)`, ownNow.status === 200 && ownNow.total === ownBefore.total, `${ownNow.total} vs ${ownBefore.total}`)

  const shared = db(
    `SELECT count(DISTINCT x.asset_id) AS n FROM media_asset_tags x WHERE x.tag_key = 'shared_products' AND x.value = '${VARIANT_PRODUCT.replace(/'/g, "''")}'`,
  )[0].n
  const variantOwn = db(`SELECT count(*) AS n FROM media_assets WHERE product_id = '${variant}'`)[0].n
  r = await libraryTotal(editor.token, [['product', variant]])
  report(`${VARIANT_PRODUCT} lists its own assets plus the shared ones`, r.status === 200 && r.total === variantOwn + shared, `${r.total} = ${variantOwn} own + ${shared} shared`)
  r = await libraryTotal(editor.token, [['product', 'not-an-id']])
  report('product= that is not a record id -> 400', r.status === 400, String(r.status))
}

async function download(admin, editor) {
  for (const kind of ['still', 'clip']) {
    const { data } = await call(editor.token, 'GET', `/library/assets?${q([['where[Kind]', kind], ['whereNotEmpty[File Key]', '1'], ['fields', 'Asset Key,File Key,fileUrl'], ['limit', '1']])}`)
    const asset = data?.records?.[0]
    if (!asset) {
      report(`download a ${kind}`, false, 'no asset of this kind with a file')
      continue
    }
    for (const who of [editor, admin]) {
      const response = await fetch(`${API}/library/assets/${asset.id}/download`, { headers: { Authorization: `Bearer ${who.token}` } })
      const bytes = (await response.arrayBuffer()).byteLength
      const header = response.headers.get('Content-Disposition') ?? ''
      const declared = response.headers.get('Content-Length')
      const source = await fetch(asset.fields.fileUrl, { method: 'HEAD' })
      const full = Number(source.headers.get('Content-Length'))
      report(
        `download a ${kind} as ${who === editor ? 'editor' : 'admin'}: attachment header and the full file`,
        response.status === 200 && /^attachment; filename="[a-z0-9-]+-[a-z_-]+-[a-z0-9]+\.[a-z0-9]+"$/.test(header) && full > 0 && bytes === full && (declared === null || Number(declared) === full),
        `${response.status}, ${header}, ${bytes} bytes, file ${full} bytes, Content-Length ${declared ?? 'not sent (chunked)'}`,
      )
    }
  }

  const { status, data } = await call(admin.token, 'POST', '/data/media_assets', {
    fields: {
      'Asset Key': `${TAG}-asset`,
      Hash: `${TAG}-hash`,
      Niche: 'pet',
      Kind: 'clip',
      'Source System': 'check',
      'Source ID': `${TAG}/1`,
      Rights: 'own',
      'Tag Source': 'source',
      'File Key': 'Sample Product/Videos/not-a-library-file.mp4',
    },
  })
  if (status !== 200 || !data?.id) throw new Error(`could not create the check asset (${status})`)
  created.push(data.id)
  const outside = await fetch(`${API}/library/assets/${data.id}/download`, { headers: { Authorization: `Bearer ${editor.token}` } })
  report('a file key outside asset-library/ is not served -> 404', outside.status === 404, String(outside.status))
  const missing = await fetch(`${API}/library/assets/recZZZZZZZZZZZZZZ/download`, { headers: { Authorization: `Bearer ${editor.token}` } })
  report('an id that is not a media_assets row -> 404', missing.status === 404, String(missing.status))
  const anon = await fetch(`${API}/library/assets/${data.id}/download`)
  report('download without a login -> 401', anon.status === 401, String(anon.status))
}

async function remaining(admin, editor) {
  const { status, data } = await call(admin.token, 'GET', '/overview/remaining?fresh=1')
  const editors = data?.editors ?? []
  report('GET /overview/remaining as admin', status === 200 && editors.length > 0, `${status}, ${editors.length} editors`)

  const direct = db(
    `SELECT v.editor_id, count(DISTINCT v.script_id) AS scripts, count(*) AS videos FROM videos v
     JOIN users u ON u.id = v.editor_id JOIN video_scripts s ON s.id = v.script_id JOIN products p ON p.id = v.product_id
     WHERE v.status = 'To Do' AND p.status = 'Active' AND coalesce(u.name, '') != 'AI' GROUP BY v.editor_id ORDER BY scripts DESC`,
  )
  for (const row of direct.slice(0, 2)) {
    const got = editors.find((e) => e.editorId === row.editor_id)
    report(
      `editor ${got?.editorName ?? row.editor_id}: remaining scripts equal a direct count from the database`,
      got?.totalScripts === row.scripts && got?.todoVideos === row.videos,
      `route ${got?.totalScripts}/${got?.todoVideos}, database ${row.scripts}/${row.videos}`,
    )
  }
  report('every editor with remaining work is listed, and no other', editors.length === direct.length, `${editors.length} vs ${direct.length}`)
  report('most remaining first', editors.every((e, i) => i === 0 || editors[i - 1].totalScripts >= e.totalScripts))

  const benched = db(
    `SELECT v.editor_id, v.script_id, p.status FROM videos v JOIN products p ON p.id = v.product_id
     WHERE v.status = 'To Do' AND p.status != 'Active' AND v.editor_id IS NOT NULL AND v.script_id IS NOT NULL LIMIT 1`,
  )[0]
  if (benched) {
    const listed = editors.some((e) => e.products.some((p) => p.scripts.some((s) => s.scriptId === benched.script_id)))
    report(`a script with To Do videos on a ${benched.status} product is absent`, !listed, benched.script_id)
  } else {
    report('a script on a product that is not Active is absent', false, 'no To Do video on a product that is not Active in this database')
  }

  let r = await call(editor.token, 'GET', '/overview/remaining')
  report('editor without editorId -> 403', r.status === 403, String(r.status))
  r = await call(editor.token, 'GET', `/overview/remaining?editorId=${editor.id}`)
  report('editor asking for their own list -> 200', r.status === 200 && Array.isArray(r.data?.editors), String(r.status))
}

let admin
try {
  admin = await login('admin@example.test')
  const editor = await login('editor@example.test')
  await languageSharing(admin, editor)
  await download(admin, editor)
  await remaining(admin, editor)
} catch (error) {
  failures++
  console.log(`FAIL  run stopped: ${error.message}`)
} finally {
  if (admin && created.length) {
    const { status } = await call(admin.token, 'DELETE', '/data/media_assets', { ids: created })
    if (status !== 200) console.log(`WARN  could not delete the check asset (${status}): ${created.join(', ')}`)
  }
}
console.log(failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
