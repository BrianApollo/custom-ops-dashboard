# Running the dashboard locally

A local copy of the whole dashboard (API Worker + built frontend) that runs on
your machine with its own database and file bucket. It never touches production:
no Cloudflare login, no `backend/.env`, no real keys.

## Three commands

```bash
npm install
npm run local:setup   # writes local config, creates the local database, seeds it
npm run local:dev     # http://localhost:8787
```

`local:setup` prints a generated password once. To choose it yourself:
`LOCAL_SEED_PASSWORD='something-long' npm run local:setup`.

Port 8787 taken? `npm run local:dev -- --port 8788` (or `LOCAL_PORT=8788`).

Start over from an empty database: `npm run local:reset`.
Re-seed without wiping: `npm run local:seed -w @ops/backend`.

## Test logins

| Role         | Email                 | Password                         |
|--------------|-----------------------|----------------------------------|
| Admin        | `admin@example.test`  | printed by `local:setup` (or `LOCAL_SEED_PASSWORD`) |
| Video Editor | `editor@example.test` | same                             |

The seed also adds one product, one script and two videos (one assigned to the editor).
Re-running the seed keeps existing passwords unless `LOCAL_SEED_PASSWORD` is set.

## Why it cannot reach production

- Config is generated from `backend/wrangler.local.template.jsonc` into `backend/.local/`
  (git-ignored). The Worker is named `ops-dashboard-local`, the D1 id is all zeros, and
  no binding has `"remote": true`. The scripts refuse to run if one ever does.
- Every wrangler call passes `--local`, runs from `backend/.local/` (so `backend/.env` and
  `backend/.dev.vars` are never read), and has all `CLOUDFLARE_*` variables removed.
- The Worker's variables come from `backend/.local/.dev.vars`: made-up values, a random
  service token, empty third-party keys, `IMPORT_ENABLED=false`.
- Data lives in `backend/.wrangler/local-state/` (git-ignored). There is no cron trigger.

## What does not work locally

- Anything that calls Facebook (launches, campaign reads, token checks, system user connect).
- RedTrack reports and anything else that needs `REDTRACK_API_KEY`.
- Image generation (OpenAI, Anthropic, fal) and Cloudflare Images.
- Presigned upload links and copying files by URL: they need real R2 API keys. The local
  bucket itself works through the Worker binding, but public file links
  (`PUBLIC_FILES_URL`) point at a placeholder.
- The nightly scheduled job does not run (no cron trigger locally).
- The Airtable import (`npm run import`) is not part of local mode.

## Copy of real data

Fills the local database with a read-only copy of one live dashboard database, with
every credential removed. Run `npm run local:setup` first.

```bash
COPY_CF_API_TOKEN='<read-only D1 token>' npm run local:copy -- \
  --account-id "$COPY_CF_ACCOUNT_ID" --database-id "$COPY_D1_DATABASE_ID"
```

- `COPY_CF_ACCOUNT_ID` / `COPY_D1_DATABASE_ID` can be set instead of the flags. The token is
  read from `COPY_CF_API_TOKEN` only; it is never a flag, never printed and never saved.
- `--dry` prints the plan (tables copied and skipped, columns kept and blanked) and fetches no rows.
  `--tables a,b` copies only those tables (other tables lose links to the wiped rows).
  `--no-seed` skips re-creating the test logins.
- Only `SELECT` statements are ever sent to the live database. Run again to replace the copy.

What is removed:

- Never copied: `sessions`, `audit_log`, `idempotency_keys`, `rate_limits`, `jobs` and internal tables.
- Blanked (selected as `NULL`, so the values never leave Cloudflare): every column behind
  `NEVER_FIELDS` and `SECRET_FIELDS` in `backend/src/permissions.ts` (Facebook tokens, profile
  passwords, 2FA, recovery codes, proxy, original data, system user id), user passwords, and any
  column whose name looks like a credential (password, token, secret, 2FA, OTP, recovery, proxy,
  cookie, API key). The full list prints before copying; the script then checks that each one is
  empty in the local copy.
- Every copied user is set inactive (names stay so editor names show), then the seed re-creates
  the two test logins above.

The copy lives only in `backend/.wrangler/local-state/` (git-ignored); a temporary SQL file in
`backend/.local/` is deleted after loading. `npm run local:reset` deletes the copy.

Facebook-backed screens (campaign reads, token checks, launches) stay empty or fail locally
because the tokens are removed. Attachment rows are copied, but the files are not, so file
previews do not load.

## Checks

`./verify.sh` runs typecheck, unit tests, a secret scan, a personal-info scan and a guard
that no new npm script uses production flags. CI runs the same on every push.
