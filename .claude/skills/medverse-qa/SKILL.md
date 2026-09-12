---
name: medverse-qa
description: Use when testing or verifying MedVerse LMS behavior — admin/student/practice/test workflows, access control, timers, scoring, kill-switch, or regressions. Distinguishes MANUAL browser verification (Playwright/local Supabase CLI) from AUTOMATED (pgTAP/e2e suites), STATIC (code/doc reading), and UNVERIFIED claims. Do not modify application code, schema, migrations, or production data while using this skill.
---

# MedVerse QA Skill

Canonical sources for expected behavior: [docs/exam-state-machine.md](../../../docs/exam-state-machine.md), [docs/scoring-rules.md](../../../docs/scoring-rules.md), [docs/test-rules.md](../../../docs/test-rules.md), [docs/permissions.md](../../../docs/permissions.md), [docs/deployment.md](../../../docs/deployment.md). Test against these rules, never against an assumed or "reasonable-sounding" alternative — if actual behavior differs from the docs, that's a bug to report, not a rule to silently follow.

## Verification-level labeling — mandatory on every claim

Every claim of "this works" / "this is fixed" / "this passes" must be tagged with exactly one of:

- **MANUAL** — actually driven through a real browser (Playwright MCP or local `npx playwright`) against a running `npm run dev`, observing real UI state, network calls, or console output. This is the only category that counts as "I checked it in the app."
- **AUTOMATED** — a checked-in test suite was run and passed: `npm run test:db` (pgTAP, `supabase/tests/`) or `npm run test:e2e` (Playwright, `tests/e2e/`). Name the command and its result.
- **STATIC** — verified by reading code, migrations, or docs only; no execution happened. Valid for confirming a rule is *implemented*, not that it *behaves correctly* end-to-end.
- **UNVERIFIED** — asserted but not checked by any of the above. Always say so explicitly rather than implying otherwise. Never let an UNVERIFIED claim read like a MANUAL or AUTOMATED one.

**STATIC is not sufficient on its own for critical runtime claims.** Reading the RPC/trigger SQL confirms the *mechanism exists*; it does not confirm the *behavior holds under real execution* (timing, concurrency, network conditions, and race conditions cannot be verified by reading source). For any claim touching:

- exam submission (idempotent `submit_attempt`, duplicate-start protection)
- timing (server-authoritative `expires_at`, transport grace, finalization sweep)
- autosave (`save_answer` debounce/flush behavior)
- recovery (refresh/resume, offline queue flush, crash recovery)
- authorization behavior (RLS matrix, device binding, session eviction)
- scoring (marking formula, void handling, determinism)
- idempotency (submit/save duplicate-request handling)
- concurrency (multi-tab/multi-device races, `save_seq` monotonic guard under simultaneous writes)

— **STATIC alone must not be reported as "verified" or "passing."** Use MANUAL or AUTOMATED evidence whenever the environment supports it (a running dev server for MANUAL, or `npm run test:db`/`npm run test:e2e` for AUTOMATED); if neither is available in the moment, label the claim STATIC or UNVERIFIED explicitly and say so, rather than letting a code-read stand in as proof of runtime behavior.

Never modify application code, schema, migrations, or production data while doing QA — this skill observes and reports; fixes are a separate, explicit step.

## Manual browser testing requirements

- Use the Browser pane / Playwright MCP against a running dev server (`npm run dev`, `localhost:3000`), never against production, unless the user explicitly asks to check production.
- For any exam-path check, prefer isolated fixtures (service-role provisioned student/test, per `tests/e2e/fixtures.ts` pattern) over shared seeded demo data, so runs don't interfere with each other.
- Capture concrete evidence (screenshot, console/network read, or page snapshot) rather than asserting from memory of prior runs.

## Admin workflow

Manually verify, in order: curriculum management (years/subjects/books/chapters/topics) → question bank CRUD + versioning (create → edit creates a new version, never mutates in place) → review workflow (`draft → review → approved/needs_revision → archived`) → test builder (filter bank, manual tick or "add N randomly," only `approved` questions selectable) → `validate_test` checklist blocking the Publish button until every item passes → publish (freezes `question_version_id` snapshot) → enrollment approval → access grants → results/analytics.

## Student workflow

Manually verify: signup → `pending` enrollment (no access) → admin approval → `active` enrollment unlocks year content → dashboard shows only own data → materials browsing (Google Drive links, own year + folder grants) → performance/rank views only for own submitted attempts.

## Enrollment-state testing

Per [permissions.md](../../../docs/permissions.md) — "Enrollment states": `pending` → `active` → `suspended` (temporary) / `expired` (promotion or time) / `revoked` (permanent). **Only `active` grants any content access** — access checks always go through the student's active enrollment's year. Explicitly test all five, not just `pending`/`active`:

- `pending` — post-signup, before admin approval: student has **no** content access (no years/subjects/tests/materials for the pending year).
- `active` — admin-approved: student gets full access to that year's content per the RLS matrix.
- `suspended` — admin places a temporary hold: content access must be revoked immediately, same as if never enrolled; confirm the student cannot access previously-visible year content while suspended.
- `expired` — via promotion or time: confirm access to the expired year's content is gone (a promoted student should only see their new year, not the old one).
- `revoked` — permanent: confirm access is gone and does not silently return (unlike `suspended`, which is presented as temporary in the docs, `revoked` should not be treated as reversible by re-approval alone — verify actual admin behavior against this expectation and report a doc/behavior mismatch if it differs).
- Confirm the partial unique index behavior: a student can have at most one `pending`/`active` row at a time (`(student_id) WHERE status in ('pending','active')`) — attempting a second concurrent enrollment for the same student should be blocked or handled per the documented constraint, not silently duplicated.

## Promotion testing (`promote_student`)

Per [database.md](../../../docs/database.md) — "Enrollment & access": `promote_student(student_id)` sets the active row `expired` and inserts a new active row for `year+1`; audit-logged. Verify:

- **Old enrollment expiration**: the student's prior-year enrollment row moves to `status='expired'` (not deleted, not left `active`).
- **New year enrollment**: a new enrollment row is created for `year_id + 1` with `status='active'`.
- **Dashboard behavior**: after promotion, the student's dashboard/portal reflects the new year's curriculum (years/subjects/books/chapters/topics) and no longer shows the old year as the active context.
- **Audit logging**: an `audit_logs` row is written for the promotion action (`actor_id` = admin, `action`, `target_id` = student, `details`) — this is one of the "admin mutations of consequence" that architecture.md requires to be audit-logged; confirm it via a database read (MANUAL/AUTOMATED with a real `audit_logs` SELECT), not by assumption.
- **Access behavior after promotion**: the student immediately loses access to old-year-only tests/materials/practice content and gains access to new-year content — check this the same way as the enrollment-state tests above (RLS-driven, not just UI-driven: confirm at the data layer, not only what the UI happens to render).
- This is read-only verification (checking existing rows and audit logs) — do not manually promote a real student's enrollment against the connected Supabase project without the user's explicit go-ahead, since it mutates `enrollments` data.

## Practice workflow

Manually verify: practice pulls from `approved` questions only; `submit_practice_answer` returns `is_correct` + `correct_key` + `explanation` + `reference` **immediately** (unlike exam mode); practice is never scored/ranked; `practice_seen`/`practice_answers` update correctly; correct_key/explanation must never be visible before the student answers.

## Import pipeline testing

Per [database.md](../../../docs/database.md) — "Import": `import_batches` (`created_by`, `filename`, `total_rows`, `inserted`, `skipped_duplicates`, `errors`) and `import_rows` (`batch_id`, `row_number`, `outcome check in ('inserted','skipped_duplicate','error')`, `error_message`, `question_id null`). Per [permissions.md](../../../docs/permissions.md)'s RLS matrix, `import_*` tables have **no student access at all** and are admin-`ALL` — this is an **admin-only, RPC-mediated bulk-write path** into the question bank, not a direct-insert path; treat any bulk question import as approved specifically because it goes through the batch RPC and produces an audit trail (`import_batches`/`import_rows`), not because bulk writes in general are approved.

Verify:
- **CSV/XLSX parsing**: a well-formed file produces the expected number of parsed rows before any DB write.
- **Validation**: malformed rows (missing stem, wrong option count, missing/invalid `correct_key`, etc.) are rejected per-row with a clear `error_message`, not silently dropped or allowed to corrupt the batch.
- **Batch commit through the approved import RPC**: confirm the import goes through the documented RPC path (one `import_batches` row + one `import_rows` row per input row), not a direct client-side bulk INSERT into `questions`/`question_versions`.
- **Duplicate reporting**: rows matching an existing question's `content_hash` are reported with `outcome='skipped_duplicate'`, counted in `import_batches.skipped_duplicates`, and do **not** create a duplicate question.
- **Import error report**: `import_batches.errors` and the per-row `error_message`s in `import_rows` give the admin an accurate, actionable summary — cross-check the reported counts (`total_rows = inserted + skipped_duplicates + errors`, roughly) against the actual rows written.
- Successfully inserted questions land in `status='draft'` (per the question workflow) and go through the normal `draft → review → approved` path — an import does not bypass the review workflow.
- Because this writes real question-bank data, only run import tests against local/dev fixtures or with the user's explicit go-ahead if targeting the connected Supabase project — never as an unprompted write against a shared project.

## Test workflow

Manually verify the full lifecycle: `draft` (editable, invisible to students) → `published` (frozen, audience-visible from `opens_at`, "live" = `status='published' AND now() between opens_at and closes_at` and is never a stored column) → `closed` (results per `show_review`: `after_submit` / `after_close` / `never`) → `archived`. Confirm test preview/dry-run records nothing (no attempt row).

## Authentication testing

- Manually verify one-active-session enforcement: login on device B signs out device A (`scope: 'others'`), device A's next request gets `/login?reason=kicked`.
- **Session-cache propagation window**: per [permissions.md](../../../docs/permissions.md), the middleware's JWT `session_id` vs. `active_session_id` comparison is "cached ≤30s per user." A request from the kicked device made within ~30 seconds of the new login may **not yet** be evicted — this is documented, expected propagation delay, **not** a security failure. Do not report "device A wasn't kicked" as a bug unless the eviction still hasn't happened after waiting past the 30s window; retest with that wait before concluding failure.
- This propagation allowance applies **only** to the portal-session (Layer 1) UX check via middleware. It does **not** relax database/RPC-level authorization: `is_active_session()` and the exam RPCs (`start_attempt`/`save_answer`/`submit_attempt`) must still independently enforce the active-session/device rule on every call, with no equivalent grace window. If a request within the 30s window is able to read or write something the active-session rule should have blocked at the RPC/RLS layer (as opposed to just not yet being redirected to `/login`), that **is** a genuine security failure — the propagation allowance is about UI eviction latency, not about authorization correctness.
- Manually verify the exam-session exemption: start an attempt on device A, log in on device B — device B must be able to browse the portal but must be refused entry into that specific attempt; device A's exam must be unaffected. Confirm the exemption ends once the attempt reaches a terminal state (a subsequent login should evict normally).
- Verify role cannot be self-escalated (student cannot set their own `profiles.role`).

## Access-control testing

Manually verify (these are the documented "must NEVER hold" guarantees — treat any violation as a critical bug):
- A student cannot read another student's profile, attempts, answers, enrollment, or results.
- A student cannot read a question's `correct_key`/`explanation` before answering it (exam) or before submitting it (practice).
- A student cannot write questions, tests, grants, or their own `role` via any client path (try the direct Supabase client call, not just the UI, if feasible).
- A student cannot mutate an attempt through anything other than the documented RPCs.

### Access mechanisms — test_audiences vs. access_grants as distinct paths

Per [test-rules.md](../../../docs/test-rules.md) — "Access": `can_access_test(p_test_id)` = test published AND (audience year matches active enrollment **OR** unrevoked access_grant). These are two independently-testable mechanisms, not one — test each as its own scenario rather than treating "the student has access" as a single case:

1. **Cohort access via `test_audiences`**: a student with an `active` enrollment in a year that has a `test_audiences` row for a published test can access it, with **no** `access_grants` row needed. This is documented as "the normal case."
2. **Per-student override via `access_grants`**: a student can access a published test they were individually granted (`access_grants` row, `grant_type='test'`, matching `test_id`, `revoked_at` null) even if their enrolled year is **not** in that test's `test_audiences` — confirm the override path works independently of cohort membership.
3. **Neither mechanism present**: a student with an `active` enrollment but no matching `test_audiences` row and no `access_grants` row for that test gets **0 rows**, not a permission-error page, when direct-navigating to it (`/tests/[id]` fails server-side via the RLS `can_access_test` predicate, not just hidden in the UI).
4. **Revoked access is denied**: an `access_grants` row with a non-null `revoked_at` must **not** grant access — verify a previously-granted-then-revoked student is treated identically to case 3 (0 rows), not as if the grant still applied.

All four scenarios should be checked against the actual data layer (a direct query or direct URL navigation as that student), not just what a UI happens to hide, since the RLS predicate is the actual security boundary per architecture.md.

## Refresh/crash/network-loss testing

Manually verify each row of the exam-state-machine failure-coverage table:
- Refresh / back button mid-attempt → resumes with persisted `question_order`, saved answers, correct remaining time (not reset).
- Simulate offline (devtools network throttling/offline) mid-attempt → answers queue locally, flush on reconnect (`online` event) without loss or duplication.
- Kill the tab/crash and reopen → same resume guarantee as refresh.
- Confirm autosave debounce (~1.5s) and flush triggers (`visibilitychange`, `beforeunload` via `sendBeacon`, `online`) actually fire — check network requests, not just UI.

## Multi-tab/device testing

- Same device, two tabs on the same attempt → second tab shows a blocking overlay (BroadcastChannel coordination); confirm `save_seq` still keeps any writes from both consistent even under a race.
- Two different devices attempting the same test → the second device gets `attempt_locked_other_device`, never silently overwrites the first device's answers.
- Confirm `device_id` persistence (`medverse_device_id` in localStorage) survives refresh but differs across genuinely different browsers/devices.

## Timer testing

- Verify the client countdown is derived from `expires_at - (now + skew)` using `server_now` from RPC responses — not from an unadjusted client clock (try skewing the local system clock and confirm the server-side guard still governs actual cutoff).
- Verify academic grace is truly zero: an answer submitted after `expires_at` must not affect scoring.
- Verify transport grace: a `save_answer` call between `expires_at` and `expires_at + 30s` succeeds (delivery tolerance only — don't treat this as extra thinking time); a call after `expires_at + 30s` is rejected.
- Verify the auto-submit sweep: an attempt left `in_progress` past `expires_at + 60s` gets finalized with `submit_source='auto'`, whether by pg_cron, Vercel Cron backup, or lazy finalize on read.
- Verify client auto-fires `submit_attempt` at 0, but that server-side expiry is enforced independent of whether that client call actually arrives.

## Scoring/ranking testing

- Manually verify the marking formula against known fixture answers: `score = correct*marks_per_question - wrong*negative_mark`, blanks never penalized, values stored to 2 decimal places, percentage unclamped (can be negative, no floor in stored data).
- Verify voided-question handling: `exclude` removes the question from `max_score` and ignores its answers; `credit_all` grants full marks to everyone while it stays in `max_score`; `recompute_test` rescoring reproduces correct new results and re-ranks without touching historical answer rows.
- Verify ranking: `rank` by score desc then earlier `submitted_at` wins ties; `percentile` formula matches spec; only `submitted` attempts are ranked, `invalidated` excluded.
- Verify determinism: re-running `score_attempt`/`recompute_test` against unchanged stored data reproduces identical results (a strong regression signal if it doesn't).

## Kill-switch testing

- **Close test now**: `closes_at` set to now; confirm in-progress attempts finalize via the normal expiry path (transport grace still applies, no special-cased behavior).
- **Invalidate test**: confirm all its attempts move to `invalidated` and are excluded from results/analytics.
- **Void question**: confirm it's safe to do while students are actively testing — in-progress answers are unaffected until scoring; only `recompute_test` changes submitted results.
- **Invalidate attempt (controlled retake)**: confirm reason is mandatory, old attempt + answers are preserved (never deleted), audit log entry is written, and exactly one fresh attempt becomes possible afterward (partial unique index).

## UX testing

- Mobile-friendly layout for the exam UI; palette clearly shows answered / unanswered / marked-for-review states.
- Countdown display, autosave indicator, and any "kicked"/"locked on other device" messaging are understandable to a student mid-exam, not just technically correct.
- Result views correctly label attempt history (e.g. "Attempt #1 — invalidated (device failure) / Attempt #2 — submitted, 82%").

## Deployment/cron testing

Grounded strictly in [deployment.md](../../../docs/deployment.md) — do not extend beyond what it states.

- **pg_cron auto-submit**: the primary sweeper. Verify the job exists and runs every minute: `select * from cron.job;` should show `auto-submit` scheduled `'* * * * *'` calling `public.auto_submit_expired()`. This is documented as remaining "the primary every-minute sweeper" regardless of the Vercel Cron tier.
- **Vercel Cron auto-submit backup**: `vercel.json` schedules `GET /api/cron/auto-submit`. On the **Hobby** plan, Vercel only allows daily crons (`0 0 * * *`) — minute-level Vercel Cron requires Pro. Confirm the deployed schedule matches the actual plan tier (don't expect minute-level Vercel Cron on Hobby; that's expected behavior per the doc, not a bug).
- **`/api/cron/auto-submit`**: confirm the route calls the same `auto_submit_expired()` RPC with the service role, and that it functions correctly when called with a valid bearer token (MANUAL: hit the route with correct/incorrect auth and observe the response).
- **`CRON_SECRET` protection**: the route "verifies `Authorization: Bearer $CRON_SECRET`" before calling the RPC. Verify a request without the correct bearer token is rejected (do not attempt this against the production route without the user's explicit go-ahead, since it's a live endpoint — prefer a local/preview environment where the secret is a non-production value, or a STATIC code read if execution isn't appropriate here).
- **Production deployment checklist** (deployment.md, "Production checklist (Phase 13/14)") — verify each item's actual state rather than assuming it's done, and report which are outstanding:
  - Custom domain on Vercel; HTTPS automatic.
  - Supabase point-in-time recovery / daily backups verified; restore drill done once.
  - Auth: email confirmations ON; password min length ≥ 8; rate limits reviewed.
  - `SUPABASE_SERVICE_ROLE_KEY` only in Vercel server env (never client-exposed — check this is not present in any `NEXT_PUBLIC_*` var or client bundle).
  - pg_cron job verified in production (`select * from cron.job;`).
  - Admin account promoted via SQL; documented out-of-band.
  - Error monitoring: Vercel logs + Supabase logs reviewed during beta; alerting decided before full rollout.
- This section is read-only verification (checking job schedules, route behavior, and config state). Do not change `vercel.json`, `CRON_SECRET`, cron schedules, or any production configuration while doing this QA — report gaps, don't close them here.

## Regression testing

- Before signing off on any exam-engine or scoring change, re-run `npm run test:db` and `npm run test:e2e` (AUTOMATED) in addition to any new MANUAL check — a passing manual check for the new behavior does not substitute for the existing suites still passing.
- Cross-check every change against the full failure-coverage table in exam-state-machine.md and the RLS "must never" list in permissions.md, even when the change looks unrelated to those areas — both are common places for regressions to hide.
- When a bug is found and later fixed, retest not just the reported scenario but the adjacent ones in the same table/list (they tend to share the same code path).
