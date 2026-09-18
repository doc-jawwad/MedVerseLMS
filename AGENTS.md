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
