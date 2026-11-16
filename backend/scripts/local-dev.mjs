// Local run mode, step 2: builds the dashboard once if it has never been built,
// then starts the local Worker on http://localhost:8787 with every binding in
// Miniflare. Extra arguments are passed to wrangler dev (e.g. --port 8788).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  assertLocalConfig,
  childEnv,
  frontendIndex,
  localConfig,
  localDir,
  rootDir,
  stateDir,
  wranglerBin,
} from './local-lib.mjs'

assertLocalConfig()

const extra = process.argv.slice(2)
if (extra.some((arg) => /^-(r$|-rem)/.test(arg))) {
  console.error('Local mode never runs against Cloudflare.')
  process.exit(1)
}

if (!existsSync(frontendIndex)) {
  console.log('frontend/dist is empty; building the dashboard once')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const build = spawnSync(npm, ['run', 'build', '-w', '@ops/frontend'], { cwd: rootDir, stdio: 'inherit', env: childEnv() })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const port = extra.some((arg) => arg.startsWith('--port')) ? [] : ['--port', process.env.LOCAL_PORT || '8787']
const args = [wranglerBin, 'dev', '--config', localConfig, '--local', '--persist-to', stateDir, ...port, ...extra]
const child = spawn(process.execPath, args, { cwd: localDir, stdio: 'inherit', env: childEnv() })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code ?? 0))
