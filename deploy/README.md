# VPS deployment templates

Templates only. They are **not** live configuration.

Canonical runbook: [docs/deployment.md](../docs/deployment.md).

Do **not** copy secrets into this directory. Host files belong in `/etc/medverse/` on the VPS (not git).

| Path | Purpose |
|---|---|
| `Caddyfile` | Unified public origin: Auth → Cloud, REST → PostgREST, else Next.js |
| `systemd/` | Independently restartable units + timers |
| `postgrest/` | PostgREST config template (`127.0.0.1` only) |
| `postgres/` | localhost listen, `pg_hba`, VPS-only `auth.uid()` helpers + roles |
| `env/*.example` | Variable names; fill on the host |
| `scripts/backup-to-r2.sh` | Encrypted `pg_dump` → R2 |
| `scripts/restore-from-r2.sh` | Decrypt + `pg_restore` (scratch/VPS only) |
| `Caddyfile.staging.site` | Extra Caddy site for `staging.medversepk.com` (append-only) |
| `systemd/medverse-staging-*.service` | Staging Next `:3010` and PostgREST `:3011` |
| `scripts/apply-staging-schema.sh` | Staging schema with pg_cron blocks stripped |
| `scripts/provision-vps-staging.sh` | Same-host staging provision (run on VPS as root) |

Pending at provision time (do not invent here): hostname, TLS mode, Cloud Auth host, JWT secret, R2 bucket. Backup timer is daily 02:00 Asia/Karachi (`deploy/systemd/medverse-backup.timer`).
