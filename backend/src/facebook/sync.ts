import type { FieldMapping } from '@ops/shared'
import { Router } from 'express'
import { currentUser } from '../auth/session'
import { getTable } from '../data/registry'
import { appendLinkStatement, linkStatements } from '../data/write'
import { auditStatement } from '../lib/audit'
import { batch, IN_LIST, list, nowIso, rows, sql } from '../lib/d1'
import { notFound } from '../lib/errors'
import { FacebookClient, type FbObject } from '../lib/facebook'
import { recordId } from '../lib/ids'
import { withCredential } from './credentials'

export const syncRouter = Router()

type Junction = Extract<FieldMapping, { kind: 'junction' }>
const link = (table: string, field: string) => getTable(table).fields.get(field) as Junction

// each link is added from the child's side, as the dashboard has always done
const BM_PROFILES = link('business_managers', 'Linked Profile')
const PIXEL_BMS = link('pixels', 'Linked BMs')
const PAGE_PROFILES = link('pages', 'Linked Profiles')
// replaced whole from the business manager's side, since Facebook gives its full list
const BM_AD_ACCOUNTS = link('business_managers', 'Linked Ad Accs')

const ACCOUNT_FIELDS = 'id,name,account_status,currency,amount_spent,timezone_name,business{id,name}'
const fbAccountId = (account: FbObject) => String(account.id).replace(/^act_/, '')

// A Business Manager's own ad accounts and the ones partners share with it, read
// with the profile's token. A profile that may not see them, such as an employee
// of the business, is retried with the business's system user token when one is stored.
async function bmAccounts(client: FacebookClient, bmId: string) {
  const read = (c: FacebookClient) =>
    Promise.all([
      c.list(`${bmId}/owned_ad_accounts`, { fields: ACCOUNT_FIELDS, limit: 200 }),
      c.list(`${bmId}/client_ad_accounts`, { fields: ACCOUNT_FIELDS, limit: 200 }),
    ])
  try {
    return await read(client)
  } catch (error) {
    const [row] = await rows(
      sql(`SELECT system_user_token AS token FROM business_managers WHERE bm_id = ? AND system_user_token != '' LIMIT 1`, bmId),
    )
    if (!row?.token) throw error
    return await read(new FacebookClient(row.token as string))
  }
}

const AD_ACCOUNT_STATUS: Record<number, string> = {
  1: 'ACTIVE',
  2: 'DISABLED',
  3: 'UNSETTLED',
  7: 'PENDING_RISK_REVIEW',
  9: 'IN_GRACE_PERIOD',
  100: 'PENDING_CLOSURE',
  101: 'CLOSED',
}

// Facebook writes times as 2026-10-09T12:00:00+0000; the database holds ISO UTC
const isoTime = (value: unknown) => {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

// Which Facebook ids already have a row. A new id gets a record id now, so the
// insert and the links that point at it can go in one batch.
async function recordIds(table: string, keyColumn: string, facebookIds: string[]) {
  const existing = await rows(sql(`SELECT id, ${keyColumn} AS fb FROM ${table} WHERE ${keyColumn} IN ${IN_LIST} ORDER BY created_at DESC`, list(facebookIds)))
  const known = new Map(existing.map((row) => [row.fb as string, row.id as string]))
  return {
    isNew: (fb: string) => !known.has(fb),
    idOf: (fb: string) => known.get(fb) ?? known.set(fb, recordId()).get(fb)!,
    find: (fb: string | undefined) => (fb ? known.get(fb) : undefined),
  }
}

// POST /profiles/{id}/sync
// Reads the profile's business managers, ad accounts, pixels and pages from
// Facebook and brings the four tables up to date. Names follow Facebook: a
// Business Manager, ad account or page renamed there is renamed here too.
//
// Each ad account gets its owner (owner_bm_id, empty for a personal account).
// An ad account is linked only to the profile's own Business Managers that hold
// it, owned or shared in by a partner; its owner is not linked unless the
// profile belongs to it too.
syncRouter.post('/profiles/:id/sync', async (req, res) => {
  const profileId = req.params.id
  const [profile] = await rows(sql('SELECT id FROM profiles WHERE id = ?', profileId))
  if (!profile) throw notFound(`Profile ${profileId}`)

  const result = await withCredential(`profile:${profileId}`, async ({ client }) => {
    const now = nowIso()
    const counts = { bms: 0, pages: 0, adAccounts: 0, pixels: 0, errors: 0 }
    const log: { message: string; level: 'info' | 'success' | 'error' }[] = []
    const step = async (name: string, work: () => Promise<void>) => {
      try {
        await work()
      } catch (error) {
        counts.errors++
        log.push({ message: `${name} failed: ${(error as Error).message}`, level: 'error' })
      }
    }

    const me = await client.get('me', { fields: 'id,name' })
    // a profile marked Banned or Inactive in the Profile Hub stays that way; a sync only confirms a working one
    await sql(
      `UPDATE profiles SET profile_id = ?, profile_name = ?, token_valid = 1, updated_at = ?,
         profile_status = CASE WHEN profile_status IN ('Banned', 'Inactive') THEN profile_status ELSE 'Active' END
       WHERE id = ?`,
      me.id,
      me.name,
      now,
      profileId,
    ).run()
    log.push({ message: `Connected as ${me.name}`, level: 'info' })

    // the accounts the profile can use, and each of its business managers' own and shared lists
    const [businesses, pages, accounts] = await Promise.all([
      client.list('me/businesses', { fields: 'id,name,verification_status,permitted_roles', limit: 100 }),
      client.list('me/accounts', { fields: 'id,name,is_published,fan_count,link', limit: 100 }),
      client.list('me/adaccounts', { fields: ACCOUNT_FIELDS, limit: 200 }),
    ])
    // a business manager whose lists cannot be read keeps the links it had
    const bmLists = (
      await Promise.all(
        businesses.map(async (business) => {
          try {
            const [owned, shared] = await bmAccounts(client, business.id)
            return { business, owned, shared }
          } catch (error) {
            counts.errors++
            log.push({ message: `${business.name}: could not read its ad accounts: ${(error as Error).message}`, level: 'error' })
            return undefined
          }
        }),
      )
    ).filter((read) => read !== undefined)
    // every ad account seen, once
    const allAccounts = new Map<string, FbObject>()
    for (const account of [...accounts, ...bmLists.flatMap((read) => [...read.owned, ...read.shared])]) {
      if (!allAccounts.has(fbAccountId(account))) allAccounts.set(fbAccountId(account), account)
    }
    const pixelLists = await Promise.all(
      accounts.map((account) =>
        client
          .list(`${account.id}/adspixels`, { fields: 'id,name,last_fired_time,owner_business{id,name}', limit: 100 })
          // an account whose pixels cannot be read simply has none
          .catch(() => [] as FbObject[]),
      ),
    )

    const bms = await recordIds('business_managers', 'bm_id', [
      ...businesses.map((b) => b.id as string),
      ...[...allAccounts.values()].flatMap((a) => (a.business?.id ? [a.business.id as string] : [])),
      ...pixelLists.flat().flatMap((p) => (p.owner_business?.id ? [p.owner_business.id as string] : [])),
    ])

    await step('Business Managers', async () => {
      const statements = businesses.flatMap((b) => {
        const fresh = bms.isNew(b.id)
        const id = bms.idOf(b.id)
        const status = b.verification_status ?? 'Active'
        const verification = b.verification_status ?? 'not_verified'
        return [
          fresh
            ? sql(
                `INSERT INTO business_managers (id, bm_id, bm_name, bm_status, verification_status, last_synced, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                id, b.id, b.name, status, verification, now, now, now,
              )
            : sql(
                'UPDATE business_managers SET bm_name = ?, bm_status = ?, verification_status = ?, last_synced = ?, updated_at = ? WHERE id = ?',
                b.name, status, verification, now, now, id,
              ),
          appendLinkStatement(BM_PROFILES, id, [profileId]),
        ]
      })
      if (statements.length) await batch(statements)
      counts.bms = businesses.length
      log.push({ message: `Found ${businesses.length} Business Manager(s)`, level: 'success' })
    })

    const accountIds = await recordIds('ad_accounts', 'ad_acc_id', [...allAccounts.keys()])
    await step('Ad Accounts', async () => {
      // an owner the profile does not belong to is kept as a bare record, so the
      // account can name it; it is not linked to the profile or marked synced
      const owners = new Map<string, string>()
      for (const a of allAccounts.values()) if (a.business?.id) owners.set(a.business.id, a.business.name ?? '')
      const ownerStatements = [...owners].flatMap(([bmId, name]) => {
        if (businesses.some((b) => b.id === bmId)) return []
        if (bms.isNew(bmId)) {
          return [
            sql(
              'INSERT INTO business_managers (id, bm_id, bm_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
              bms.idOf(bmId), bmId, name || null, now, now,
            ),
          ]
        }
        return name ? [sql('UPDATE business_managers SET bm_name = ?, updated_at = ? WHERE id = ?', name, now, bms.idOf(bmId))] : []
      })

      const accountStatements = [...allAccounts].map(([fb, a]) => {
        const fresh = accountIds.isNew(fb)
        const id = accountIds.idOf(fb)
        const status = AD_ACCOUNT_STATUS[a.account_status] ?? 'Unknown'
        const spent = a.amount_spent === undefined ? null : Number(a.amount_spent) / 100
        const owner = bms.find(a.business?.id) ?? null
        return fresh
          ? sql(
              `INSERT INTO ad_accounts (id, ad_acc_id, ad_acc_name, ad_acc_status, currency, amount_spent, timezone, owner_bm_id, last_synced, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              id, fb, a.name, status, a.currency ?? null, spent, a.timezone_name ?? null, owner, now, now, now,
            )
          : sql(
              `UPDATE ad_accounts SET ad_acc_name = ?, ad_acc_status = ?, currency = ?, amount_spent = ?, timezone = ?, owner_bm_id = ?,
                 last_synced = ?, updated_at = ? WHERE id = ?`,
              a.name, status, a.currency ?? null, spent, a.timezone_name ?? null, owner, now, now, id,
            )
      })

      // each business manager read is linked to exactly what Facebook lists for it
      const linkLines = bmLists.flatMap(({ business, owned, shared }) =>
        linkStatements(BM_AD_ACCOUNTS, bms.idOf(business.id), [...owned, ...shared].map((a) => accountIds.idOf(fbAccountId(a))), false),
      )

      const statements = [...ownerStatements, ...accountStatements, ...linkLines]
      if (statements.length) await batch(statements)
      counts.adAccounts = allAccounts.size
      log.push({ message: `Found ${allAccounts.size} Ad Account(s), ${accounts.length} of them usable by this profile`, level: 'success' })
      for (const { business, owned, shared } of bmLists) {
        log.push({ message: `${business.name}: ${owned.length} owned, ${shared.length} shared by partners`, level: 'info' })
      }
    })

    await step('Pixels', async () => {
      // a pixel shared by several ad accounts is handled once
      const pixels = new Map<string, { pixel: FbObject; accountBusiness: string | undefined }>()
      pixelLists.forEach((found, i) => {
        for (const pixel of found) {
          if (!pixels.has(pixel.id)) pixels.set(pixel.id, { pixel, accountBusiness: accounts[i].business?.id })
        }
      })
      const pixelIds = await recordIds('pixels', 'pixel_id', [...pixels.keys()])
      const statements = [...pixels.values()].flatMap(({ pixel, accountBusiness }) => {
        const fresh = pixelIds.isNew(pixel.id)
        const id = pixelIds.idOf(pixel.id)
        // its owner, else the business manager of the ad account it was found on
        const bm = bms.find(pixel.owner_business?.id) ?? bms.find(accountBusiness)
        const fired = isoTime(pixel.last_fired_time)
        return [
          fresh
            ? sql(
                `INSERT INTO pixels (id, pixel_id, pixel_name, last_fired_time, available, owner_bm_id, last_synced, created_at, updated_at)
                 VALUES (?, ?, ?, ?, 'Yes', ?, ?, ?, ?)`,
                id, pixel.id, pixel.name, fired, bm ?? null, now, now, now,
              )
            : sql(
                `UPDATE pixels SET last_fired_time = ?, available = 'Yes', last_synced = ?, updated_at = ? WHERE id = ?`,
                fired, now, now, id,
              ),
          ...(bm ? [appendLinkStatement(PIXEL_BMS, id, [bm])] : []),
        ]
      })
      if (statements.length) await batch(statements)
      counts.pixels = pixels.size
      log.push({ message: `Found ${pixels.size} Pixel(s)`, level: 'success' })
    })

    await step('Pages', async () => {
      const pageIds = await recordIds('pages', 'page_id', pages.map((p) => p.id as string))
      const statements = pages.flatMap((p) => {
        const fresh = pageIds.isNew(p.id)
        const id = pageIds.idOf(p.id)
        const published = p.is_published ? 'Published' : 'Unpublished'
        return [
          fresh
            ? sql(
                `INSERT INTO pages (id, page_id, page_name, published, fan_count, page_link, last_synced, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                id, p.id, p.name, published, p.fan_count ?? null, p.link ?? null, now, now, now,
              )
            : sql(
                'UPDATE pages SET page_name = ?, published = ?, fan_count = ?, page_link = ?, last_synced = ?, updated_at = ? WHERE id = ?',
                p.name, published, p.fan_count ?? null, p.link ?? null, now, now, id,
              ),
          appendLinkStatement(PAGE_PROFILES, id, [profileId]),
        ]
      })
      if (statements.length) await batch(statements)
      counts.pages = pages.length
      log.push({ message: `Found ${pages.length} Page(s)`, level: 'success' })
    })

    await batch([
      sql('UPDATE profiles SET last_sync = ?, updated_at = ? WHERE id = ?', now, now, profileId),
      auditStatement(now, currentUser(res).id, 'facebook_sync', 'profiles', profileId, counts),
    ])
    log.push({
      message: counts.errors ? `Sync finished with ${counts.errors} error(s)` : 'Sync complete',
      level: counts.errors ? 'error' : 'success',
    })
    return { counts, log }
  })
  res.json(result)
})
