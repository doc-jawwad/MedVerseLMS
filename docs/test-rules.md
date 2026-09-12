# Test Lifecycle Rules (canonical)

## Test states (single `status` column — no boolean flags)

```
draft ──publish_test()──▶ published ──closes_at passes / close now──▶ closed ──▶ archived
  │                          │
  └──delete allowed          └──invalidate──▶ invalidated
```

- `draft` — editable freely; students never see it.
- `published` — frozen (see below); visible to its audience from `opens_at`. "Live" is **derived**: `status='published' AND now() BETWEEN opens_at AND closes_at` — never stored.
- `closed` — window over; results visible per `show_review` setting.
- `archived` — hidden from student lists; history intact.
- `invalidated` — kill switch; attempts marked invalidated; hidden from results.

## Pre-publication validation — `validate_test(test_id)` (its own component)

Postgres function returning a checklist; the UI renders it on the test page and the **Publish button stays disabled until every item passes**. `publish_test()` re-runs it server-side and refuses on any failure.

- ✓ question count ≥ `min_questions` (and > 0)
- ✓ every question `status='approved'` (no draft/review/needs_revision/archived)
- ✓ every current version has 4–5 complete options and a `correct_key` matching an option
- ✓ no duplicate questions in the test
- ✓ valid schedule: `opens_at < closes_at`, `closes_at` in the future
- ✓ valid duration: `duration_minutes > 0` and ≤ window length
- ✓ valid marking: `marks_per_question > 0`, `negative_mark ≥ 0`
- ✓ (during publish) every `test_questions.question_version_id` freezes successfully

## Publish = snapshot

`publish_test(test_id)`: validate → set `question_version_id := questions.current_version_id` on every test_questions row → status 'published' → refresh `questions.used_in_test` cache → audit log. After publish, test config and test_questions are immutable (trigger), except `voided`/`void_policy`.

Later edits to a question create new versions; **published tests keep the frozen version forever** — history is never rewritten. Re-freezing to a newer version is allowed only while `now() < opens_at`, via an explicit admin action (audit-logged).

## Previews

- **Test preview / dry run**: admin opens the real exam UI in preview mode (no attempt row, nothing recorded) at any time before publish.
- **Question content preview**: the question editor always renders the student view live (stem + options; correct answer/explanation/reference toggleable), plus "preview in practice mode" using the actual practice experience.

## Kill switch (operational from Phase 6; every action audit-logged)

- **Close test now** — `closes_at = now()`; in-progress attempts finalize via the normal expiry path (transport grace applies).
- **Invalidate test** — status 'invalidated'; all attempts → invalidated; excluded from results/analytics.
- **Void question** — for a wrong key discovered mid-test: set `test_questions.voided` + `void_policy` (exclude | credit_all), then `recompute_test()` rescores all submitted attempts and re-ranks. Safe while students are live — their in-progress answers are unaffected until scoring.

## Attempt reset (controlled retake)

Admin → `invalidate_attempt(attempt_id, reason)` — **reason required**, audit-logged. Old attempt + answers preserved forever; the partial unique index then allows one fresh attempt. Result views label history: "Attempt #1 — invalidated (device failure) / Attempt #2 — submitted, 82%".

## Test builder

Manual only (no autopilot): filter the bank by year/subject/book/chapter/topic/difficulty/status → tick questions, or **"add N randomly from this filtered set"** (builder convenience; admin still reviews the final list). Only `approved` questions selectable.

## Access

Audience = `test_audiences` (year cohorts) ∪ per-student `access_grants(test)`. A student not covered gets **0 rows** for that test at the DB level (`can_access_test` predicate in RLS) — `/tests/[id]` direct URL fails server-side, not just in UI.
