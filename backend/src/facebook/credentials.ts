import { nowIso, rows, sql } from '../lib/d1'
import { ApiError, invalid, notFound } from '../lib/errors'
import { FacebookClient, TOKEN_INVALID } from '../lib/facebook'
import { RECORD_ID } from '../lib/ids'

// A caller names whose token to use, never the token itself:
//   profile:rec…   that profile's long-lived token
//   bm:rec…        that business manager's system user token
//   (nothing)      the profile linked in Master Profile

export interface Credential {
  kind: 'profile' | 'bm'
  recordId: string
  client: FacebookClient
}

const missing = (what: string) => new ApiError(409, 'facebook_token_missing', `${what} has no Facebook token stored`)

export async function credential(cred: unknown): Promise<Credential> {
  if (cred === undefined || cred === null || cred === '') {
    const [master] = await rows(
      sql(
        `SELECT p.id, p.permanent_token AS token FROM master_profile m JOIN profiles p ON p.id = m.profile_id
         ORDER BY m.created_at, m.id LIMIT 1`,
      ),
    )
    if (!master) throw new ApiError(409, 'facebook_token_missing', 'No Master Profile is set')
    if (!master.token) throw missing('The Master Profile')
    return { kind: 'profile', recordId: master.id as string, client: new FacebookClient(master.token as string) }
  }

  const [kind, recordId] = String(cred).split(':')
  if ((kind !== 'profile' && kind !== 'bm') || !RECORD_ID.test(recordId ?? '')) {
    throw invalid('cred must be profile:{record id} or bm:{record id}', 'cred')
  }
  const [row] = await rows(
    kind === 'profile'
      ? sql('SELECT permanent_token AS token FROM profiles WHERE id = ?', recordId)
      : sql('SELECT system_user_token AS token FROM business_managers WHERE id = ?', recordId),
  )
  const label = kind === 'profile' ? `Profile ${recordId}` : `Business Manager ${recordId}`
  if (!row) throw notFound(label)
  if (!row.token) throw missing(label)
  return { kind, recordId, client: new FacebookClient(row.token as string) }
}

// When Facebook says a profile's token is dead, the profile is marked so
export async function noteTokenError(resolved: Credential, error: unknown) {
  if (error instanceof ApiError && error.code === TOKEN_INVALID && resolved.kind === 'profile') {
    await sql('UPDATE profiles SET token_valid = 0, updated_at = ? WHERE id = ?', nowIso(), resolved.recordId).run()
  }
}

// Runs Facebook work for a credential, noting a dead token before the error
// goes back to the caller
export async function withCredential<T>(cred: unknown, work: (credential: Credential) => Promise<T>) {
  const resolved = await credential(cred)
  try {
    return await work(resolved)
  } catch (error) {
    await noteTokenError(resolved, error)
    throw error
  }
}
