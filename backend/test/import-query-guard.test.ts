import { describe, it } from 'vitest'

// The read-only SQL guard on POST /api/v1/import/query lives inline in
// src/routes/import.ts, which imports cloudflare:workers through ../env and
// ../db/client, so it cannot load outside the Worker runtime. These are the
// cases to cover once the check can be imported on its own.
describe('import query guard (src/routes/import.ts)', () => {
  it.todo('allows a plain SELECT')
  it.todo('rejects WITH ... DELETE (a CTE that writes)')
  it.todo('rejects multiple statements separated by ;')
  it.todo('allows exactly PRAGMA optimize')
  it.todo('rejects any other PRAGMA')
})
