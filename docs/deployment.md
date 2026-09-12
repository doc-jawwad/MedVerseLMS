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
2. **Vercel Cron** (backup): `vercel.json` schedules `GET /api/cron/auto-submit` every minute; route verifies `Authorization: Bearer $CRON_SECRET` then calls the same RPC with the service role.

## Tests / CI

- `npm run test` — Vitest unit tests.
- `supabase test db` — pgTAP (RLS + scoring) against a fresh local db.
- `npx playwright test` — e2e against local stack (or preview URL).
- CI (GitHub Actions when repo is pushed): install → lint → build → supabase db reset + pgTAP → Playwright.

## Production checklist (Phase 13/14)

- Custom domain on Vercel; HTTPS automatic.
- Supabase: point-in-time recovery / daily backups verified; restore drill done once.
- Auth: email confirmations ON; password min length ≥ 8; rate limits reviewed.
- `SUPABASE_SERVICE_ROLE_KEY` only in Vercel server env.
- pg_cron job verified in production (`select * from cron.job;`).
- Admin account promoted via SQL; documented out-of-band.
- Error monitoring: Vercel logs + Supabase logs reviewed during beta; alerting decided before full rollout.
