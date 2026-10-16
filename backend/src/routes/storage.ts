import { Router } from 'express'
import { currentUser, type AuthUser } from '../auth/session'
import { project, readableFields, selectByIds } from '../data/read'
import { getTable } from '../data/registry'
import { settings } from '../env'
import { batch, nowIso, rows, sql } from '../lib/d1'
import { ApiError, forbidden, invalid, notFound } from '../lib/errors'
import { recordId, RECORD_ID } from '../lib/ids'
import { keyFromUrl, presignUpload, publicUrl } from '../lib/storage'
import { ruleFor } from '../permissions'

// Files live in one R2 bucket. The browser uploads straight to R2 through a
// short-lived link; the server decides where each file goes.
export const storageRouter = Router()

const MB = 1024 * 1024

// What may be uploaded, by whom, and under which key. The key layouts are the
// ones already in the bucket, so existing links stay valid.
const KINDS = {
  video: { table: 'videos', folder: 'Videos', types: /^video\//, maxBytes: 5000 * MB },
  'ai-video': { table: 'ai_videos', folder: 'AI-Videos', types: /^video\//, maxBytes: 5000 * MB },
  image: { table: 'images', folder: 'Images', types: /^image\//, maxBytes: 50 * MB },
  'product-image': { table: 'products', folder: null, types: /^image\//, maxBytes: 50 * MB },
  profile: { table: 'profiles', folder: null, types: /^(image\/|application\/pdf$)/, maxBytes: 25 * MB },
} as const

type Kind = keyof typeof KINDS

function segment(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim() || /[/\\\u0000-\u001f]/.test(value) || value === '..') {
    throw invalid(`${name} is not a valid file name`, name)
  }
  return value.trim()
}

function mayUpload(user: AuthUser, kind: Kind) {
  const rule = ruleFor(user.role, KINDS[kind].table)
  // editors upload the videos assigned to them; images are created by upload
  if (kind === 'video' || kind === 'ai-video') return Boolean(rule.update)
  return kind === 'image' ? Boolean(rule.create) : rule.update === true
}

async function productName(productId: unknown) {
  if (typeof productId !== 'string' || !RECORD_ID.test(productId)) throw invalid('productId is required', 'productId')
  const [product] = await rows(sql('SELECT product_name FROM products WHERE id = ?', productId))
  if (!product?.product_name) throw notFound(`Product ${productId}`)
  return product.product_name as string
}

// POST /storage/presign { kind, productId | profileId, fileName, contentType, contentLength, field? }
storageRouter.post('/storage/presign', async (req, res) => {
  const body = req.body ?? {}
  const kind = body.kind as Kind
  const spec = KINDS[kind]
  if (!spec) throw invalid(`kind must be one of: ${Object.keys(KINDS).join(', ')}`, 'kind')
  if (!mayUpload(currentUser(res), kind)) throw forbidden()

  const fileName = segment(body.fileName, 'fileName')
  const { contentType, contentLength } = body
  if (typeof contentType !== 'string' || !spec.types.test(contentType)) {
    throw invalid(`contentType is not allowed for ${kind}`, 'contentType')
  }
  if (!Number.isInteger(contentLength) || contentLength < 1 || contentLength > spec.maxBytes) {
    throw invalid(`contentLength must be between 1 and ${spec.maxBytes} bytes`, 'contentLength')
  }

  let key: string
  if (kind === 'profile') {
    if (typeof body.profileId !== 'string' || !RECORD_ID.test(body.profileId)) {
      throw invalid('profileId is required', 'profileId')
    }
    key = `profiles/${body.profileId}/${segment(body.field, 'field')}/${Date.now()}-${fileName}`
  } else if (kind === 'product-image') {
    await productName(body.productId)
    key = `${body.productId}/${fileName}`
  } else {
    key = `${await productName(body.productId)}/${spec.folder}/${fileName}`
  }

  res.json({ uploadUrl: await presignUpload(key, contentType, contentLength), publicUrl: publicUrl(key), key })
})

// Which table's write permission guards a stored file, read from its key
function ownerTable(key: string) {
  if (key.startsWith('profiles/')) return 'profiles'
  const folder = key.split('/')[1]
  if (folder === 'Videos') return 'videos'
  if (folder === 'AI-Videos') return 'ai_videos'
  return folder === 'Images' ? 'images' : 'products'
}

// POST /storage/delete { key }. A file that is already gone counts as deleted.
storageRouter.post('/storage/delete', async (req, res) => {
  const key = req.body?.key
  if (typeof key !== 'string' || !key || key.includes('..')) throw invalid('key is required', 'key')
  const user = currentUser(res)
  const table = ownerTable(key)
  const rule = ruleFor(user.role, table)

  if (table === 'images' ? !rule.delete : !rule.update) throw forbidden()
  if (typeof rule.update === 'object') {
    // an editor may remove only the file of a video assigned to them
    const [own] = await rows(
      sql(`SELECT 1 AS ok FROM ${table} WHERE creative_link = ? AND ${rule.update.ownColumn} = ?`, publicUrl(key), user.id),
    )
    if (!own) throw forbidden('You can only delete files of videos assigned to you')
  }

  await settings.BUCKET.delete(key)
  res.json({ success: true })
})

async function deleteCloudflareImage(imageId: string) {
  const { CLOUDFLARE_IMAGES_ACCOUNT_ID: account, CLOUDFLARE_IMAGES_API_TOKEN: token } = settings
  if (!account || !token) return null
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/images/v1/${encodeURIComponent(imageId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
  if (response.status === 404) return 'already_deleted'
  if (!response.ok) throw new ApiError(502, 'upstream_error', `Cloudflare Images answered ${response.status}`)
  return 'deleted'
}

storageRouter.delete('/cloudflare/images/:id', async (req, res) => {
  if (!ruleFor(currentUser(res).role, 'images').create) throw forbidden()
  const result = await deleteCloudflareImage(req.params.id)
  if (!result) throw new ApiError(503, 'not_configured', 'Cloudflare Images is not set up on the server')
  res.json(result === 'deleted' ? { success: true } : { success: true, alreadyDeleted: true })
})

// The bucket key behind a link, or null when the file is not in our bucket
function ownKey(link: string) {
  try {
    return keyFromUrl(link, 'link')
  } catch {
    return null
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

// Turns a generated temp image into a permanent one: copies the file into the
// bucket, creates the Images row with the product's next number, carries over
// its angles and removes the temp row. The database part is one transaction.
storageRouter.post('/temp-images/:id/approve', async (req, res) => {
  const user = currentUser(res)
  if (!ruleFor(user.role, 'images').create || !ruleFor(user.role, 'temp_images').delete) throw forbidden()

  const { id } = req.params
  const [temp] = await rows(
    sql(
      `SELECT t.image_drive_link AS link, t.product_id, p.product_name
       FROM temp_images t LEFT JOIN products p ON p.id = t.product_id WHERE t.id = ?`,
      id,
    ),
  )
  if (!temp) throw notFound(`Temp image ${id}`)
  const link = temp.link as string | null
  const product = temp.product_name as string | null
  if (!link?.startsWith('https://') || !product) throw invalid('The temp image has no file link or no product')

  const source = await fetch(link)
  const contentType = (source.headers.get('Content-Type') ?? '').split(';')[0]
  const extension = EXTENSIONS[contentType]
  if (!source.ok || !extension) throw new ApiError(502, 'upstream_error', 'The temp image file could not be downloaded')
  const bytes = await source.arrayBuffer()
  if (bytes.byteLength > KINDS.image.maxBytes) throw invalid('The temp image file is too large')

  const images = getTable('images')
  const projection = project(images, readableFields(images, user, true))
  const imageId = recordId()
  const now = nowIso()

  // The file name carries the image number, so the number is read first and
  // the insert only goes through if nobody else took it in the meantime
  for (let attempt = 0; attempt < 3; attempt++) {
    const [next] = await rows(sql('SELECT coalesce(max(count), 0) + 1 AS n FROM images WHERE product_id = ?', temp.product_id))
    const count = next.n as number
    const name = `${product}_ImageAd_${String(count).padStart(3, '0')}`
    const key = `${product}/Images/${name}.${extension}`
    await settings.BUCKET.put(key, bytes, { httpMetadata: { contentType } })

    const [inserted, , , selected] = await batch([
      sql(
        `INSERT INTO images (id, image_name, product_id, image_drive_link, count, created_at, updated_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6
         WHERE NOT EXISTS (SELECT 1 FROM images WHERE product_id = ?3 AND count >= ?5)
         RETURNING id`,
        imageId,
        name,
        temp.product_id,
        publicUrl(key),
        count,
        now,
      ),
      sql(
        `INSERT INTO angle_images (angle_id, image_id, position_in_angle, position_in_image)
         SELECT a.angle_id, ?1,
                coalesce((SELECT max(x.position_in_angle) + 1 FROM angle_images x WHERE x.angle_id = a.angle_id), 0),
                a.position_in_temp_image
         FROM angle_temp_images a
         WHERE a.temp_image_id = ?2 AND EXISTS (SELECT 1 FROM images WHERE id = ?1)`,
        imageId,
        id,
      ),
      sql('DELETE FROM temp_images WHERE id = ?1 AND EXISTS (SELECT 1 FROM images WHERE id = ?2)', id, imageId),
      selectByIds(images, projection, [imageId]),
    ])

    if (inserted.results.length) {
      // older generated images are served from Cloudflare Images until now;
      // newer ones sit in the bucket under a temporary name
      const cloudflareId = link.includes('imagedelivery.net/') ? new URL(link).pathname.split('/')[2] : null
      const removed = cloudflareId ? await deleteCloudflareImage(cloudflareId).catch(() => null) : null
      const tempKey = cloudflareId ? null : ownKey(link)
      if (tempKey && tempKey !== key) await settings.BUCKET.delete(tempKey).catch(() => undefined)
      res.json({ image: projection.decode(selected.results[0]), cloudflareImageDeleted: removed !== null })
      return
    }
    await settings.BUCKET.delete(key)
  }
  throw new ApiError(409, 'conflict', 'Another image was being added at the same time. Try again.')
})
