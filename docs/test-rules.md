# Test Lifecycle Rules (canonical)

## Test states (single `status` column — no boolean flags)

```
draft ──publish_test()──▶ published ──closes_at passes / close now──▶ closed ──▶ archived
  │                          │
  └──delete allowed          └──invalidate──▶ invalidated
```

- `draft` — editable freely; students never see it.
- `published` — frozen (see below); in the student **catalog** for its audience from `opens_at` (locked if not entitled). "Live" is **derived**: `status='published' AND now() BETWEEN opens_at AND closes_at` — never stored.
- `closed` — window over. Owned **score / result summary** stays visible. Paid **review content** (stems, selected keys, correct keys, explanations) follows [access-eligibility-analytics.md](access-eligibility-analytics.md) §11 (live entitlement + `show_review`; server-gated).
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

- **Close test now** — `close_test_now`: set `closes_at = now()` and `status = 'closed'`, and **clamp** every live `in_progress` attempt `expires_at := least(expires_at, now())`. New starts are blocked. Existing `in_progress` attempts may **resume while closed** on the **same device** ([exam-state-machine.md](exam-state-machine.md)). Close-now does **not** force-submit and does **not** add a third grace. The existing **30s transport grace** and **60s auto-submit sweep** ([scoring-rules.md](scoring-rules.md)) apply to the **clamped** `expires_at`.
- **Invalidate test** — status 'invalidated'; all attempts → invalidated; excluded from results/analytics.
- **Void question** — for a wrong key discovered mid-test: set `test_questions.voided` + `void_policy` (exclude | credit_all), then `recompute_test()` rescores all submitted attempts and re-ranks. Safe while students are live — their in-progress answers are unaffected until scoring.

## Attempt reset (controlled retake)

Admin → `invalidate_attempt(attempt_id, reason)` — **reason required**, audit-logged. Old attempt + answers preserved forever; the partial unique index then allows one fresh attempt. Result views label history: "Attempt #1 — invalidated (device failure) / Attempt #2 — submitted, 82%".

## Test builder

Manual only (no autopilot): filter the bank by year/subject/book/chapter/topic/difficulty/status → tick questions, or **"add N randomly from this filtered set"** (builder convenience; admin still reviews the final list). Only `approved` questions selectable.

## Access

Catalog vs content are separate ([permissions.md](permissions.md)):

- **Catalog (`can_view_test`):** published/closed test AND (year in `test_audiences` matches the student’s **active class enrollment** OR unrevoked `access_grants(test)`). Account must be `active` to see the LMS list. Paid tests in that catalog stay **listed and locked** until entitled.
- **Content (`can_access_test`):** catalog plus entitlement (`free` / live subscription / matching plan / allow-grant) and **not** resource-denied. **New** `start_attempt` uses this. Existing tests are backfilled `free`.
- **Resume** of an existing `in_progress` attempt skips catalog / window / `can_access_test` re-check (resume-while-closed and resume after paid expiry). Resume is **same-device only**. Interrupted papers have no extra state — they stay `in_progress` until submit / auto-submit / invalidate.
- Unpublished/draft tests are never in the student catalog.
- Direct URL to start a test without entitlement fails in the RPC (not only in UI). Listing a locked test is allowed; starting it is not.
- Deny restrictions win over grants and subscription. Account-level block (`restricted`/`suspended`/`deactivated`/`revoked`) overrides all resource access (exam disposition: [exam-state-machine.md](exam-state-machine.md)).
- **Current** `can_access_test` is not historical window-eligibility. A later subscription does not make a closed paid test eligible. Missed vs not-eligible: [access-eligibility-analytics.md](access-eligibility-analytics.md).
- **Owned historical result (`get_own_test_result`):** the student’s own `submitted` attempt. Catalog visibility is not required. Paid review remains `get_attempt_review` (8J-A).
