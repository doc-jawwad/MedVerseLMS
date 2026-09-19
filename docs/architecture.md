# MedVerse LMS — Architecture

Canonical documents. Code must follow these; **do not invent alternative states, transitions, or rules.** If a rule seems wrong, change the doc first (with approval), then the code.

## What this is

An online MCQ platform for MBBS students (Years 1–5) of a single academy:

- **Students**: after email verification, enter the LMS immediately (no admin enrollment approval). Use **free** resources without a paid subscription; see **paid** resources locked until entitled. Apply for subscription via manual bank transfer. Take admin-scheduled tests, practice MCQs, browse study materials, see performance/rank.
- **Admin**: Main Admin has all permissions; other admins have granular codes (presets are UI only). Manages curriculum, question bank (versioning + review), tests (build → validate → preview → publish → kill-switch), **account status**, **class/year** (including year-change requests), **subscriptions and payment applications**, resource entitlements/grants/restrictions, results, analytics.

This is a **one-academy, one-time LMS**, not a multi-tenant SaaS product. `tenant_id` remains on every table for a possible future split; it is a single constant today.

## Brand

MedVerse Healthcare identity: navy `#072855` + teal `#05AEA9`, sampled directly
from the logo at `public/logo-icon.png` (source: `public/logo-full.png`).
Theme tokens live in `src/app/globals.css`; the shared `Logo` component
(`src/components/logo.tsx`) is the only place the wordmark/icon combination
should be assembled — reuse it rather than re-implementing. If the logo is
ever replaced, re-sample these two hex values from the new asset and update
both this doc and `globals.css`.

## Stack (approved production target)

| Layer | Choice |
|---|---|
| Public edge | Cloudflare (DNS, proxy, WAF as appropriate). Cloudflare Pages is **not** the LMS runtime. |
| Origin TLS / router | Caddy on the VPS (unified public origin) |
| Frontend + server actions | Next.js App Router, TypeScript, on the VPS |
| Data API | PostgREST on the VPS (`/rest/v1`) |
| Application database | PostgreSQL on the VPS (RLS, constraints, SECURITY DEFINER RPCs) |
| Auth | Supabase Cloud Auth only (`/auth/v1` proxied to the Cloud project) |
| Auth email | Brevo as SMTP **for Supabase Auth** (not a separate app mail API) |
| App backups | Encrypted PostgreSQL dumps to Cloudflare R2 |
| Private objects | Cloudflare R2: payment-application screenshots (private keys + short-lived signed URLs). Never a permanent public screenshot URL. Future books/videos use the same pattern. |
| Cron | pg_cron on VPS Postgres (primary): exam auto-submit (every minute) + subscription expiry / in-app expiry notices (daily is sufficient for notices). systemd timer hitting `/api/cron/auto-submit` (exam backup) |
| Client DB interface | supabase-js / `@supabase/ssr` + `supabase/migrations/*.sql` |

**Portability:** a later return to Vercel + managed Supabase must remain possible. Do not introduce Prisma, a custom exam REST layer, or a second query API. Env var **names** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`) stay; only the URL origin changes.

Explicitly **excluded** unless a later measured requirement appears (approval + this doc first): Redis, queues/workers, Cloudflare Workers, Kubernetes, WebSockets-everywhere, microservices, a separate Node exam backend, ElasticSearch, AI question generation, event-driven architecture, mobile app, VPS-local object storage, payment gateways, Brevo transactional mail for subscription expiry (in-app notifications only for now).

**Realtime** is not part of the VPS design. Layer-1 session kick uses polling (see [permissions.md](permissions.md)), not `postgres_changes`.

## Production request path

```
Student browser
  → Cloudflare (DNS / proxy / WAF)
    → Caddy (TLS)
      → Next.js          (pages, server actions, /api/cron, health)
      → /auth/v1/*       → Supabase Cloud GoTrue (Brevo SMTP)
      → /rest/v1/*       → PostgREST → VPS PostgreSQL
```

Exam save/submit stay **browser → PostgREST → Postgres RPCs**. Next.js is not on that hot path after the exam page loads.

Caddy unifies one public origin so supabase-js keeps a **single** `NEXT_PUBLIC_SUPABASE_URL` (the Caddy hostname), matching today's client factories in `src/lib/supabase/{client,server,admin}.ts` and `src/proxy.ts`.

## Auth vs application PostgreSQL

Supabase Cloud holds **Auth only** (`auth.users`, sessions, refresh tokens, GoTrue). Application tables, RLS, and exam RPCs live on **VPS PostgreSQL**. They are not the same database.

JWT trust (unchanged claim semantics, split hosts):

1. Browser signs in via `/auth/v1` (Caddy → Cloud GoTrue).
2. Cloud issues an **ES256** (P-256) access token with `sub`, `role`, and `session_id`. (Legacy HS256 user tokens are not the current signing mode.)
3. Browser (and SSR) send that access token as `Authorization: Bearer` to `/rest/v1`.
4. PostgREST verifies it against the Cloud project's **JWKS** (VPS file `/etc/medverse/jwks.json`; never `NEXT_PUBLIC_`) and `SET ROLE`s to `anon` / `authenticated` / `service_role`.
5. Opaque Supabase API keys (`sb_publishable_*`, `sb_secret_*`) are **Auth `apikey` values only**. They are not PostgREST JWTs and must not be sent as `Authorization` on `/rest/v1`. No JWT → PostgREST `anon`.
6. `auth.uid()` and `auth.jwt()` in RLS and SECURITY DEFINER functions read PostgREST JWT GUCs (`request.jwt.claim.sub` / claims JSON). They do **not** join `auth.users`.

`service_role` still bypasses RLS. HTTP callers need a **JWT** with `role=service_role`. Opaque `sb_secret_*` is for Cloud Auth admin, not VPS PostgREST (`src/lib/supabase/admin.ts`). On the VPS, `auto_submit_expired` is primarily `pg_cron`.

**Profile provisioning:** Cloud `INSERT` into `auth.users` cannot fire a trigger on VPS Postgres. Required RPC: idempotent `ensure_profile()` — creates `profiles` (`account_status` default `active`) and an **active** class enrollment from JWT `sub` + `user_metadata.year_id` only when the subject has **never** had an enrollment row (first provision). Call it after signup / verify / signIn. Email verification does **not** wait for admin approval. Keep `handle_new_user()` in migrations so a return to managed Supabase still auto-provisions when Auth and `public` share a database.

**Access model (summary):** account status, class enrollment, subscription, and resource entitlement are separate. Details in [permissions.md](permissions.md) and [database.md](database.md). Historical eligibility, missed tests, dashboard analytics, and leaderboard population are in [access-eligibility-analytics.md](access-eligibility-analytics.md). `/pending` remains as a compatibility/blocked-account route, not a registration-approval gate.

**VPS `profiles.id`:** UUID primary key equal to Auth `sub`. **No** `references auth.users (id) ON DELETE CASCADE` on the VPS — that FK cannot exist without a local `auth.users` table. User-delete semantics without CASCADE are **pending approval** (see [deployment.md](deployment.md)).

## Scale (planning estimates — unverified)

Academy planning figures (not measured capacity): ~10,000 students in the ecosystem, ~5,000 possible free-trial signups, up to ~1,500 simultaneous exam participants, with possible synchronized submit/expiry bursts.

A **single VPS of approximately 8 vCPU / 24 GB RAM** is the current **planning estimate**, not a capacity guarantee. 1,500-user behavior is **unverified** until load tests run through the VPS PostgREST path (never production). See [deployment.md](deployment.md).

Ranking must be **coalesced** before a 1,500-submit event — hosting does not remove per-submit `rank_test` lock cost. See [scoring-rules.md](scoring-rules.md).

## Object storage (R2)

**Payment screenshots (now):** private Cloudflare R2 object keys on `subscription_applications` (`payment-proofs/{tenant_id}/{student_id}/{uuid}`); short-lived signed upload/download; never a public URL. Same R2 platform as backups — not a new infrastructure category. **Production requires `R2_PAYMENT_BUCKET`** (dedicated payment bucket; never falls back to the backup `R2_BUCKET`). Non-production may use `R2_PAYMENT_BUCKET` or, as a convenience, `R2_BUCKET` for a shared private bucket.

**Study materials today:** Google Drive URLs (`materials.drive_url`). Student catalog access must not leak that URL; open via an entitlement-checked RPC.

**Books/PDFs/video (FUTURE):** must not be stored as permanent VPS-local public files and must not expose ordinary permanent download URLs or public MP4s. Protected temporary R2 (or equivalent) access after an entitlement check.

## Core principles

1. **Postgres enforces everything security- or correctness-critical**: RLS on every table (deny-by-default), constraints, unique indexes, security-definer RPCs. App-level checks are UX, not security.
2. **Server clock is the only clock.** Client timers are display-only.
3. **Explicit state enums, never boolean flag soup** (`status text check (...)`, one column).
4. **History is immutable**: question versions are append-only; attempts are never deleted (invalidated, with reason, at worst); published test_questions are frozen snapshots.
5. **Idempotency everywhere in the exam path**: duplicate/out-of-order requests must be harmless.
6. **`tenant_id` on every table** from day one (single constant now; future multi-academy).
7. **All admin mutations of consequence are audit-logged.** Student-originated applications/requests are stored on those tables; students cannot write `audit_logs`.
8. **No new infrastructure category** without a measured need and an update to this doc.
9. **Authorization is Postgres RLS + permissioned SECURITY DEFINER RPCs.** `profiles.role = 'admin'` is not a blanket write grant. App-level checks are UX only.

## Repository layout

Note: this project uses **Next.js 16** — request middleware lives in `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`; same functionality). `cookies()`, `headers()`, `params`, `searchParams` are async.

```
docs/                    # these canonical documents
deploy/                  # VPS templates (Caddy, systemd, backup) — not live host config
supabase/migrations/     # SQL source of truth (numbered)
supabase/seed.sql
supabase/tests/          # pgTAP
src/app/(public|student|admin)/...   # route groups
src/lib/supabase/{server,client,admin}.ts
src/lib/actions/         # server actions wrapping RPCs
src/components/{ui,exam,admin,dashboard}
tests/{e2e,unit}
```

## Related docs

- [database.md](database.md) — schema (identity, account status, class enrollment, subscriptions, entitlements)
- [permissions.md](permissions.md) — account vs subscription vs class vs resource, admin permissions, session policy, RLS matrix, **8L student notification inbox contract**
- [access-eligibility-analytics.md](access-eligibility-analytics.md) — current access vs historical eligibility vs academic history vs UI; missed tests; dashboard; leaderboards (8J source of truth)
- [exam-state-machine.md](exam-state-machine.md) — attempt lifecycle (single source of truth)
- [scoring-rules.md](scoring-rules.md) — marking, grace policy, ranking **when** vs **what**
- [test-rules.md](test-rules.md) — test lifecycle, validation, kill switch
- [deployment.md](deployment.md) — environments, Caddy, cron, backups, health, cutover, pending approvals, `deploy/` templates
- [validation/README.md](validation/README.md) — append-only environment validation / phase sign-off archive (staging 8J complete ≠ production authorize)
