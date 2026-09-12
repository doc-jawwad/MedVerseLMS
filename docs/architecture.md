# MedVerse LMS — Architecture

Canonical documents. Code must follow these; **do not invent alternative states, transitions, or rules.** If a rule seems wrong, change the doc first (with approval), then the code.

## What this is

An online MCQ platform for MBBS students (Years 1–5) of a single academy:

- **Students**: take admin-scheduled tests, practice MCQs from the question bank, browse study materials (Google Drive links), see performance/rank.
- **Admin**: manages curriculum, question bank (with versioning + review workflow), tests (build → validate → preview → publish → kill-switch), enrollment/approval, access grants, results, analytics.

## Stack (fixed — do not add technology)

| Layer | Choice |
|---|---|
| Frontend + server actions | Next.js App Router, TypeScript |
| UI | Tailwind CSS + shadcn/ui (Radix) |
| Database / Auth / RLS | Supabase (PostgreSQL) |
| Hosting | Vercel |
| Cron | pg_cron (primary) + Vercel Cron (backup) |
| Email (Phase 11) | Resend |

Explicitly **excluded** at current scale: Redis, WebSockets-everywhere, microservices, separate Node backend, ElasticSearch, AI question generation, event-driven architecture, mobile app.

## Core principles

1. **Postgres enforces everything security- or correctness-critical**: RLS on every table (deny-by-default), constraints, unique indexes, security-definer RPCs. App-level checks are UX, not security.
2. **Server clock is the only clock.** Client timers are display-only.
3. **Explicit state enums, never boolean flag soup** (`status text check (...)`, one column).
4. **History is immutable**: question versions are append-only; attempts are never deleted (invalidated, with reason, at worst); published test_questions are frozen snapshots.
5. **Idempotency everywhere in the exam path**: duplicate/out-of-order requests must be harmless.
6. **`tenant_id` on every table** from day one (single constant now; future multi-academy).
7. **All admin mutations of consequence are audit-logged.**

## Repository layout

Note: this project uses **Next.js 16** — request middleware lives in `src/proxy.ts` (Next 16 renamed `middleware` to `proxy`; same functionality). `cookies()`, `headers()`, `params`, `searchParams` are async.

```
docs/                    # these canonical documents
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

- [database.md](database.md) — schema
- [permissions.md](permissions.md) — roles, session policy, RLS matrix
- [exam-state-machine.md](exam-state-machine.md) — attempt lifecycle (single source of truth)
- [scoring-rules.md](scoring-rules.md) — marking, grace policy
- [test-rules.md](test-rules.md) — test lifecycle, validation, kill switch
- [deployment.md](deployment.md)
