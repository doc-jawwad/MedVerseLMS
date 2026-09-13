# Deployment & Operations

## Live

- **Production**: https://med-verse-lms.vercel.app (Vercel project `jawwad-seo/med-verse-lms`, linked via `.vercel/project.json`)
- Deployment protection (Vercel SSO wall) is disabled so the site is
  publicly reachable — the app's own auth (login/approval) is the real gate.
- No custom domain yet; add one later via `vercel domains add` +
  DNS, no redeploy or migration needed.
- Deploy with `npx vercel --prod` from the repo root (env vars are already
  set in the Vercel project for production/preview/development — see below).

## Auth emails — real launch blocker, not just branding

Two separate problems live here; only one of them is cosmetic.

**1. Signup email volume is capped project-wide (real blocker).** No custom
SMTP relay is configured, so Supabase's own shared free-tier mailer sends
every signup-confirmation and password-reset email — and that mailer is
rate-limited to **`auth.rate_limit.email_sent = 2` per hour, for the whole
project** (`supabase/config.toml`). A real onboarding burst (a class
signing up together at the start of a term) will hit this within minutes.
There is no code-level workaround: Supabase enforces the limit server-side,
and standing up a separate transactional-email integration bypassing
Supabase Auth's own mailer would mean re-implementing signup/verification
by hand — new infrastructure this project deliberately excludes. **The only
fix is a custom SMTP relay**, which also happens to raise the "confirmed:
branding is blocked too" limitation below.

**2. Branding is blocked by the same root cause.** Signup verification
(6-digit code) and password reset (link) both work, sent by Supabase's
default mailer — but plain default Supabase styling, not the MedVerse
navy/teal look. The branded templates already exist
(`supabase/templates/{confirmation,recovery}.html`) and the config wiring is
written in `supabase/config.toml` but **commented out**, because Supabase's
free-tier shared mailer flatly refuses any template customization:
`config push` returns `"Email template modification is not available for
free tier projects using the default email provider."`

**To fix both:** pick a custom SMTP relay (Gmail SMTP with an App Password
is the fastest free option; Brevo/SendGrid free tier if you want a
dedicated transactional service) — this is purely the mail server Supabase's
*own* auth system sends through, not a third-party email API integrated into
the app. Then:
1. Fill in `[auth.email.smtp]` in `supabase/config.toml` with the host/port/
   user/pass (use `env(VAR_NAME)` for the password, never a literal secret).
2. Uncomment the two `[auth.email.template.*]` blocks right below it.
3. `SUPABASE_ACCESS_TOKEN=<PAT> npx supabase config push` (a token can be
   generated at supabase.com/dashboard/account/tokens).
4. Raise `[auth.rate_limit].email_sent` in `supabase/config.toml` to a value
   that fits expected onboarding volume, then `config push` again — the
   default of 2/hour is a shared-mailer-era holdover with no reason to keep
   once a dedicated relay is in place.

This is external provider configuration, not something a code change can
substitute for — see the QA ledger's final report for the same conclusion.

**Until then, don't use the real `/register` form for dev/test accounts** —
besides the rate limit, Supabase Auth's own signup validation separately
rejects `.local` addresses outright (a reserved, non-deliverable TLD per RFC
6762 — `medverse.local` was never going to receive real mail). Use
`node scripts/create-dev-account.mjs` instead (see its header comment) — it
creates an already-confirmed account via the Admin API, no email round trip,
and `.local` addresses work fine through that path. This replaces the old
`supabase/seed.sql` instruction to "sign up normally as admin@medverse.local".
Real students signing up with real email addresses were never affected by
the `.local` issue — only internal dev/QA accounts using the placeholder
domain were.

## Environments

**As of this writing there is exactly one Supabase project** for this repo
(`pxoxijlhcvbrostrquft` — confirmed via `supabase projects list`, only one
result). `supabase/config.toml`'s `auth.site_url` already points at the live
production URL, and `.env.local` / Vercel's Production env vars both resolve
to the same project. **Local dev, and any ad-hoc database work done against
`.env.local`, is writing directly to the same database production reads
from** — there is no isolated dev/staging Supabase project despite the table
below describing the intended target shape. Standing up a genuinely separate
project for local dev / preview (Supabase's free tier allows more than one)
and pointing `.env.local` + Vercel Preview env vars at it is an open,
unstarted item — see the QA ledger's final report.

| Env | Frontend | Database (intended) | Database (actual, today) |
|---|---|---|---|
| Local dev | `npm run dev` | `supabase start` (local Docker stack) | `pxoxijlhcvbrostrquft` cloud project (same as prod) |
| Preview | Vercel preview deploys | separate Supabase cloud project (staging/branch) | `pxoxijlhcvbrostrquft` cloud project (same as prod) |
| Production | Vercel production | Supabase cloud project | `pxoxijlhcvbrostrquft` cloud project |

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
  via `scripts/run-pgtap.mjs`. Every file wraps its fixtures in
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
