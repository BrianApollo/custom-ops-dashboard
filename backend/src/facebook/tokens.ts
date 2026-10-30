import { Router } from 'express'
import { currentUser } from '../auth/session'
import { auditStatement } from '../lib/audit'
import { batch, nowIso, rows, sql } from '../lib/d1'
import { ApiError, invalid, notFound } from '../lib/errors'
import { exchangeCode, exchangeToken, FacebookClient, facebookConfig, type FbObject, inspectToken } from '../lib/facebook'
import { recordId } from '../lib/ids'

// Connecting a Facebook login and looking after the stored tokens. A token
// comes in from the browser in two places only (connect, and pasting a system
// user token) and never goes back out.
export const tokensRouter = Router()

const DAY_MS = 86_400_000
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const SYSTEM_USER_SCOPE = 'business_management,ads_management,ads_read,pages_read_engagement,pages_manage_metadata'

// the app id is public; the login popup needs it
tokensRouter.get('/config', (_req, res) => {
  res.json(facebookConfig())
})

// Takes the short-lived token from the login popup, swaps it for a long-lived
// one and stores it on the matching profile, creating the profile if needed
tokensRouter.post('/connect', async (req, res) => {
  const shortLived = req.body?.shortLivedToken
  if (typeof shortLived !== 'string' || !shortLived) throw invalid('shortLivedToken is required', 'shortLivedToken')

  const { token, expiresIn } = await exchangeToken(shortLived)
  const me = await new FacebookClient(token).get('me', { fields: 'id,name' })
  const info = await inspectToken(token)
  const expiresOn = day(info.dataAccessExpiresAt ? info.dataAccessExpiresAt * 1000 : Date.now() + expiresIn * 1000)

  const now = nowIso()
  const [existing] = await rows(
    sql(
      `SELECT id FROM profiles WHERE profile_id = ?1 OR profile_name = ?2
       ORDER BY (profile_id = ?1) DESC, created_at LIMIT 1`,
      me.id,
      me.name,
    ),
  )
  const profileId = (existing?.id as string | undefined) ?? recordId()
  await batch([
    existing
      ? sql(
          `UPDATE profiles SET profile_name = ?, profile_id = ?, permanent_token = ?, permanent_token_end_date = ?,
             profile_status = 'Active', token_valid = 1, last_sync = ?, updated_at = ? WHERE id = ?`,
          me.name,
          me.id,
          token,
          expiresOn,
          now,
          now,
          profileId,
        )
      : sql(
          `INSERT INTO profiles (id, profile_name, profile_id, permanent_token, permanent_token_end_date,
             profile_status, token_valid, last_sync, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'Active', 1, ?, ?, ?)`,
          profileId,
          me.name,
          me.id,
          token,
          expiresOn,
          now,
          now,
          now,
        ),
    auditStatement(now, currentUser(res).id, 'facebook_connect', 'profiles', profileId),
  ])
  res.json({ profileId, fbUserId: me.id, name: me.name, tokenExpiresOn: expiresOn, created: !existing })
})

// Takes the code from the system user login popup (a Facebook Login for
// Business configuration of the system-user kind). Facebook has already made
// a system user for the app inside the business portfolio the admin chose;
// the code is swapped for that user's token, which is stored on the matching
// Business Manager, creating the row if needed. Nothing is created in the
// business portfolio by hand, so there is no app to add to a system user.
tokensRouter.post('/connect-system-user', async (req, res) => {
  const code = req.body?.code
  if (typeof code !== 'string' || !code) throw invalid('code is required', 'code')

  const { token } = await exchangeCode(code)
  const info = await inspectToken(token)
  if (!info.isValid) throw new ApiError(502, 'facebook_error', 'Facebook handed back a token it does not accept')
  const client = new FacebookClient(token)
  const me = await client.get('me', { fields: 'id,name' })

  // the one business portfolio the system user belongs to. Asked for twice:
  // a system user token is not always allowed to list its businesses, but the
  // token inspection names the business its business_management covers
  let business: FbObject | undefined = (await client.list('me/businesses', { fields: 'id,name,verification_status', limit: 100 }).catch(() => []))[0]
  if (!business) {
    const bmId = info.granularScopes.find((s) => s.scope === 'business_management')?.target_ids?.[0]
    if (bmId) business = await client.get(bmId, { fields: 'id,name,verification_status' }).catch(() => undefined)
  }
  if (!business) throw new ApiError(502, 'facebook_error', 'Facebook did not say which business portfolio the system user belongs to')

  const bmId = String(business.id)
  const bmName = String(business.name ?? bmId)
  const verification = (business.verification_status as string | undefined) ?? 'not_verified'
  const expiresOn = info.expiresAt ? day(info.expiresAt * 1000) : null

  const now = nowIso()
  const [existing] = await rows(sql('SELECT id FROM business_managers WHERE bm_id = ? ORDER BY created_at LIMIT 1', bmId))
  const bmRecordId = (existing?.id as string | undefined) ?? recordId()
  await batch([
    existing
      ? sql(
          `UPDATE business_managers SET bm_name = ?, system_user_id = ?, system_user_token = ?, system_user_created = ?, updated_at = ?
           WHERE id = ?`,
          bmName,
          me.id,
          token,
          now,
          now,
          bmRecordId,
        )
      : sql(
          `INSERT INTO business_managers (id, bm_id, bm_name, bm_status, verification_status, system_user_id, system_user_token,
             system_user_created, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          bmRecordId,
          bmId,
          bmName,
          business.verification_status ?? 'Active',
          verification,
          me.id,
          token,
          now,
          now,
          now,
        ),
    auditStatement(now, currentUser(res).id, 'facebook_system_user_connect', 'business_managers', bmRecordId),
  ])
  res.json({
    bmRecordId,
    bmId,
    bmName,
    systemUserId: me.id,
    systemUserName: me.name,
    tokenExpiresOn: expiresOn,
    scopes: info.scopes,
    created: !existing,
  })
})

async function storedToken(table: 'profiles' | 'business_managers', id: string) {
  const column = table === 'profiles' ? 'permanent_token' : 'system_user_token'
  const [row] = await rows(sql(`SELECT ${column} AS token FROM ${table} WHERE id = ?`, id))
  const label = table === 'profiles' ? `Profile ${id}` : `Business Manager ${id}`
  if (!row) throw notFound(label)
  if (!row.token) throw new ApiError(409, 'facebook_token_missing', `${label} has no Facebook token stored`)
  return row.token as string
}

tokensRouter.post('/profiles/:id/token/validate', async (req, res) => {
  const info = await inspectToken(await storedToken('profiles', req.params.id))
  const expiry = info.dataAccessExpiresAt ?? info.expiresAt
  const expiresOn = expiry ? day(expiry * 1000) : null
  await sql(
    `UPDATE profiles SET token_valid = ?, permanent_token_end_date = coalesce(?, permanent_token_end_date), updated_at = ?
     WHERE id = ?`,
    info.isValid ? 1 : 0,
    expiresOn,
    nowIso(),
    req.params.id,
  ).run()
  res.json({ isValid: info.isValid, expiresOn, scopes: info.scopes, fbUserId: info.userId })
})

// Trades the stored token for a fresh long-lived one
tokensRouter.post('/profiles/:id/token/refresh', async (req, res) => {
  const { token, expiresIn } = await exchangeToken(await storedToken('profiles', req.params.id))
  const expiresOn = day(Date.now() + expiresIn * 1000)
  const now = nowIso()
  await batch([
    sql(
      'UPDATE profiles SET permanent_token = ?, permanent_token_end_date = ?, token_valid = 1, updated_at = ? WHERE id = ?',
      token,
      expiresOn,
      now,
      req.params.id,
    ),
    auditStatement(now, currentUser(res).id, 'facebook_token_refresh', 'profiles', req.params.id),
  ])
  res.json({ expiresOn, daysLeft: Math.floor((expiresIn * 1000) / DAY_MS) })
})

// Asks Facebook who the token belongs to. Writes nothing.
tokensRouter.get('/profiles/:id/token/check', async (req, res) => {
  const token = await storedToken('profiles', req.params.id)
  try {
    const me = await new FacebookClient(token).get('me', { fields: 'id,name' })
    res.json({ valid: true, name: me.name, fbUserId: me.id, error: null })
  } catch (error) {
    res.json({ valid: false, name: null, fbUserId: null, error: (error as Error).message })
  }
})

tokensRouter.post('/business-managers/:id/system-user-token/validate', async (req, res) => {
  const info = await inspectToken(await storedToken('business_managers', req.params.id))
  res.json({ isValid: info.isValid })
})

// Saves a system user token pasted in by an admin, after Facebook confirms it
tokensRouter.put('/business-managers/:id/system-user-token', async (req, res) => {
  const token = req.body?.token
  if (typeof token !== 'string' || !token.trim()) throw invalid('token is required', 'token')
  const [bm] = await rows(sql('SELECT id FROM business_managers WHERE id = ?', req.params.id))
  if (!bm) throw notFound(`Business Manager ${req.params.id}`)
  if (!(await inspectToken(token.trim())).isValid) throw invalid('Facebook says this token is not valid', 'token')

  const now = nowIso()
  await batch([
    sql(
      'UPDATE business_managers SET system_user_token = ?, system_user_created = ?, updated_at = ? WHERE id = ?',
      token.trim(),
      now,
      now,
      req.params.id,
    ),
    auditStatement(now, currentUser(res).id, 'facebook_system_user_token_set', 'business_managers', req.params.id),
  ])
  res.json({ saved: true })
})

// Creates (or finds) the business manager's system user and a token for it.
// The outcomes an admin has to act on come back as a `result`, not as an error.
tokensRouter.post('/business-managers/:id/system-user-token/generate', async (req, res) => {
  const [bm] = await rows(sql('SELECT bm_id, bm_name, system_user_id FROM business_managers WHERE id = ?', req.params.id))
  if (!bm) throw notFound(`Business Manager ${req.params.id}`)
  const done = (result: string, message: string, systemUserId: string | null = null, systemUserName: string | null = null) =>
    res.json({ result, systemUserId, systemUserName, message })

  // 1. a linked profile that is an admin of this business manager
  const profiles = await rows(
    sql(
      `SELECT p.permanent_token AS token FROM profile_business_managers j JOIN profiles p ON p.id = j.profile_id
       WHERE j.business_manager_id = ? AND p.permanent_token IS NOT NULL AND p.permanent_token != ''
       ORDER BY j.position_in_business_manager`,
      req.params.id,
    ),
  )
  let admin: FacebookClient | undefined
  for (const profile of profiles) {
    const client = new FacebookClient(profile.token as string)
    const businesses = await client.list('me/businesses', { fields: 'id,permitted_roles', limit: 100 }).catch(() => [])
    if (businesses.some((b) => b.id === bm.bm_id && (b.permitted_roles ?? []).includes('ADMIN'))) {
      admin = client
      break
    }
  }
  if (!admin) return done('no_admin_profile', 'No linked profile with a token is an admin of this Business Manager.')

  try {
    // 2. the system user: an existing one, the saved one, or a new one
    const existing = await admin.list(`${bm.bm_id}/system_users`, { fields: 'id,name,role' })
    const chosen = existing.find((u) => String(u.name).includes('Dashboard Bot')) ?? existing[0]
    let systemUserId = (chosen?.id as string | undefined) ?? (bm.system_user_id as string | null)
    let systemUserName = (chosen?.name as string | undefined) ?? null
    if (!systemUserId) {
      systemUserName = `Dashboard Bot - ${bm.bm_name}`
      try {
        systemUserId = (await admin.post(`${bm.bm_id}/system_users`, { name: systemUserName, role: 'ADMIN' })).id as string
      } catch (error) {
        return done('cannot_create_system_user', (error as Error).message)
      }
    }

    // 3. its token
    let token: string
    try {
      const created = await admin.post(`${systemUserId}/access_tokens`, {
        business_app: facebookConfig().appId,
        scope: SYSTEM_USER_SCOPE,
      })
      token = created.access_token as string
    } catch (error) {
      const message = (error as Error).message
      const code = String((error as ApiError).extra?.facebook ? ((error as ApiError).extra.facebook as { code?: number }).code : '')
      // the app has not been added to this business manager
      return code === '3953' || message.includes('3953') || message.includes('does not belong to the business')
        ? done('app_not_in_business', message, systemUserId, systemUserName)
        : done('error', message, systemUserId, systemUserName)
    }

    const now = nowIso()
    await batch([
      sql(
        `UPDATE business_managers SET system_user_id = ?, system_user_token = ?, system_user_created = ?, updated_at = ?
         WHERE id = ?`,
        systemUserId,
        token,
        now,
        now,
        req.params.id,
      ),
      auditStatement(now, currentUser(res).id, 'facebook_system_user_token_generate', 'business_managers', req.params.id),
    ])
    done('success', 'System user token saved.', systemUserId, systemUserName)
  } catch (error) {
    done('error', (error as Error).message)
  }
})
