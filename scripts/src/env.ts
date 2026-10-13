import { z } from 'zod'

// Settings live in backend/.env; the npm scripts load it with `tsx --env-file`
const schema = z.object({
  AIRTABLE_TOKEN: z.string().optional(),
  AIRTABLE_BASE_ID: z.string().min(1),
  IMPORT_API_URL: z.string().url(),
  SERVICE_TOKEN: z.string().min(1),
  CLOUDFLARE_ACCOUNT_ID: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error(`backend/.env is missing or has invalid: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`)
  process.exit(1)
}

export const env = parsed.data
