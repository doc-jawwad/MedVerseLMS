<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# MedVerse LMS project rules

- `docs/` is canonical: architecture.md, database.md, permissions.md, access-eligibility-analytics.md, exam-state-machine.md, scoring-rules.md, test-rules.md, deployment.md, and `docs/validation/` (append-only sign-off archive). **Do not invent alternative attempt states, transitions, grace periods, or access rules — change the doc first (with approval), then the code.** Staging phase sign-offs in `docs/validation/` do **not** authorize production deployment.
- All schema changes go through `supabase/migrations/*.sql` — never dashboard-only changes.
- Everything security/correctness-critical is enforced in Postgres (RLS deny-by-default, constraints, security-definer RPCs). App checks are UX only.
- Next.js 16: use `src/proxy.ts` (not middleware.ts); `cookies()`/`headers()`/`params`/`searchParams` are async.
- No new tech (Redis, websockets, separate backend, etc.) — see docs/architecture.md exclusions.

## Cursor Cloud specific instructions

- Local Supabase runs in Docker. `iptables-legacy` FORWARD (and INPUT) policy must be ACCEPT before `npx supabase start`. Docker programs nftables, and a leftover legacy FORWARD policy of DROP drops container-to-container traffic, so the database container is healthy from the host while schema init fails with `LegacyDbSetupError`.
- The app needs Auth, PostgREST, Kong, and Postgres. Start with `npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,postgres-meta,realtime,storage-api`. Studio, storage, realtime, and analytics stay off so the stack fits this VM.
- Fill `.env.local` from `npx supabase status -o env`: `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `DB_URL`. Use those JWT keys. `CRON_SECRET` can be any local value. See `.env.local.example`.
- Dev server: `npm run dev -- --hostname 0.0.0.0 --port 3000`. Liveness is `GET /api/health`. Readiness is `GET /api/health/ready` with `Authorization: Bearer $CRON_SECRET`.
- Confirmed accounts: `DEV_ACCOUNT_PASSWORD=... node scripts/create-dev-account.mjs <email> <full_name> [--admin]`. Do not commit the password. A committed student profile makes `supabase/tests/166_admin_least_privilege_reads.sql` fail (it expects exactly one student profile).
- `npm run test:unit` executes `deploy/scripts/backup-to-r2.sh` and `deploy/scripts/restore-from-r2.sh`. Git stores them as mode `644`, so those checks exit 126 on a fresh checkout. `chmod +x` makes them pass and shows up in `git status` because `core.filemode` is true.
