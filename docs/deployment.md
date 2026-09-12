# Deployment & Operations

## Environments

| Env | Frontend | Database |
|---|---|---|
| Local dev | `npm run dev` | `supabase start` (local Docker stack) |
| Preview | Vercel preview deploys | Supabase cloud project (staging or branch) |
| Production | Vercel production | Supabase cloud project |

## Environment variables (`.env.local`, Vercel project settings)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server-only; never exposed to the client
CRON_SECRET=                    # guards /api/cron/auto-submit
```

## Migrations

- `supabase/migrations/*.sql` is the only source of schema truth. No dashboard-only changes, ever.
- Local: `supabase db reset` (replays all migrations + seed.sql).
- Cloud: `supabase db push` (or `supabase migration up`) via CI.
- New change: `supabase migration new <name>` → write SQL → reset locally → commit.

## Cron (both must be configured)

1. **pg_cron** (primary, in-database): `select cron.schedule('auto-submit', '* * * * *', $$select public.auto_submit_expired()$$);`
2. **Vercel Cron** (backup): `vercel.json` schedules `GET /api/cron/auto-submit`. On **Hobby**, Vercel only allows daily crons (`0 0 * * *`); minute-level Vercel Cron needs Pro. **pg_cron remains the primary every-minute sweeper.** Route verifies `Authorization: Bearer $CRON_SECRET` then calls the same RPC with the service role.

## Tests / CI

- `npm run test:db` — runs the pgTAP suite in `supabase/tests/` (RLS matrix +
  scoring/exam-engine regressions) against `SUPABASE_DB_URL` in `.env.local`
  via `scripts/run-pgtap.js`. Every file wraps its fixtures in
  `BEGIN...ROLLBACK`, so it's safe to run against the shared dev/cloud
  database — nothing persists. Once local Supabase (Docker) is available,
  the same files work unmodified under `supabase test db`.
- `npm run test:e2e` — Playwright suite in `tests/e2e/` (`playwright.config.ts`)
  against a running `npm run dev` on `localhost:3000`. Each spec provisions
  and tears down its own isolated student/test fixtures via the service-role
  API (`tests/e2e/fixtures.ts`) — no shared state between tests, no
  dependency on seeded demo data. Covers the failure-scenario table in
  docs/exam-state-machine.md: refresh/resume, same-device multi-tab lock,
  cross-device lock, submit + idempotent re-visit, offline queue + flush.
- CI (GitHub Actions, once the repo is pushed): install → lint → build →
  `test:db` → `test:e2e` against a preview deploy.

## Production checklist (Phase 13/14)

- Custom domain on Vercel; HTTPS automatic.
- Supabase: point-in-time recovery / daily backups verified; restore drill done once.
- Auth: email confirmations ON; password min length ≥ 8; rate limits reviewed.
- `SUPABASE_SERVICE_ROLE_KEY` only in Vercel server env.
- pg_cron job verified in production (`select * from cron.job;`).
- Admin account promoted via SQL; documented out-of-band.
- Error monitoring: Vercel logs + Supabase logs reviewed during beta; alerting decided before full rollout.
