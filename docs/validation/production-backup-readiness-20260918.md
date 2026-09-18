# Production backup / recovery readiness — 2026-09-18

**Status: NOT READY — missing host credentials and AWS CLI**

This record documents a read-only production inspection. It does **not** authorize production migration, deployment, or enabling `medverse-backup.timer`.

Inspection host: `vmi3579667`. Time: **2026-09-18T02:51Z–02:52Z** UTC. Production was not migrated, restarted, or reconfigured.

## Production (unchanged)

| Item | Live state |
|---|---|
| App release | `20260915T022632Z-duplicate-registration-fix` |
| Health | `GET /api/health` **200** `{ ok: true, service: "medverse-lms" }` |
| DB | `medverse`, listen `localhost`, head **`20260914000002`** |
| Data | 2 profiles, 0 tests, 0 attempts |
| PostgREST | `db-pool = 10` (unchanged) |
| pg_cron | `medverse-auto-submit` `* * * * *` active |
| Isolated load-test cluster | not present (`17/main` only) |

## Designed backup path (kept)

Canonical: [deployment.md](../deployment.md). Scripts: `deploy/scripts/backup-to-r2.sh`, `restore-from-r2.sh`. Encrypted custom-format `pg_dump` → R2 HEAD-verify. Restore into a **non-production** database only. Do **not** enable `medverse-backup.timer` until backup RPO is approved; a tagged pre-migration dump is a manual run.

Those scripts exist in the current production release tree. `pg_dump`, `pg_restore`, and `openssl` are installed.

## Gaps that blocked this pass

| Required | Production state |
|---|---|
| `/etc/medverse/backup.env` | **missing** |
| `DUMP_ENCRYPTION_KEY` | **missing** (not in production or staging env files) |
| Production `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | **unset** in `/etc/medverse/nextjs.env` |
| AWS CLI v2 (`aws`) | **missing** |
| `medverse-backup.service` / `.timer` in `/etc/systemd/system` | **not installed** (correct until RPO approval; not a substitute for a manual dump) |

Staging `/etc/medverse-staging/nextjs.env` has R2 keys for that environment. They were **not** copied into production `backup.env`: production dumps need an owner-supplied production bucket (or an explicit decision to share the existing R2 account/bucket with prefix `medverse/production/`). `DUMP_ENCRYPTION_KEY` still would not exist.

No values were invented. No local-only unencrypted dump was taken (that would weaken the documented R2 gate).

## What must happen after credentials exist

Operator supplies, on the VPS only (mode `0640`, never git):

1. Cloudflare R2 account id, access key, secret key, and **production backup bucket name**.
2. A new `DUMP_ENCRYPTION_KEY` (openssl-capable passphrase), stored only in `/etc/medverse/backup.env`. Record it out-of-band; without it the dump cannot be restored.

Then, without enabling the daily timer:

1. Install AWS CLI v2.
2. Create `/etc/medverse/backup.env` from `deploy/env/backup.env.example` with `MEDVERSE_ENV=production`, loopback `PGHOST=127.0.0.1`, `PGDATABASE=medverse`, `MEDVERSE_BACKUP_CONFIRM=I_UNDERSTAND_PRODUCTION`. Prefer `.pgpass` over `PGPASSWORD`.
3. Run `MEDVERSE_BACKUP_TAG=pre-8j-0k-0l` (or `pre-migration`) via `backup-to-r2.sh`. Require log line `upload verified`. Record object key and encrypted byte size / HEAD length out-of-band.
4. Restore drill: create a throwaway DB (for example `medverse_restore_drill`), set `PGDATABASE` to that name, run `restore-from-r2.sh --key …`. **Never** restore into live `medverse`. Drop the drill database after checksum/row-count comparison.
5. Confirm production health, migration head, and pool 10 unchanged.

## Result

**NO-GO** for production 8J/0K/0L migration until a tagged encrypted dump is on R2, HEAD-verified, and restored into a non-production database.
