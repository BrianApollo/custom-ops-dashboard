import type { FieldMapping } from '@ops/shared'
import { Router } from 'express'
import { currentUser } from '../auth/session'
import { getTable } from '../data/registry'
import { appendLinkStatement } from '../data/write'
import { auditStatement } from '../lib/audit'
import { batch, IN_LIST, list, nowIso, rows, sql } from '../lib/d1'
import { notFound } from '../lib/errors'
import type { FbObject } from '../lib/facebook'
import { recordId } from '../lib/ids'
import { withCredential } from './credentials'

export const syncRouter = Router()

type Junction = Extract<FieldMapping, { kind: 'junction' }>
const link = (table: string, field: string) => getTable(table).fields.get(field) as Junction

// each link is added from the child's side, as the dashboard has always done
const BM_PROFILES = link('business_managers', 'Linked Profile')
const AD_ACCOUNT_BMS = link('ad_accounts', 'Linked BM')
const PIXEL_BMS = link('pixels', 'Linked BMs')
const PAGE_PROFILES = link('pages', 'Linked Profiles')

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
// Facebook and brings the four tables up to date. Names are set when a row is
// created and left alone afterwards, since people rename them in the dashboard.
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
    await sql(
      `UPDATE profiles SET profile_id = ?, profile_name = ?, profile_status = 'Active', token_valid = 1, updated_at = ? WHERE id = ?`,
      me.id,
      me.name,
      now,
      profileId,
    ).run()
    log.push({ message: `Connected as ${me.name}`, level: 'info' })

    // ad accounts are read from the profile, not from each business manager:
    // /{bm}/owned_ad_accounts fails for accounts the profile is not an admin of
    const [businesses, pages, accounts] = await Promise.all([
      client.list('me/businesses', { fields: 'id,name,verification_status,permitted_roles', limit: 100 }),
      client.list('me/accounts', { fields: 'id,name,is_published,fan_count,link', limit: 100 }),
      client.list('me/adaccounts', {
        fields: 'id,name,account_status,currency,amount_spent,timezone_name,business{id,name}',
        limit: 200,
      }),
    ])
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
      ...accounts.flatMap((a) => (a.business?.id ? [a.business.id as string] : [])),
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
                'UPDATE business_managers SET bm_status = ?, verification_status = ?, last_synced = ?, updated_at = ? WHERE id = ?',
                status, verification, now, now, id,
              ),
          appendLinkStatement(BM_PROFILES, id, [profileId]),
        ]
      })
      if (statements.length) await batch(statements)
      counts.bms = businesses.length
      log.push({ message: `Found ${businesses.length} Business Manager(s)`, level: 'success' })
    })

    const accountIds = await recordIds('ad_accounts', 'ad_acc_id', accounts.map((a) => String(a.id).replace(/^act_/, '')))
    await step('Ad Accounts', async () => {
      const statements = accounts.flatMap((a) => {
        const fb = String(a.id).replace(/^act_/, '')
        const fresh = accountIds.isNew(fb)
        const id = accountIds.idOf(fb)
        const status = AD_ACCOUNT_STATUS[a.account_status] ?? 'Unknown'
        const spent = a.amount_spent === undefined ? null : Number(a.amount_spent) / 100
        const bm = bms.find(a.business?.id)
        return [
          fresh
            ? sql(
                `INSERT INTO ad_accounts (id, ad_acc_id, ad_acc_name, ad_acc_status, currency, amount_spent, timezone, last_synced, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                id, fb, a.name, status, a.currency ?? null, spent, a.timezone_name ?? null, now, now, now,
              )
            : sql(
                'UPDATE ad_accounts SET ad_acc_status = ?, currency = ?, amount_spent = ?, timezone = ?, last_synced = ?, updated_at = ? WHERE id = ?',
                status, a.currency ?? null, spent, a.timezone_name ?? null, now, now, id,
              ),
          ...(bm ? [appendLinkStatement(AD_ACCOUNT_BMS, id, [bm])] : []),
        ]
      })
      if (statements.length) await batch(statements)
      counts.adAccounts = accounts.length
      log.push({ message: `Found ${accounts.length} Ad Account(s)`, level: 'success' })
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
                'UPDATE pages SET published = ?, fan_count = ?, page_link = ?, last_synced = ?, updated_at = ? WHERE id = ?',
                published, p.fan_count ?? null, p.link ?? null, now, now, id,
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
