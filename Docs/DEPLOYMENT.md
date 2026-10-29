# Deploying BAKAAL to production (Render + Neon + Cloudflare R2)

Production: the app on **Render**, the database on **Neon** (PostgreSQL 18), uploaded documents in a
private **Cloudflare R2** bucket. Nothing deploys by itself: the database migration is applied by hand,
and Render builds the code when `main` is pushed. Never put a credential in this repository, in chat or
in a screenshot.

## Production status — 2026-10-29

| Item | State | Evidence |
|---|---|---|
| Code | **Live: `47503be`** (main) | `/api/health` exists (old code had none); nonce CSP and HSTS on every page |
| Database | **Migrated**: 8 migrations, `20261029120000_billed_charges` applied | `npm run db:neon:status` → up to date; `/api/health` `latestMigration` |
| Backup before the migration | `~/Bakaal-db-backups/2026-10-29_neon_before-billed-charges/` (not in git) | checksum OK, restore-tested |
| Access control | Verified live | anonymous and forged-cookie requests: pages → sign-in, APIs → 401; HTTP → HTTPS |
| Security headers | Verified live | CSP (nonce, strict-dynamic, frame-ancestors none, upgrade-insecure-requests), HSTS, COOP, nosniff, DENY |
| **Document storage** | **NOT persistent** — `storageKind: "local"` | no R2 bucket or credentials exist yet → do 1b, then set the Render variables |
| **Neon password** | **NOT rotated** — still the exposed one | do 1a now |
| Signed-in smoke test | Not run on production (no test account; no real records to touch) | run section 3 yourself after 1a/1b |

Until storage shows `"storageKind":"s3"`, do not upload documents in production: they would be lost at
the next deploy or restart.

## 1. One-time set-up (owner, in the providers' consoles)

### 1a. Rotate the Neon password (if not done since it was exposed)

Neon console → the project → **Branches** → the production branch → **Roles** → `neondb_owner` →
**Reset password**. Then update the password part (between `neondb_owner:` and `@`) in:
- `.env.neon` on this computer (both lines), and
- Render → the service → **Environment**: `DATABASE_URL` and `DIRECT_DATABASE_URL`.

Check from this computer: `npm run db:neon:check` (read-only).

### 1b. Cloudflare R2 bucket (free tier: 10 GB storage)

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**: name `bakaal-documents`, location
   automatic. Leave **Public access disabled** (the default); do not add a custom domain or `r2.dev` URL.
2. R2 → **Manage API tokens** → **Create API token**: permission **Object Read & Write**, applied to the
   `bakaal-documents` bucket only; no expiry or a long one you record. Copy the **Access Key ID**, the
   **Secret Access Key** and the **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`) —
   the secret is shown once.
3. Optional: R2 bucket → **Settings** → object lifecycle: none (documents are kept).
4. **Prove it works before production uses it** (on this computer): put the five values in a git-ignored
   file `.env.storage` in the project folder —
   `DOCUMENT_STORAGE=s3`, `S3_ENDPOINT=…`, `S3_BUCKET=bakaal-documents`, `S3_ACCESS_KEY_ID=…`,
   `S3_SECRET_ACCESS_KEY=…` (plus `S3_REGION=auto`) — then run `npm run storage:check`. It stores a test
   file in the bucket, reads it back, compares it and deletes it, and prints only the bucket and host.
   It must end with `STORAGE CHECK PASSED`. Delete `.env.storage` afterwards (the values live in Render).

### 1c. Render service settings

Render → the web service:

| Setting | Value |
|---|---|
| Build command | `npm ci && npm run build` |
| Start command | `npx next start -p $PORT` (Render sets `PORT`; `npm start` is for this computer: port 3001) |
| Health check path | `/api/health` |
| Instance | one instance (the failed-sign-in limit is kept in memory) |

**Environment** (set as secret values; never in the repository):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (Render's default for Node) |
| `DATABASE_URL` | Neon **pooled** string (host contains `-pooler`), ending `?sslmode=verify-full` |
| `DIRECT_DATABASE_URL` | Neon **direct** string (no `-pooler`), ending `?sslmode=require` |
| `DOCUMENT_STORAGE` | `s3` |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | `bakaal-documents` |
| `S3_ACCESS_KEY_ID` | from 1b |
| `S3_SECRET_ACCESS_KEY` | from 1b |
| `S3_REGION` | `auto` |
| `DOCUMENT_MAX_MB` | optional, default `10` |
| `ERROR_ALERT_WEBHOOK_URL` | optional: a webhook (e.g. Slack incoming webhook) that receives every logged error |

Do **not** set `DOCUMENT_STORAGE_DIR` or a persistent disk: documents go to R2.

## 2. Deploy (in this order)

Every step before 4 can be undone without users noticing; do them in one sitting.

```bash
# 0. On this computer, the branch must be green:
npm run lint && npm run typecheck && npm test && npm run test:integration \
  && npm run build && npm run test:workflow && npm run test:smoke

# 1. Neon backup: console → Branches → Create branch from the production branch,
#    name it e.g. backup-2026-10-29 (instant, copy-on-write). Note its name.

# 2. What is pending (read-only):
npm run db:neon:status
#    expected: "Following migration have not yet been applied: 20261029120000_billed_charges"

# 3. Apply the migration (owner approval required):
npm run db:neon:deploy -- --confirm
npm run db:neon:status          # "Database schema is up to date!"

# 4. Publish the code (Render builds and starts it):
git switch main
git merge --ff-only audit-fixes-2026-10-29
git push origin main
```

The migration `20261029120000_billed_charges` only **adds** a table (`BilledCharge`), fills it from
existing recurring invoice lines (production has none), turns one unique index into a plain index, and
adds columns with defaults to `BillingRun`. It deletes and rewrites nothing. It runs in one transaction:
if it fails, nothing changes and it can be retried.

## 3. Check after the deploy

1. `https://<render-url>/api/health` →
   `{"status":"ok","database":"ok","storage":"ok","storageKind":"s3","latestMigration":"20261029120000_billed_charges",...}`.
   `storage: "unwritable"` means the R2 settings are wrong (endpoint, bucket or key).
2. Sign in; open Dashboard, Billing & Payments, Billing runs, Accounts, Units, Reports, Settings.
3. Upload a test document to a record and open it. Then **restart the service** (Render → Manual
   Deploy → Restart service) and open it again: it must still open (files live in R2, not on the server).
   Remove it afterwards (removal keeps it for the audit trail).
4. Render → **Logs**: lines are JSON; search `"level":"error"`.

## 4. If something goes wrong

| Problem | What to do |
|---|---|
| Step 3 (migration) fails | Nothing was changed (one transaction). Read the message, fix, retry. |
| The new code misbehaves after step 4 | Render → **Manual deploy** → the previous commit (`9e9a4ad`). The database change is additive, so the old code keeps working with it (it no longer has the per-agreement-month rule, so bill through the new code only). |
| Data were damaged | Neon → the backup branch from step 1: restore it as the production branch (Neon "Restore" / reset from parent), or point `DATABASE_URL` to it. Documents in R2 are not affected by a database restore; files whose records are lost stay private and unused. |
| `storage: "unwritable"` | Check the five `S3_*` variables and that the token covers the bucket; redeploy. Uploads fail with a message until fixed; nothing half-saves. |
| Database unreachable (`503` from `/api/health`) | Neon status page; check `DATABASE_URL`; Render restarts on failed health checks. |

## 5. Ongoing

- **Backups**: Neon keeps point-in-time history (plan-dependent window); before any future migration,
  create a backup branch (step 1). R2 objects are written once and never overwritten.
- **Before each release**: the checks in step 0, `npm run test:storage-restart` (documents survive an
  app restart; uses a local test bucket and `bakaal_test`), then `npm run db:neon:status`.
- **Monitoring**: Render health checks on `/api/health`; errors as JSON lines in the logs, and to
  `ERROR_ALERT_WEBHOOK_URL` when set.
- **Scale**: measured 2026-10-29 at 2,880 invoices / 1,920 payments: invoice list ~100 ms, dashboard
  ~130 ms, arrears report ~240 ms. Revisit database-level paging of the lists beyond ~10,000 invoices.
