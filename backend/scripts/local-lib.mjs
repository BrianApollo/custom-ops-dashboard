// Shared paths and helpers for the local-only scripts (local-setup, local-seed,
// local-dev, local-reset). Everything here works against Miniflare on this
// machine; no command built here may reach a Cloudflare account.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const backendDir = fileURLToPath(new URL('../', import.meta.url))
export const localDir = fileURLToPath(new URL('../.local/', import.meta.url))
export const localConfig = fileURLToPath(new URL('../.local/wrangler.jsonc', import.meta.url))
export const localVars = fileURLToPath(new URL('../.local/.dev.vars', import.meta.url))
export const localTemplate = fileURLToPath(new URL('../wrangler.local.template.jsonc', import.meta.url))
export const stateDir = fileURLToPath(new URL('../.wrangler/local-state/', import.meta.url))
export const frontendIndex = fileURLToPath(new URL('../../frontend/dist/index.html', import.meta.url))
export const rootDir = fileURLToPath(new URL('../../', import.meta.url))
export const wranglerBin = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url))

const REMOTE = /"remote"\s*:\s*true/

export function assertNoRemote(text, where) {
  if (REMOTE.test(text)) {
    console.error(`Refusing to run: ${where} contains "remote": true, which would use production resources.`)
    process.exit(1)
  }
}

export function assertLocalConfig() {
  if (!existsSync(localConfig)) {
    console.error('backend/.local/wrangler.jsonc is missing. Run `npm run local:setup` first.')
    process.exit(1)
  }
  const text = readFileSync(localConfig, 'utf8')
  assertNoRemote(text, 'backend/.local/wrangler.jsonc')
  if (!/"name"\s*:\s*"ops-dashboard-local"/.test(text)) {
    console.error('Refusing to run: backend/.local/wrangler.jsonc is not the local Worker config.')
    process.exit(1)
  }
}

export const wranglerDir = fileURLToPath(new URL('../.wrangler/', import.meta.url))

export function assertLocalStateDir(dir) {
  const full = resolve(dir) + sep
  if (!full.startsWith(wranglerDir) || full === wranglerDir) {
    console.error(`Refusing to use ${dir}: local state must live under backend/.wrangler/.`)
    process.exit(1)
  }
}

// A child environment with every Cloudflare credential removed, so even a
// mistaken flag has nothing to authenticate with.
export function childEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLOUDFLARE_') || key.startsWith('CF_')) delete env[key]
  }
  env.WRANGLER_SEND_METRICS = 'false'
  env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'
  return env
}

// Runs wrangler from backend/.local so it never picks up backend/.env or
// backend/.dev.vars. Always passes the local config and --local.
export function wrangler(args, { capture = false } = {}) {
  return wranglerAt(stateDir, args, { capture })
}

// Same as wrangler(), with the local state kept in `persistTo`, which must be
// a folder under backend/.wrangler/ (git-ignored). Used by local-copy-data and its tests.
export function wranglerAt(persistTo, args, { capture = false } = {}) {
  assertLocalStateDir(persistTo)
  assertLocalConfig()
  const full = [wranglerBin, ...args, '--config', localConfig, '--local', '--persist-to', persistTo]
  const result = spawnSync(process.execPath, full, {
    cwd: localDir,
    env: childEnv(),
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr ?? '')
    console.error(`wrangler ${args.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }
  return result.stdout
}
