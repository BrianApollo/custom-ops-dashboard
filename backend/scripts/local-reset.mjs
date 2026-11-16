// Deletes the local database, bucket and generated local config, then runs
// local-setup again. Touches only backend/.local and backend/.wrangler/local-state.
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { localDir, stateDir } from './local-lib.mjs'

for (const dir of [stateDir, localDir]) {
  if (!dir.endsWith('/.wrangler/local-state/') && !dir.endsWith('/.local/')) {
    console.error(`Refusing to delete unexpected path ${dir}`)
    process.exit(1)
  }
  rmSync(dir, { recursive: true, force: true })
}
console.log('Deleted local state')

const setup = spawnSync(process.execPath, [fileURLToPath(new URL('./local-setup.mjs', import.meta.url))], { stdio: 'inherit' })
process.exit(setup.status ?? 1)
