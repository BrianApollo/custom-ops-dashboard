import { Router } from 'express'
import { currentUser } from '../auth/session'
import { project, readableFields, selectByIds } from '../data/read'
import { getTable } from '../data/registry'
import { createStatements, planWrite } from '../data/write'
import { batch, IN_LIST, list, nowIso, rows, sql } from '../lib/d1'
import { conflict, forbidden, invalid } from '../lib/errors'
import { recordId, RECORD_ID } from '../lib/ids'
import { ruleFor } from '../permissions'

export const actionsRouter = Router()

const TYPES = ['Budget Change', 'Status Change']

// Schedules an action for a Facebook campaign. The duplicate check and the
// insert are one statement, so two people cannot both schedule the same thing.
actionsRouter.post('/schedule', async (req, res) => {
  const user = currentUser(res)
  if (!ruleFor(user.role, 'schedule').create) throw forbidden()

  const { fbCampaignId, type, execute, scheduledAt } = req.body ?? {}
  if (typeof fbCampaignId !== 'string' || !fbCampaignId) throw invalid('fbCampaignId is required', 'fbCampaignId')
  if (!TYPES.includes(type)) throw invalid(`type must be one of: ${TYPES.join(', ')}`, 'type')
  if (typeof execute !== 'string' || !execute) throw invalid('execute is required', 'execute')
  if (typeof scheduledAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledAt)) {
    throw invalid('scheduledAt must be a date as YYYY-MM-DD', 'scheduledAt')
  }

  const schedule = getTable('schedule')
  const projection = project(schedule, readableFields(schedule, user, true))
  const id = recordId()
  const [inserted, selected] = await batch([
    sql(
      `INSERT INTO schedule (id, fb_campaign_id, campaign_id, source, type, execute, scheduled_at, status, created_at, updated_at)
       SELECT ?1, ?2, (SELECT id FROM campaigns WHERE fb_campaign_id = ?2 ORDER BY created_at LIMIT 1),
              'Manual', ?3, ?4, ?5, 'Pending', ?6, ?6
       WHERE NOT EXISTS (
         SELECT 1 FROM schedule WHERE status = 'Pending' AND scheduled_at = ?5 AND fb_campaign_id = ?2 AND type = ?3
       )
       RETURNING id`,
      id,
      fbCampaignId,
      type,
      execute,
      scheduledAt,
      nowIso(),
    ),
    selectByIds(schedule, projection, [id]),
  ])
  if (!inserted.results.length) {
    throw conflict(`A pending ${type} is already scheduled for this campaign on ${scheduledAt}`)
  }
  res.json(projection.decode(selected.results[0]))
})

const FORMATS = ['Vertical', 'Square', 'YouTube']
const TEXT_VERSIONS = ['Text', 'No Text']
const MAX_SCRIPTS = 1000

function choices(body: Record<string, unknown>, key: string, allowed: string[]) {
  const value = body[key] ?? allowed
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => !allowed.includes(v))) {
    throw invalid(`${key} must be a list of: ${allowed.join(', ')}`, key)
  }
  return [...new Set(value as string[])]
}

function idList(body: Record<string, unknown>, key: string) {
  const value = body[key] ?? []
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !RECORD_ID.test(id))) {
    throw invalid(`${key} must be a list of record ids`, key)
  }
  return [...new Set(value as string[])]
}

// Gives scripts to editors: one To Do video per script, editor, format and
// text version. A combination that already has a video is skipped, so the
// request is safe to repeat. One statement creates every missing video.
//
// The name must match what the frontend builds, because uploaded files are
// stored under it: {Script Name} - {Format} - {Editor Name}[ - No Text]
actionsRouter.post('/videos/bulk-assign', async (req, res) => {
  const user = currentUser(res)
  if (!ruleFor(user.role, 'videos').create) throw forbidden()

  const body = req.body ?? {}
  const scriptIds = idList(body, 'scriptIds')
  const editorIds = idList(body, 'editorIds')
  const formats = choices(body, 'formats', FORMATS)
  const textVersions = choices(body, 'textVersions', TEXT_VERSIONS)
  if (scriptIds.length === 0 || scriptIds.length > MAX_SCRIPTS) {
    throw invalid(`scriptIds must hold 1 to ${MAX_SCRIPTS} ids`, 'scriptIds')
  }

  // no editors chosen means every active video editor
  const editors = editorIds.length
    ? { where: `u.id IN ${IN_LIST}`, params: [list(editorIds)] }
    : { where: `u.role = 'Video Editor' AND u.active = 1`, params: [] }

  const [scripts, people] = await batch([
    sql(`SELECT count(*) AS n FROM video_scripts WHERE id IN ${IN_LIST}`, list(scriptIds)),
    sql(`SELECT count(*) AS n FROM users u WHERE ${editors.where}`, ...editors.params),
  ])
  if (scripts.results[0].n !== scriptIds.length) throw invalid('scriptIds contains an id that does not exist', 'scriptIds')
  const editorCount = people.results[0].n as number
  if (editorIds.length && editorCount !== editorIds.length) {
    throw invalid('editorIds contains an id that does not exist', 'editorIds')
  }

  const now = nowIso()
  const created = await rows(
    sql(
      `INSERT INTO videos (id, video_name, product_id, script_id, editor_id, format, text_version, status, created_at, updated_at)
       SELECT 'rec' || lower(hex(randomblob(7))),
              coalesce(s.name, '') || ' - ' || f.value || ' - ' || coalesce(u.name, '')
                || CASE WHEN tv.value = 'No Text' THEN ' - No Text' ELSE '' END,
              s.product_id, s.id, u.id, f.value, tv.value, 'To Do', ?, ?
       FROM video_scripts s
       JOIN users u ON ${editors.where}
       CROSS JOIN json_each(?) f
       CROSS JOIN json_each(?) tv
       WHERE s.id IN ${IN_LIST}
         AND NOT EXISTS (
           SELECT 1 FROM videos v
           WHERE v.script_id = s.id AND v.editor_id = u.id AND v.format = f.value AND v.text_version = tv.value
         )
       RETURNING id`,
      now,
      now,
      ...editors.params,
      list(formats),
      list(textVersions),
      list(scriptIds),
    ),
  )

  const wanted = scriptIds.length * editorCount * formats.length * textVersions.length
  res.json({ created: created.length, skipped: wanted - created.length, ids: created.map((row) => row.id) })
})

// Creates an image and gives it the next number for its product. The number
// is worked out inside the insert, so two uploads at once cannot get the same one.
actionsRouter.post('/images', async (req, res) => {
  const user = currentUser(res)
  if (!ruleFor(user.role, 'images').create) throw forbidden()

  const images = getTable('images')
  const { Count: _ignored, ...fields } = req.body?.fields ?? {}
  const plan = planWrite(images, fields, user)
  const productId = plan.columns.product_id
  if (!productId) throw invalid('Product is required', 'Product')

  const projection = project(images, readableFields(images, user, true))
  const id = recordId()
  const results = await batch([
    ...createStatements(images, id, plan, nowIso(), {
      count: { sql: '(SELECT coalesce(max(count), 0) + 1 FROM images WHERE product_id = ?)', params: [productId] },
    }),
    selectByIds(images, projection, [id]),
  ])
  res.json(projection.decode(results[results.length - 1].results[0]))
})
