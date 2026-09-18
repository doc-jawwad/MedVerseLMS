# Production backup / DR — 2026-09-18 (ready)

**Status: READY** — automatic encrypted dumps are enabled; a scheduled dump was uploaded to R2 and restored into a throwaway database. Staging was not changed. Production was not overwritten.

This record does **not** rewrite [production-backup-readiness-20260918.md](production-backup-readiness-20260918.md) (that pass found missing credentials). Host: `vmi3579667`. App release unchanged: `20260918T145018Z-9520075-admin-rbac`.

## Production (after this pass)

| Item | Live state |
|---|---|
| Health | `GET https://lms.medversepk.com/api/health` **200** `{ ok: true, service: "medverse-lms" }` |
| DB | `medverse`, listen localhost, head **`20260918120000`**, 3 profiles |
| `/etc/medverse/backup.env` | present, mode **640**, `root:medverse` |
| R2 bucket | `medverse-prod-backups` (private) |
| Timer | `medverse-backup.timer` **enabled**, next **2026-09-19 02:00 PKT** |
| Staging current | unchanged `20260918T143059Z-admin-rbac` |

## Schedule and retention

- Daily dump at **02:00 Asia/Karachi** (about 21:00 UTC), `Persistent=true`, up to 5 minutes jitter.
- Keep **14** objects under `medverse/production/scheduled/`.
- Tagged dumps (`pre-exam`, `pre-admin-rbac`, `pre-migration`, …) are **not** pruned.

## Verification

- `systemctl start medverse-backup.service` → journal `upload verified` / `backup complete`, `Result=success`.
- Object: `medverse/production/scheduled/20260918T153921Z.dump.enc`, HEAD **407968** bytes (matches local encrypted size).
- Tagged objects still present: `pre-admin-rbac/20260918T144854Z.dump.enc`, `pre-migration/20260918T035912Z.dump.enc`.
- Restore into `medverse_restore_drill` (never `medverse`): profiles **3**, migration head **`20260918120000`**, then **dropped**. Same-host drill excluded `pg_cron` (`cron.database_name` is `medverse`).
- Restore dry-run into live `medverse` **refused** (exit 2).
- Backup journal has no `DUMP_ENCRYPTION_KEY=` / `R2_SECRET` / `PGPASSWORD` assignments.

## Remaining risks

- RPO is about **24 hours** (no WAL archive).
- Backup failure is visible in **journald** only; there is no pager.
- The dump encryption passphrase must stay available **off-box**; without it R2 objects cannot be decrypted.
- Next app release must include the updated `backup-to-r2.sh` / `restore-from-r2.sh` in `/opt/medverse/current` (systemd units live in `/etc/systemd/system` and persist).
