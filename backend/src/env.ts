import { env } from 'cloudflare:workers'

// Optional settings. They come from backend/.env: copied to .dev.vars for
// local dev and uploaded as Worker secrets by `npm run deploy`.
export const settings = env as typeof env & {
  // comma-separated dashboard origins allowed to call the API from the browser
  ALLOWED_ORIGINS?: string
  // bearer token for the scheduled worker
  SERVICE_TOKEN?: string
  // public base URL of the bucket that holds files
  PUBLIC_FILES_URL?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  R2_BUCKET_NAME?: string
  R2_ACCESS_KEY_ID?: string
  R2_SECRET_ACCESS_KEY?: string
  REDTRACK_API_KEY?: string
  CLOUDFLARE_IMAGES_ACCOUNT_ID?: string
  CLOUDFLARE_IMAGES_API_TOKEN?: string
  // image generation (src/generation): GPT writes the prompts, Claude refines them, fal.ai draws
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  FAL_KEY?: string
  // a fal admin key, only for reading the credit balance
  FAL_ADMIN_KEY?: string
  // jobs are refused while the fal credit balance is under this many USD (default 5)
  FAL_MIN_BALANCE_USD?: string
  // `true` while Airtable is still being copied in; opens the /import routes to the service token
  IMPORT_ENABLED?: string
  // the Facebook app that issued the stored tokens; the secret signs every Graph call
  FACEBOOK_APP_ID?: string
  FACEBOOK_APP_SECRET?: string
  FACEBOOK_API_VERSION?: string
  // the Facebook Login for Business configuration whose popup hands back a system user token
  FACEBOOK_SYSTEM_USER_CONFIG_ID?: string
  // whose calendar "today" and "last 7 days" follow; defaults to Asia/Bangkok
  TEAM_TIME_ZONE?: string
  // the bucket's r2.dev address, tried when Facebook cannot fetch a video from the main domain
  STORAGE_FALLBACK_URL?: string
  // only ever set by tests, to send Facebook calls to a stand-in server
  FACEBOOK_GRAPH_URL?: string
}
