// Builds the two files Wrangler reads from the single .env:
//   wrangler.jsonc  from wrangler.template.jsonc, filling ${NAME} placeholders
//   .dev.vars       the subset of .env the Worker itself may see
// Wrangler cannot read resource ids from .env, and must not hand the Worker
// deploy credentials, so neither file is written by hand.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

// Values the running Worker needs. Everything else in .env stays on this machine.
const WORKER_VARS = [
  'ALLOWED_ORIGINS',
  'SERVICE_TOKEN',
  'PUBLIC_FILES_URL',
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'REDTRACK_API_KEY',
  'CLOUDFLARE_IMAGES_ACCOUNT_ID',
  'CLOUDFLARE_IMAGES_API_TOKEN',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'FAL_KEY',
  'FAL_ADMIN_KEY',
  'FAL_MIN_BALANCE_USD',
  'IMPORT_ENABLED',
  'FACEBOOK_APP_ID',
  'FACEBOOK_APP_SECRET',
  'FACEBOOK_API_VERSION',
  'TEAM_TIME_ZONE',
  'STORAGE_FALLBACK_URL',
]

const root = new URL('../', import.meta.url)
const envFile = new URL('.env', root)

if (!existsSync(envFile)) {
  console.error('backend/.env is missing. Copy .env.example to .env and fill it in.')
  process.exit(1)
}

const env = parseEnv(readFileSync(envFile, 'utf8'))
const template = readFileSync(new URL('wrangler.template.jsonc', root), 'utf8')

const missing = new Set()
const config = template.replace(/\$\{(\w+)\}/g, (_, name) => {
  if (!env[name]) missing.add(name)
  return env[name] ?? ''
})

if (!env.CLOUDFLARE_ACCOUNT_ID) missing.add('CLOUDFLARE_ACCOUNT_ID')

if (missing.size) {
  console.error(`backend/.env is missing: ${[...missing].join(', ')}`)
  process.exit(1)
}

const header = '// Generated from wrangler.template.jsonc and .env. Edit those, not this file.\n'
writeFileSync(new URL('wrangler.jsonc', root), header + config)

// Wrangler refuses to start when the assets directory is absent, which it is
// until the dashboard has been built once
mkdirSync(new URL('../frontend/dist/', root), { recursive: true })

const vars = WORKER_VARS.filter((name) => env[name]).map((name) => `${name}=${JSON.stringify(env[name])}`)
writeFileSync(new URL('.dev.vars', root), `# Generated from .env. Edit that, not this file.\n${vars.join('\n')}\n`)
