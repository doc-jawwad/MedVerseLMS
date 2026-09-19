# Deployment & Operations

Target production architecture is approved conceptually ([architecture.md](architecture.md)). **This repository now contains templates under `deploy/` so that architecture can be stood up later without a redesign.** Templates are not live host configuration.

Do **not**, as part of repository work: provision a VPS, modify production or Cloud staging Supabase, modify Vercel, DNS, Cloudflare, or Brevo, or run a production dump/load-test.

## Live today (not yet the VPS origin)

- **Current public site**: https://med-verse-lms.vercel.app (Vercel project `jawwad-seo/med-verse-lms`, `.vercel/project.json`). Deployment protection is off; app login/approval is the gate.
- **Supabase Cloud (application + Auth, today):** `pxoxijlhcvbrostrquft` (`ap-southeast-1`, Postgres 17). This is still a **full** hosted database, not Auth-only.
- **Supabase Cloud (staging, `vygtwrsshcyfahfzurgq`, `ap-southeast-1`):** application schema for 8B–8F plus Vercel **Preview**. Do not point Vercel Production at this project.
- `vercel.json` stays in the repo for a possible return to Vercel; it is not the VPS runtime.

## Target production

```
Cloudflare (DNS / proxy / WAF)
  → Caddy on one VPS (TLS, unified origin)
    → Next.js          (pages, server actions, /api/cron, health)
    → /auth/v1/*       → Supabase Cloud Auth (GoTrue) + Brevo SMTP
    → /rest/v1/*       → PostgREST → PostgreSQL on the same VPS
```

- **Initial deployment:** one VPS. About **8 vCPU / 24 GB RAM** is a **planning estimate**, not a capacity guarantee. Provider, region, and final size are **pending approval**.
- **Postgres** listens on localhost only. PostgREST connects locally (TCP or unix socket) as role `authenticator`, `db-schemas=public`, `db-anon-role=anon`. Pool: PostgREST `PGRST_DB_POOL` (start small, tune from load test). PgBouncer only if a test shows pool wait — not in the initial minimum.
- **JWT verification** on VPS PostgREST uses the Cloud Auth **JWKS** (`/etc/medverse/jwks.json`), not opaque `sb_*` API keys. Rotation = refresh JWKS after Cloud key changes, then reload PostgREST. Never `NEXT_PUBLIC_`.
- **Portability:** `NEXT_PUBLIC_SUPABASE_URL` is the Caddy origin in production; pointing it back at `https://<ref>.supabase.co` plus a `public` schema restore into that same Auth project is the return path to Vercel + managed Supabase. Keep supabase-js and `supabase/migrations/*.sql` as the only database interface.

## Caddy unified origin

One hostname for the LMS so existing clients (`src/lib/supabase/{client,server,admin}.ts`, `src/proxy.ts`) stay one-URL:

| Path | Upstream |
|---|---|
| `/auth/v1*` | Supabase Cloud GoTrue |
| `/rest/v1*` | PostgREST on 127.0.0.1 |
| `/` and other app routes | Next.js (`next start`) |

Auth `site_url` and redirect URLs must be this public origin (not the Vercel URL) before student signup emails are used for real.

Two supabase-js clients (Auth URL ≠ REST URL) is a **fallback** only if proxying GoTrue fails (`iss`/`aud`/redirects). Do not start there.

## Auth emails — launch blocker until Brevo is wired

Today there is **no** custom SMTP on the Cloud project. Shared free-tier mailer: `auth.rate_limit.email_sent = 2` per hour project-wide (`supabase/config.toml`). Template customization is refused on that mailer. **Approved relay: Brevo as SMTP for Supabase Auth** (not an in-app email SDK).

When executing Auth config (separate approval; not this docs-only change):

1. Fill `[auth.email.smtp]` for Brevo (`env(VAR_NAME)` for the password).
2. Uncomment `[auth.email.template.*]` in `config.toml`.
3. `supabase config push` with a PAT.
4. Raise `auth.rate_limit.email_sent` to a value that fits onboarding volume (value **pending approval** — do not invent it here).

Until then, do not use `/register` for volume testing. Use `node scripts/create-dev-account.mjs` (Auth Admin API, already-confirmed; `.local` is fine on that path). After creating the Auth user it signs in as that user and calls `ensure_profile()` so the script works both on managed Supabase (`handle_new_user` already fired; RPC is idempotent) and after the Auth/DB split. Opaque `sb_secret_*` is used only on `/auth/v1`. PostgREST promotion uses the user JWT and `bootstrap_first_main_admin()`, not `sb_secret_*` as a Bearer.

## Environments

Do **not** treat Cloud staging as migrated to VPS. Do **not** convert either Cloud project to Auth-only until VPS Postgres is real and approved.

| Env | Frontend | Database / Auth | Rule |
|---|---|---|---|
| Local Docker | `npm run dev` | `supabase start` (`http://127.0.0.1:54321`) | Preferred for pgTAP and schema work |
| Vercel Preview | Preview deployment | Cloud staging `vygtwrsshcyfahfzurgq` | Subscription UI validation. Do not point Preview at production. |
| Local against Cloud staging | `npm run dev` + `.env.local` staging keys | Cloud staging `vygtwrsshcyfahfzurgq` | Requires `MEDVERSE_ALLOW_CLOUD_STAGING=yes` for ops scripts |
| Vercel Production | `https://med-verse-lms.vercel.app` | Cloud production `pxoxijlhcvbrostrquft` | Do not change Production env vars for staging work |
| VPS staging / load-test | Caddy + Next on `staging.medversepk.com` (same VPS, dual-stack) | VPS DB `medverse_staging` + Cloud Auth `vygtwrsshcyfahfzurgq` | Same-host isolation; no production ports/DB; no staging pg_cron |

Do **not** use production Auth/DB for student subscription UI tests. Do not copy production `SUPABASE_SERVICE_ROLE_KEY` into Preview.

After cutover, freeze writes to Cloud `public` on the Auth project. Identity UUIDs for production users should remain the Auth project that already matches `profiles.id` unless an Auth migration is explicitly approved.

## Environment variables

Application (Next.js) — names unchanged for portability:

```
MEDVERSE_ENV=                    # local | vps-staging | production
NEXT_PUBLIC_SUPABASE_URL=        # Caddy public origin (target); *.supabase.co today / for portability
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # server-only; never exposed to the client
CRON_SECRET=                     # guards /api/cron/auto-submit and /api/health/ready
POSTGREST_INTERNAL_URL=          # VPS only: http://127.0.0.1:3001
# Payment-screenshot R2 (server-only; never NEXT_PUBLIC_):
# R2_ACCOUNT_ID=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_PAYMENT_BUCKET=             # required when MEDVERSE_ENV=production (payment proofs)
# R2_BUCKET=                     # non-production only: optional shared private bucket fallback
# R2_ENDPOINT=                   # optional; default https://<accountid>.r2.cloudflarestorage.com
# Backup dumps use /etc/medverse/backup.env (separate credentials/bucket); not these Next.js vars.
```
PostgREST / Postgres / backup (VPS host files in `/etc/medverse/`, not git): JWT secret, `authenticator` DB password, `PGRST_DB_URI`, dump encryption key, R2 credentials. Not `NEXT_PUBLIC_`. Examples: `deploy/env/*.example`.

Ops scripts refuse Cloud production (`pxoxijlhcvbrostrquft`) and Cloud staging (`vygtwrsshcyfahfzurgq`) URLs unless `MEDVERSE_ALLOW_PRODUCTION=yes` or `MEDVERSE_ALLOW_CLOUD_STAGING=yes` is set explicitly. Backup/restore scripts additionally refuse `*.supabase.co` hosts and any non-loopback `PGHOST`.

## Migrations

- `supabase/migrations/*.sql` is the only source of schema truth. No dashboard-only changes, ever.
- Local: `supabase db reset` (replays all migrations + seed.sql).
- VPS: `supabase migration up` (or equivalent) against **localhost** Postgres.
- Cloud Auth project after cutover: **no** application schema pushes unless returning to managed Supabase.
- New change: `supabase migration new <name>` → write SQL → reset locally → commit.

Coalesced ranking, `ensure_profile()`, and dropping `profiles` → `auth.users` FK are in `20260914000001_coalesced_ranking.sql` and `20260914000002_ensure_profile_drop_auth_users_fk.sql`. `handle_new_user()` stays in history for portability.

## Cron

1. **pg_cron (primary):** `select cron.schedule('medverse-auto-submit', '* * * * *', $$select public.auto_submit_expired()$$);` — already the intended job name in `20260912000013_exam_engine.sql`. `auto_submit_expired()` scores expired attempts then calls `rank_dirty_tests()` (even when zero attempts expired), so ranking uses this same one-minute window rather than a second debounce job. Verify with `select * from cron.job;` on VPS Postgres.
2. **systemd timer (backup):** `deploy/scripts/auto-submit-once.sh` prefers a local `psql` call to `auto_submit_expired()` (same as pg_cron; no PostgREST JWT). If that is unavailable, it hits `GET /api/cron/auto-submit` with `Authorization: Bearer $CRON_SECRET`, which only calls PostgREST when `SUPABASE_SERVICE_ROLE_KEY` is a JWT (managed Supabase / Vercel). Opaque `sb_secret_*` is not a PostgREST credential. `vercel.json` may keep a daily Hobby-shaped cron for portability; it is not the VPS sweeper.

## Backups and disaster recovery

- **Auth** (users, passwords, refresh tokens): Supabase Cloud. Survives VPS loss.
- **Application data:** `deploy/scripts/backup-to-r2.sh` — custom-format `pg_dump`, openssl AES-256-CBC + PBKDF2, upload to Cloudflare R2, HEAD-verify (local size must match `ContentLength`), retain **7–14 scheduled** copies (`BACKUP_KEEP_COUNT`, default 14). Tagged dumps (`pre-exam`, `pre-migration`, …) are not pruned. Local temp files are deleted on success. Secrets are not echoed.
- **RPO / timer interval:** daily dump. `medverse-backup.timer` fires at **02:00 Asia/Karachi** (`Persistent=true`, up to 5 minutes jitter). That is about **24h RPO** without WAL. WAL archive to R2 remains optional later.
- **Pre-exam (required regardless of RPO):** on the VPS, as `medverse`, with `/etc/medverse/backup.env` loaded:
  1. `MEDVERSE_BACKUP_TAG=pre-exam /opt/medverse/current/deploy/scripts/backup-to-r2.sh`
  2. Confirm the script prints `upload verified` (no keys in the log).
  3. Record the object key out-of-band (exam runbook).
- **Restore drill (required before a real exam):** create a throwaway database (never `medverse` or `medverse_staging`) → `deploy/scripts/restore-from-r2.sh --key …` → compare row counts / migration head → drop the throwaway database. On the **same** VPS, `pg_cron` can exist only in `cron.database_name` (`medverse`); a same-host drill must set `MEDVERSE_RESTORE_EXCLUDE_EXTENSION=pg_cron`. A replacement VPS restore is a full dump with `cron.database_name=medverse`. Full host-death path: new VPS from this runbook → restore R2 dump into a new `medverse` only after the live DB is gone → same JWT secret → DNS to the new host.
- Cloud Auth outage: pages may be up; sessions cannot refresh. Accepted dependency.

## Health and monitoring

- `GET /api/health` — public liveness `{ ok: true, service: "medverse-lms" }`; no DB, no secrets. UptimeRobot (or equivalent) hits this.
- `GET /api/health/ready` — PostgREST/Postgres reachability via loopback `POSTGREST_INTERNAL_URL` (falls back to `{NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`). **Not a public monitor.** Allowed: `Authorization: Bearer $CRON_SECRET`, or a **direct** loopback request to Next (no `X-Forwarded-For`). Failure body is `{ ok: false }` only.

Logs: journald for Next, PostgREST, Postgres, Caddy. No paid APM required initially. SHOULD log exam RPC failures server-side (submit/save), not only client toasts.

## Server security (target)

- SSH keys; host firewall allows **22 and 443** (and 80 only if used for ACME). Deny public 5432, 3000, 3001, 2019.
- Postgres `listen_addresses = 'localhost'` (`deploy/postgres/listen-localhost.conf`).
- Cloudflare in front of 443; TLS mode **pending** (origin cert vs ACME). Caddyfile has commented `tls` blocks.
- `service_role` and JWT secret only on the server (`/etc/medverse/`).
- Do not publish Studio or 5432.

## First VPS setup (when provisioning is approved — do not run this against Cloud)

Templates live in `deploy/`. Replace `REPLACE_*` values on the host only.

1. **OS user and dirs.** Create system user `medverse`. Releases at `/opt/medverse/current` (symlink to a dated checkout). Host env at `/etc/medverse/` mode `0750`, files `0640`.
2. **Firewall.** Allow 22, 443 (and 80 if ACME). Default-deny. Confirm `ss` shows Postgres/PostgREST/Next on loopback only.
3. **PostgreSQL.** Distro `postgresql.service` (no custom unit). Apply listen + `pg_hba` snippets. Enable `pg_cron` (`shared_preload_libraries`). Create database (name chosen at provision; examples use `medverse`).
4. **Bootstrap roles.** `deploy/scripts/bootstrap-vps-db.sh` (refuses Cloud hosts). In psql, `ALTER ROLE authenticator PASSWORD …` (typed, not in shell history if possible). Then `auth.uid()` helpers are already applied by the script.
5. **Migrations.** `supabase migration up` (or equivalent) against **localhost** only. Do not `db push` to Cloud production or staging.
6. **JWT.** Point PostgREST `jwt-secret` at `/etc/medverse/jwks.json` (Cloud Auth public JWKS; not `NEXT_PUBLIC_`). `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` may be opaque `sb_*` Cloud API keys — they authenticate GoTrue, they are **not** PostgREST Bearers. User access tokens (ES256) are the PostgREST JWT.
7. **PostgREST.** Install the binary; copy `deploy/postgrest/postgrest.conf.example` + `deploy/env/postgrest.env.example` to `/etc/medverse/`. Bind `127.0.0.1:3001`. `systemctl enable --now medverse-postgrest`.
8. **Next.js.** `git checkout` known revision → `npm ci && npm run build`. Copy `deploy/env/nextjs.env.example` to `/etc/medverse/nextjs.env`. `NEXT_PUBLIC_SUPABASE_URL` = `https://<MEDVERSE_ORIGIN>`. `systemctl enable --now medverse-next`.
9. **Caddy.** Copy `deploy/Caddyfile`. Export `MEDVERSE_ORIGIN` and `SUPABASE_AUTH_HOST` (`deploy/Caddyfile.env.example`). Uncomment **one** `tls` block after the TLS decision. Caddy public; Next/PostgREST stay loopback.
10. **Cron.** Verify `select * from cron.job;` shows `medverse-auto-submit`. Enable `medverse-auto-submit.timer` (every minute HTTP backup). Enable `medverse-backup.timer` (daily 02:00 Asia/Karachi encrypted dump to R2).
11. **Auth (separate approval).** Cloud `site_url` + redirect URLs = public origin; Brevo SMTP; `email_sent` limit pending.
12. **Health.** `curl -sS https://<origin>/api/health` → `ok: true`. Ready: `curl -sS -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/health/ready`.
13. **DNS cutover (separate approval).** Cloudflare A/AAAA (or CNAME) to the VPS; proxy/WAF as chosen. Freeze Cloud `public` writes after cutover.
14. **Restore drill** on a scratch host before any real exam.

## Service restart

Independently:

```
systemctl restart medverse-next
systemctl restart medverse-postgrest
systemctl reload caddy          # or restart; config test first: caddy validate
systemctl restart postgresql    # last resort; drops in-flight RPCs
```

Next is **not** `BindsTo` PostgREST. Restarting REST must not kill the Node process.

## Deploy, update, rollback (principles)

- App: git checkout of a known revision on the VPS → `npm ci && npm run build` → restart Next. Keep the previous release directory to roll back the app.
- SQL: forward migrations only; ranking relocate must remain a one-function revert (`score_attempt` calling `rank_test` again) with **no** rank-column rewrite.
- Do not dashboard-edit production Postgres.
- Rollback of Caddy/PostgREST config is file revert + service restart.
- Emergency recovery: new VPS from this runbook → restore R2 dump → same JWT secret → DNS to the new host. Auth remains on Cloud (unchanged).

## Tests, CI, load-test (required before production exams)

- `npm run test:unit` — health helpers, backup-script safety (no real upload), deploy config syntax checks.
- `npm run test:db` — pgTAP in `supabase/tests/` against `PGTAP_DB_URL` or `SUPABASE_DB_URL` (`scripts/run-pgtap.mjs`), `BEGIN…ROLLBACK`. Prefer local Docker (`127.0.0.1:54322`). Refuses Cloud production/staging URLs unless an explicit allow env is set.
- `npm run test:e2e` — Playwright in `tests/e2e/` against `npm run dev`; fixtures via service-role API. After the split, fixtures must hit Cloud Auth + VPS REST.
- CI (when used): install → lint → build → `test:db` → `e2e`.

**Load-test** through **PostgREST** (the real student path), never raw session-pooler as the sole evidence, **never production**:

- concurrent `save_answer`
- `submit_attempt` burst on one test, **before and after** ranking coalesce
- `auto_submit_expired` with many overdue attempts plus straggler submits
- `start_attempt` at `opens_at`
- signup/login with real Brevo
- result/leaderboard reads after the burst

Watch Postgres CPU, IO%, lock waits, PostgREST errors, pool wait, Caddy 5xx. **Do not claim 1,500-user capacity until this passes.** Planning figures (~10k / ~5k trial / ~1,500 simultaneous) remain estimates.

**Phase 0 isolation (see [`performance-phase0.md`](performance-phase0.md)):** heavy load-test must **not** use production/staging databases, PostgREST, Next.js, Cloud Auth, or PostgreSQL **5432**. A second VPS was **not** purchased. The approved alternative is a temporary **`same-vps-isolated-loadtest`** on the existing host **only during an owner-approved outage**, with origin services offline and a separate Postgres cluster on **127.0.0.1:55432** plus PostgREST **127.0.0.1:3009**. Label those measurements `same-vps-isolated-loadtest` — never `dedicated-vps` or production capacity. Workstation `local-docker` is also **not** production capacity.

## Production checklist (target; not all done)

- Canonical docs match this architecture (this change).
- `deploy/` templates in git; host secrets only on the VPS.
- Custom domain + Cloudflare + Caddy TLS.
- Brevo SMTP + raised Auth email rate limit (values pending).
- `ensure_profile` + ranking coalesce migrated and pgTAP-covered.
- Session watch = polling (`SessionWatch`); no Realtime process on the VPS.
- pg_cron + systemd backup cron verified.
- Encrypted R2 dumps + one restore drill.
- Health URL monitored (`GET /api/health`).
- `SUPABASE_SERVICE_ROLE_KEY` and JWT secret only on the VPS (and CI secrets as needed).
- Admin promoted via SQL; documented out-of-band.

## Decisions pending approval

Do not invent these in code or ops:

- VPS provider
- VPS region
- Final VPS size (8 vCPU / 24 GB is an estimate only)
- Paid Auth plan (Free pause would take login down even if the VPS is up — a paid Auth project is **recommended**, not silently chosen)
- WAL archive to R2 (optional; daily dumps are the current RPO)
- User-delete semantics without `ON DELETE CASCADE`
- Auth email `email_sent` numeric limit after Brevo
- When Cloud staging `vygtwrsshcyfahfzurgq` may be touched
- Whether production Auth stays on `pxoxijlhcvbrostrquft` after `public` is frozen

## Related

- [architecture.md](architecture.md) — stack, JWT path, exclusions, future media
- [permissions.md](permissions.md) — account vs class vs subscription vs entitlement, RLS, sessions, `ensure_profile`, polling
- [exam-state-machine.md](exam-state-machine.md) — RPCs, cron invocation
- [scoring-rules.md](scoring-rules.md) — marking + coalesced ranking
- [deploy/README.md](../deploy/README.md) — template index (Caddy, systemd, backup scripts)
- [validation/README.md](validation/README.md) — append-only staging/production validation archive

## Staging validation status (8J)

As of **2026-09-16**: **STAGING VALIDATED — 8J COMPLETE** on `https://staging.medversepk.com`.

| Field | Value |
|-------|--------|
| Staging app release | `20260916T055422Z-lazy-finalize` |
| Staging DB head | `20260916123000` (`medverse_staging`) |
| Production app release (unchanged) | `/opt/medverse/releases/20260915T022632Z-duplicate-registration-fix` |
| Production DB head (unchanged) | `20260914000002` |
| Full evidence | [validation/8j-staging-signoff-20260916.md](validation/8j-staging-signoff-20260916.md) |

This status does **not** authorize production deployment, production migration apply, or production service changes.
