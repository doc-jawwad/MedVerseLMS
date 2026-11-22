# Test Lifecycle Rules (canonical)

## Test states (single `status` column — no boolean flags)

```
draft ──publish_test()──▶ published ──closes_at passes / close now──▶ closed ──▶ archived
  │                          │                              │
  └──delete_draft_test()     ├──return_to_draft_test()──▶ draft (unopened, zero attempts only)
                             │                              │
                             └──invalidate──▶ invalidated   └──reuse_test_as_draft()──▶ new draft (source unchanged)
```

- `draft` — editable freely; students never see it. Hard-delete via `delete_draft_test(test_id)` (`publish_tests` required; refuses non-draft; audit `test_draft_deleted`). Cascades draft composition (`test_questions` / audiences / prep). Not Content Bin soft-delete. Published/live tests are not deleted this way (close / invalidate instead).
- `published` — frozen (see below); in the student **catalog** for its audience from `opens_at` (locked if not entitled). "Live" is **derived**: `status='published' AND now() BETWEEN opens_at AND closes_at` — never stored. Upcoming published tests list immediately; **default catalog order** is `opens_at` ascending. The student **Dashboard Incoming** card may additionally apply admin-defined **open-list groups** (`test_open_list_groups` / `test_open_list_placements`) as a **presentation overlay** only — group/placement order within that card, with an ungrouped fallback; closed / non-incoming tests still do not appear. This does not change availability, `start_attempt`, answer-key, or entitlement rules. Optional **preparation guidelines** (`test_prep_guidelines`) and optional **syllabus** (`tests.syllabus`, plain text ≤ 8000 chars) are readable after catalog entitlement rules (prep still via `can_access_test` RPCs; syllabus is a non-secret catalog field on the test row). Guideline/syllabus rows stay attached in Test History; they are not a new attempt state.
- `closed` — window over. Owned **score / result summary** stays visible. Paid **review content** (stems, selected keys, correct keys, explanations) follows [access-eligibility-analytics.md](access-eligibility-analytics.md) §11 (live entitlement + `show_review`; server-gated).
- `archived` — hidden from student lists; history intact.
- `invalidated` — kill switch; attempts marked invalidated; hidden from results.

### Return to draft for edits — `return_to_draft_test(test_id)`

Allowed only when **all** hold under a `tests … FOR UPDATE` lock (same serialization as new `start_attempt`): `status='published'`, `opens_at` non-null and `opens_at > now()`, and **zero** `test_attempts` rows for that test (any state, including invalidated). `publish_tests` required. On success: `status → draft`, clear frozen `test_questions.question_version_id` so the next `publish_test` re-freezes current versions; config/questions/syllabus/prep become editable again. Does **not** delete audience, questions, prep, syllabus, or grants. Concurrent `start_attempt` either inserts first (return-to-draft then refuses) or sees `draft` after the flip (start refuses). Audit `test_returned_to_draft`.

### Reuse as new draft — `reuse_test_as_draft(source_test_id)`

For a conducted source (`status` in `published|closed`, `closes_at` non-null and `closes_at ≤ now()`). Invalidated/draft/archived sources refused. Creates a **new** draft with copied year/subject/config/entitlement/syllabus/prep/audiences/questions (order + marks); `question_version_id` null until publish; `opens_at`/`closes_at` null. Never copies attempts, answers, scores, ranks, access grants, or audit history. Source row unchanged. Returns new `test_id`. Audit `test_reused_as_draft`.

## Pre-publication validation — `validate_test(test_id)` (its own component)

Postgres function returning a checklist; the UI renders it on the test page and the **Publish button stays disabled until every item passes**. `publish_test()` re-runs it server-side and refuses on any failure. Callers need `publish_tests` (via `require_permission`), not bare `is_admin()`.

Checklist order:

1. ✓ question count ≥ `min_questions` **and** > 0
2. ✓ no duplicate questions (`count(*) = count(distinct question_id)`)
3. ✓ every question `status='approved'` (no draft/review/needs_revision/archived)
4. ✓ no soft-deleted questions (`questions.deleted_at is null` on every `test_questions` row) — Content Bin items cannot be newly published
5. ✓ every current version has 4–5 complete options and a `correct_key` matching an option
6. ✓ valid schedule: `opens_at < closes_at`, `closes_at` in the future
7. ✓ `duration_minutes > 0` (separate check)
8. ✓ duration fits the window (≤ `closes_at - opens_at`)
9. ✓ valid marking: `marks_per_question > 0`, `negative_mark ≥ 0`
10. ✓ audience assigned (year in `test_audiences` or unrevoked student `access_grants`)
11. ✓ (during publish) every `test_questions.question_version_id` freezes successfully

Student audience **Neither** is a UI gate on Publish (stay draft); it is not a separate `validate_test` row.

**Soft-deleted questions (Content Bin):** a question with `deleted_at is not null` may still appear on a **draft** test (admins can remove it deliberately; there is no automatic detach). It must **not** pass publish: `validate_test` fails “no soft-deleted questions”, and `publish_test` refuses. This is a **prevention rule for future publishing only** — it does not rewrite already-published tests or their frozen history. Hard purge of Bin questions that still have any `test_questions` reference remains blocked (`question_referenced_by_test`); see [database.md](database.md) Content bin retention.

## Publish = snapshot

`publish_test(test_id)`: validate → set `question_version_id := questions.current_version_id` on every test_questions row → status 'published' → refresh `questions.used_in_test` cache → audit log. After publish, test config (including `tests.syllabus`), `test_prep_guidelines.body_text`, and test_questions are immutable (triggers), except `voided`/`void_policy`. A test with student audience **Neither** must stay `draft` — unpublished tests are never catalogued. Free vs paid audience is `tests.entitlement` (`free` vs `any_subscription`), not a second access model. Subscription never removes `entitlement = 'free'`.

Later edits to a question create new versions; **published tests keep the frozen version forever** — history is never rewritten. Attempt review and scoring read those frozen `question_versions` (via `test_questions.question_version_id` / attempt answer versions), not `questions.current_version_id`. Soft-deleting a question after it was already published does **not** rewrite history; Content Bin hard purge is refused while the `test_questions` reference exists. Returning an **unopened** published test to draft (above) clears frozen version IDs so republish re-freezes; it is not a silent in-place re-freeze while remaining published.

## Previews

- **Test preview / dry run**: admin opens the real exam UI in preview mode (no attempt row, nothing recorded) at any time before publish.
- **Question content preview**: the question editor always renders the student view live (stem + options; correct answer/explanation/reference toggleable), plus "preview in practice mode" using the actual practice experience.

## Kill switch (operational from Phase 6; every action audit-logged)

- **Close test now** — `close_test_now`: set `closes_at = now()` and `status = 'closed'`, and **clamp** every live `in_progress` attempt `expires_at := least(expires_at, now())`. New starts are blocked. Existing `in_progress` attempts may **resume while closed** on the **same device** ([exam-state-machine.md](exam-state-machine.md)). Close-now does **not** force-submit and does **not** add a third grace. The existing **30s transport grace** and **60s auto-submit sweep** ([scoring-rules.md](scoring-rules.md)) apply to the **clamped** `expires_at`.
- **Invalidate test** — status 'invalidated'; all attempts → invalidated; excluded from results/analytics.
- **Void question** — for a wrong key discovered mid-test: set `test_questions.voided` + `void_policy` (exclude | credit_all), then `recompute_test()` rescores all submitted attempts and re-ranks. Safe while students are live — their in-progress answers are unaffected until scoring.

## Attempt reset (controlled retake)

Admin → `invalidate_attempt(attempt_id, reason)` — **reason required**, audit-logged. Old attempt + answers preserved forever; the invalidated attempt stops counting toward `max_attempts` (below), so one fresh attempt becomes available while the test is open. Result views label history: "Attempt #1 — invalidated (device failure) / Attempt #2 — submitted, 82%".

## Attempt limit and reattempts (`tests.max_attempts`)

Per-test config `tests.max_attempts int not null default 1 check (max_attempts >= 1)`. **No upper cap** is defined; the only validation is `>= 1` (DB check constraint, also checked by the test form as UX). Existing tests are backfilled `1`, so their behavior is unchanged. Like other test config it is editable in `draft`, frozen after publish (`protect_published_test`), copied by `reuse_test_as_draft`, and editable again after `return_to_draft_test`. There is no separate "allow retake" flag: reattempts are **enabled** iff `max_attempts > 1`.

- **Counted attempts** = the student's `test_attempts` rows for that test in state `in_progress` or `submitted`. `invalidated` attempts **never count** (same as the existing controlled-retake law). There is no attempt-count column; the count is derived.
- **At most one `in_progress` attempt** per (test, student) at any time. A student cannot open attempt #2 while #1 is unfinished; an unfinished attempt is resumed (same-device law unchanged), never abandoned.
- **Reattempt (new start after a submitted attempt)** is allowed only when **all** hold: `max_attempts > 1`; counted attempts `< max_attempts`; no `in_progress` attempt; and every existing **new-start** guard passes unchanged — student role, active session, live class enrollment, `account_status='active'`, `can_access_test` (free/paid/grant/deny law unchanged), `status='published'`, `now()` in `[opens_at, closes_at)`. Each reattempt is a **new row** with its own id, `device_id`, `started_at`, `expires_at = least(now() + duration, closes_at)`, `question_order` / `option_orders`, answers, `submit_source`, and score. Earlier rows are never updated, reset, or deleted to enable a retake.
- **Closed / close-now / invalidated test:** no new attempt (first or reattempt). Resume of an existing `in_progress` attempt is unchanged.
- **Explicit intent + duplicate safety:** see `start_attempt` `p_attempt_no` in [exam-state-machine.md](exam-state-machine.md). Rapid clicks, retries, and concurrent requests produce at most one new attempt; counts are checked under the existing `tests … FOR UPDATE` new-start lock.
- **Error contract:** single-attempt tests keep `already_submitted`. Multi-attempt tests: `attempt_limit_reached` when exhausted; `attempt_no_mismatch` for a stale/duplicate `p_attempt_no`; `already_submitted` only for a `null` (legacy / reload-after-submit) call once an attempt exists. Existing codes (`attempt_locked_other_device`, window/entitlement errors) unchanged.
- **Attempt numbering (display):** "Attempt #n" = order by `started_at` over **all** of the student's attempts on that test, including invalidated ones (as in the history label above). Not stored.

### Ranked result and analytics with multiple attempts

- **Ranked attempt** = the student's single best `submitted` attempt on that test: highest `score`, tie → earliest `submitted_at`, tie → lowest `id`. `invalidated` attempts are never candidates. `in_progress` attempts are never candidates.
- `rank_test` ranks **one row per student** (the ranked attempt) using the unchanged RANK/percentile/tie-break formula; `n` = number of students with ≥ 1 submitted attempt. Non-ranked submitted attempts keep their score fields but store `rank = null`, `percentile = null`. With `max_attempts = 1` this is identical to today.
- The ranked attempt can change when a better reattempt is submitted, when an attempt is invalidated, or after `recompute_test` (voids). All three already mark the test rank-dirty (submit/score) or re-rank (recompute); `invalidate_attempt` on a `submitted` attempt must also mark the test rank-dirty. Coalesced ranking timing is unchanged.
- **Per-test student analytics** (dashboard averages, Attempted/Completed counts, subject performance, weak chapters, leaderboards, admin per-test participation) use **only the ranked attempt** per (student, test) and count **distinct students** — reattempts never inflate counts or averages. Full attempt history is shown only on the student's own result/history view and admin attempt views.
### Review hold while reattempts remain (answer-key safety)

`get_attempt_review` is the only student path that returns per-question review content (stems, selected keys, `correct_key`, explanation, reference). `get_own_test_result` returns aggregate score fields only and students have no `attempt_answers` SELECT, so the hold lives in `get_attempt_review` (server-side; UI lock is UX only).

- **Applies only when `max_attempts > 1`.** Single-attempt tests keep exactly today’s review behavior (including after an admin invalidation retake).
- For a **student** caller (permissioned admins unaffected), review of **any** of that student’s attempts on the test is **held** while `now() < tests.closes_at` **and** the student is not exhausted. **Exhausted** = counted attempts `≥ max_attempts` **and** no `in_progress` attempt. `close_test_now` sets `closes_at = now()`, so it lifts the hold.
- Gate order in `get_attempt_review` (existing checks unchanged, one inserted): account/ownership → `state = 'submitted'` → `show_review` (`never` → `review_disabled`; `after_close` before close → `available_after_close`) → **retake hold** → paid entitlement (`review_locked_entitlement`) → items. Held response: `{ allowed: false, reason: 'available_after_attempts', closes_at, attempts_used, max_attempts }` with **no items** (same shape as the other deny reasons).
- Effect: the hold only changes outcomes for `show_review = 'after_submit'` (`after_close` is already held until close; `never` stays disabled). Paid entitlement still applies after the hold lifts.
- If an admin invalidates an attempt after the student was exhausted, the count drops and the hold re-applies for the remaining window; content the student already saw cannot be withdrawn — admins should treat invalidation on `after_submit` multi-attempt tests accordingly.
- Score summary (`score`, `%`, raw correct/wrong/blank counts, rank on the ranked attempt) is **not** held — it is not review content (paid-expiry law in [access-eligibility-analytics.md](access-eligibility-analytics.md) §11 unchanged).

### Student test-list states (derived display only — not attempt states)

Existing 8J-F classification ([access-eligibility-analytics.md](access-eligibility-analytics.md)) adds one label: **Retake available** = test live, ≥ 1 submitted counted attempt, no `in_progress`, counted attempts `< max_attempts`, and `can_access_test`. Otherwise a test with a submitted attempt shows **Result** (Submitted), an `in_progress` attempt shows **In progress** (resume), and a closed window shows the closed/result states as today. The UI label is UX only; `start_attempt` is the authority.

## Test builder

Manual only (no autopilot). Admins can:

- **Bank pick:** filter by year/subject/book/chapter/topic/difficulty/status and optionally by **MCQ Bank product → folder → subfolder** (exact placement on `questions.mcq_bank_folder_id` / `mcq_bank_subfolder_id`) → tick one or many questions → **Add selected**, or **"add N randomly from this filtered set"** (builder convenience; admin still reviews the final list). Random and the visible pool share the same URL filter; a selected bank/folder/subfolder must **not** silently broaden to the whole departmental subject or another product/year. Only `approved` live questions selectable; already-in-test ids are skipped.
- **CSV import set:** draft Test Builder reuses Question Bank CSV + `import_question_batch` (`import_batches` / `import_rows`). After a valid import, the picker scopes to that batch (`?import_batch=`) so the admin can **Select imported set** / **Add imported set** (or still tick individuals). Does not change random-selection, scoring, or publish freeze.
- **Inline create:** author a new MCQ on the draft test page (subject/book/chapter/topic locked to the test’s year). `create_question` with `status='approved'`, then attach to the draft. Topic year must match `tests.year_id`.
- **Mix:** bank picks, CSV import sets, and inline creates can be combined on the same draft; reorder, per-question marks, and remove apply to the full list before publish.
- **Edit question content from a draft:** the builder’s **Edit question** link opens the shared Question Bank editor and saves via `create_question_version` (append-only). There is no draft-local question copy. Remove from draft deletes only the `test_questions` row. Published tests keep their frozen `question_version_id`; the draft reads `questions.current_version_id` until publish.

`validate_test` / Publish stay the gate — see checklist above.
## Access

Catalog vs content are separate ([permissions.md](permissions.md)):

- **Catalog (`can_view_test`):** published/closed test AND (year in `test_audiences` matches the student’s **active class enrollment** OR unrevoked `access_grants(test)`). Account must be `active` to see the LMS list. Paid tests in that catalog stay **listed and locked** until entitled.
- **Content (`can_access_test`):** catalog plus entitlement (`free` / live subscription / matching plan / allow-grant) and **not** resource-denied. **New** `start_attempt` uses this. Existing tests are backfilled `free`.
- **Resume** of an existing `in_progress` attempt skips catalog / window / `can_access_test` re-check (resume-while-closed and resume after paid expiry). Resume is **same-device only**. Interrupted papers have no extra state — they stay `in_progress` until submit / auto-submit / invalidate.
- Unpublished/draft tests are never in the student catalog.
- Direct URL to start a test without entitlement fails in the RPC (not only in UI). Listing a locked test is allowed; starting it is not.
- Deny restrictions win over grants and subscription. Account-level block (`restricted`/`suspended`/`deactivated`/`revoked`) overrides all resource access (exam disposition: [exam-state-machine.md](exam-state-machine.md)).
- **Current** `can_access_test` is not historical window-eligibility. A later subscription does not make a closed paid test eligible. Missed vs not-eligible: [access-eligibility-analytics.md](access-eligibility-analytics.md).
- **Owned historical result (`get_own_test_result`):** the student’s own **ranked** (best) `submitted` attempt, plus the student’s own attempt history for that test (attempt #, state, timestamps, score/percentage per attempt). Catalog visibility is not required. Paid review remains `get_attempt_review` (8J-A).

## Formal exam vs practice (SPEC FREEZE)

- Existing exam state machine, freeze-at-publish, kill switch, and attempt states in this document and [exam-state-machine.md](exam-state-machine.md) remain **frozen**.
- **Test MCQ** remains a formal timed test on `tests` + attempt RPCs.
- Practice remains a **separate** product surface (All / Remaining / Done / Favorites, favorite/unfavorite, Done→Remaining reset, % completion, forward timer, practice report) — see [architecture.md](architecture.md) / [database.md](database.md). Practice must **not** reuse `test_attempts`.
- **`rank_test`** remains the only ranking source for Dashboard Top 3 and Analytics Top 20 ([access-eligibility-analytics.md](access-eligibility-analytics.md)).