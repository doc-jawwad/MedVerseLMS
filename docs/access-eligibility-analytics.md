# MedVerse LMS — Canonical Access, Eligibility, Subscription, Dashboard & Analytics Rules

This document is the **source of truth** for student access, test eligibility, subscription transitions, dashboard analytics, and leaderboards. Later 8J implementation must follow it. It does **not** replace [exam-state-machine.md](exam-state-machine.md) attempt states, [scoring-rules.md](scoring-rules.md) marking formulas, or [test-rules.md](test-rules.md) test lifecycle.

If this document conflicts with older reviews or canvases, **this document wins**. If it conflicts with an already-settled rule in [permissions.md](permissions.md), [database.md](database.md), [exam-state-machine.md](exam-state-machine.md), or [scoring-rules.md](scoring-rules.md), **do not silently override** — raise the contradiction. Unresolved product choices are labeled **OWNER DECISION**.

Labels used throughout:

| Label | Meaning |
|---|---|
| **CONFIRMED PRODUCT LAW** | Must be true in product and (eventually) in Postgres. Do not implement the opposite. |
| **CURRENT IMPLEMENTATION** | What the repository does today (migrations, RPCs, RLS, UI). |
| **ARCHITECTURAL GAP** | Current implementation does not yet match product law, or cannot express it. |
| **PROPOSED ARCHITECTURE** | Intended design for 8J / follow-on, still subject to owner decisions where marked. |
| **OWNER DECISION** | Genuine unresolved product choice. Do not guess in migrations. |

Companion analyses (not canonical): subscription-vs-dashboard canvas; eligibility-and-leaderboards canvas.

---

## 0. Four facts that must never be collapsed

**CONFIRMED PRODUCT LAW.** These are independent. Never infer one from another.

| Fact | Question it answers | Evaluated at |
|---|---|---|
| **Current access** | May this student start/open this resource **now**? | Time of read / start |
| **Historical eligibility** | Could this student have started this **test during its active window**? | Window time (not “subscribed today”) |
| **Historical academic data** | What did this student actually submit, score, and rank? | Immutable rows on the student |
| **UI visibility** | Is the item listed, locked, hidden from a menu, or previewed? | Presentation only |

**CONFIRMED PRODUCT LAW.** Current subscription status never rewrites historical eligibility or historical academic data.

---

## 1. Canonical MedVerse access model

### 1.1 Hierarchy (evaluate top-down)

**CONFIRMED PRODUCT LAW.** An **active** student is evaluated in this order. A later layer cannot override an earlier **deny** except where this table explicitly says so.

| # | Layer | What it is | Effect |
|---|---|---|---|
| 1 | **Account status** | `profiles.account_status` | Non-`active` → no LMS catalog, no content RPCs (exam disposition exception only). Overrides everything below. |
| 2 | **MBBS year / enrollment** | Live `enrollments.status = 'active'` | Assigned class. Catalog membership for year-scoped items. Not payment. Not LMS approval. |
| 3 | **Subscription status** | Live subscription = `status = 'active' AND now() < ends_at + grace_days` | Time-bounded paid overlay. Absence = free student. Expiry does **not** change account status. |
| 4 | **Plan** | `subscriptions.plan_id` → `subscription_plans` | Used when a resource’s entitlement is `plan`. Schema supports many plans; product starts with one. Complimentary access is a plan (and/or grants), never a flag on `profiles`. |
| 5 | **Global resource policy** | Resource `entitlement` = `free` \| `any_subscription` \| `plan` (+ `required_plan_id`) | Default rule for **all** students. Admin does **not** grant every paid item to every subscriber. |
| 6 | **Grant (allow overlay)** | Unrevoked `access_grants` (today: per student) | Exception: named item becomes usable despite missing paid entitlement / off-year catalog, still subject to deny and account. |
| 7 | **Restriction (deny overlay)** | Unrevoked `access_restrictions` | Exception: named item cannot be used. **Deny wins** over grant, plan, and subscription. Not the same as account `restricted`. |
| 8 | **Test eligibility (window)** | Could the student have called `start_attempt` during `[opens_at, closes_at)`? | Historical. Not current subscription. See §7. |
| 9 | **Current resource access** | `can_access_*` / `resource_content_allowed` / exam window | Start test, open file, fetch practice **now**. |
| 10 | **Navigation visibility** | Which menu items the shell shows | UX. **Not entitlement.** |
| 11 | **Catalog visibility** | `can_view_*` — listed, including locked paid | See the item. Unpublished tests stay hidden. |
| 12 | **Dashboard visibility** | Which cards, locks, previews, and history links render | UX over 9–11 plus owned history. Must not leak secrets. |

**CONFIRMED PRODUCT LAW — precedence for current use of a resource** (active account only):

1. Catalog membership (current year/audience **or** live allow-grant). If not in catalog → not listed (except owned-history surfaces in §15).
2. Unrevoked **restriction** → cannot use.
3. Unrevoked **grant** → can use (still needs catalog membership via year or that grant).
4. Else **global entitlement**: `free` always; `any_subscription` / `plan` only if live subscription (including grace) **and** `paid_access_mode ≠ grants_only`.
5. Tests additionally require `status = published` and `now()` in `[opens_at, closes_at)` to **start**. Window is independent of entitlement.

**CONFIRMED PRODUCT LAW.** `paid_access_mode = all_entitled` (default) means a live subscriber receives every resource whose entitlement is `any_subscription` or matching `plan`, without per-item grants. `grants_only` means paid entitlement does **not** unlock; only free entitlement or a live grant can. Deny still wins. Grants never override a blocked account.

### 1.2 Current vs historical vs UI

| | Current access | Historical eligibility | Historical academic data | UI visibility |
|---|---|---|---|---|
| Source | Live account + year + sub + policy + grant + restriction + window | Who **could start during the window** | `test_attempts`, answers, scores, ranks, practice | Menus, catalog, locks, dashboard cards |
| Changes when student subscribes today? | Yes, for **open** paid items | **No** for already-closed tests | **No** | Catalog locks may flip to Start |
| Changes when subscription expires? | Paid starts lock; paid **review content** locks | **No** | **No** | Start locked; score/history stay; paid review locked |
| Safe to derive from current `can_access_test`? | Yes (now) | **No** | **No** | Partial only |

### 1.3 CURRENT IMPLEMENTATION (8D / pre-8J)

Eight-D (`20260915034353_resource_entitlement.sql`) introduced entitlement columns, `access_restrictions`, catalog vs content (`can_view_*` vs `can_access_*`), and `resource_content_allowed`. Pre-8J (`20260916013000`, `20000`, `21000`) added grace 0/1/2, `paid_access_mode`, `live_paid_access_is_grants_only()`, year-isolation catalog RLS, and notification/restore wiring.

**Evaluation:** this correctly represents “global policy + exception overlays.” Admin does **not** need a grant per subscriber for `all_entitled`. Individual grants/restrictions are exceptions. Group grants **do not exist** in schema (`student_id` only).

Helpers (do not re-derive in app code): `account_allows_lms()`, `has_active_enrollment()`, `has_live_subscription()`, `has_live_plan()`, `resource_content_allowed()`, `can_view_test` / `can_access_test`, `can_view_practice_subject` / `has_practice_access`, `can_view_material_folder` / `can_access_material_folder` / `open_material`.

Nothing in 8D/pre-8J is obsolete. What is **missing** is historical window-eligibility (§7, §19), not a replacement of entitlement columns.

---

## 2. Free student experience

**CONFIRMED PRODUCT LAW** (already in [architecture.md](architecture.md) / [permissions.md](permissions.md)):

- After email verification, an **active** student enters the LMS **without** a paid subscription. No admin enrollment approval.
- Absence of a live subscription = free student.
- Free resources (Admin-defined `entitlement = 'free'`, and not restricted) are usable immediately.
- Paid sections/resources stay **visible, not hidden**.
- Paid content cannot be opened/started without entitlement. Authorization is RLS/RPC, not CSS.
- Subscription CTA may be shown (`ResourceLockNotice` → `/subscription`).
- Dashboard is available.
- Free-test history, results, and lifetime analytics remain available.
- Secrets (Drive URL, signed URL, question payload, `correct_key`, other students’ private data) must **never** be sent to the client merely because a card is locked, blurred, or previewed.

**CONFIRMED PRODUCT LAW.** Free Resources are **Admin-controlled**, not hardcoded menus named “lectures / PDFs / OSPEs / free tests / MCQ banks.” Those are possible **types**. Admin decides which items are free by setting global entitlement (and publish state). New types later reuse the same entitlement shape.

**PROPOSED ARCHITECTURE (8J UX):**

- Admin can create folders/categories, reorder them, add resources, publish/unpublish, and mark free vs paid.
- Free students see a **Free Resources** area (nav and/or dashboard) listing currently free, published, in-year (or granted) items.
- Paid items elsewhere remain listed with lock / limited preview.
- Paid dashboard **previews** may be locked, limited, or blurred **only** where they represent currently unavailable **functionality**. Preview must not include other students’ scores, explanations, or any payload the student is not authorized to SELECT.

**CURRENT IMPLEMENTATION:**

- One student nav for everyone: Dashboard, Study Materials, Practice MCQs, Tests, Performance, My Subscription, My Account.
- No dedicated Free Resources tab. Free vs paid is per test / practice subject / material folder.
- Existing rows were backfilled `entitlement = 'free'` (compatibility). New items may be paid.
- Lock UX: `ResourceLockNotice` + reduced opacity. No structured blur-preview of paid analytics.
- Materials catalog SELECT does not include `drive_url`; `open_material` enforces entitlement.

**ARCHITECTURAL GAP:** no first-class Free Resources library (mixed types, publish/unpublish on folders). Materials have no `published` flag; tests use `status`. Do not invent a parallel entitlement system — group **presentation** of `entitlement = 'free'` items.

---

## 3. Subscribed student experience

**CONFIRMED PRODUCT LAW:**

- A live subscriber receives plan-level access according to global policy (`all_entitled` vs `grants_only`) plus grants minus restrictions.
- They **retain the right** to every free resource. Subscription never removes free entitlement.
- Explicit restrictions can still deny a named item.
- Explicit grants can still add exceptions (including off-year).
- Dashboard **Start** on paid tests/practice/materials follows current entitlement.
- Historical free (and any earlier paid) academic data remains on the same lifetime series. No second analytics island.

**PROPOSED ARCHITECTURE:** subscribed students **may** see a different navigation (for example no “Free Resources” tab) because those items already live under Materials / Practice / Tests. **Not shown in navigation ≠ not entitled.** Deep links and catalog of free items must still work.

**CURRENT IMPLEMENTATION:** navigation does not change with subscription. `accessible_test_ids` / `accessible_folder_ids` / `practice_subjects().granted` flip Start vs lock on the next Server Component render. Paid access is not stored in the JWT.

---

## 4. Resource access model

### 4.1 Canonical split

| Code | Concept | Meaning |
|---|---|---|
| A | Global resource policy | `free` / `any_subscription` / `plan` on the resource |
| B | Navigation visibility | Menu chrome |
| C | Catalog visibility | `can_view_*` — listed (locked paid still listed) |
| D | Current entitlement | `can_access_*` after A + live sub/plan + grace |
| E | Restriction | Deny overlay |
| F | Individual/group override | Grant overlay (group = future; see below) |

**CONFIRMED PRODUCT LAW.** A is the default. E and F are **exceptions**. Subscribers are not provisioned by attaching a grant to every paid resource.

**Future plans** (PLAN A / B / C) are already modeled: `entitlement = 'plan'` + `required_plan_id`. Product currently starts with one plan. Do not add a new entitlement enum value per plan name.

### 4.2 Group grants

**CURRENT IMPLEMENTATION:** `access_grants` / `access_restrictions` are **per `student_id`**. No group table.

**PROPOSED ARCHITECTURE:** if group grants/restrictions are added later, they are the same overlays with a group target, evaluated with **deny still winning**, never bypassing account status, and never rewriting history. They are **not** required to ship 8J. Do not treat “admin must grant every subscriber” as the model — that is what `all_entitled` avoids.

**OWNER DECISION:** whether 8J or a later step introduces group grants at all.

### 4.3 8D / pre-8J fidelity

| Piece | Status |
|---|---|
| Entitlement columns on tests, subjects, material_folders | Correct global policy. Keep. |
| `access_grants` / `access_restrictions` | Correct exception overlays (individual). Keep. |
| `paid_access_mode` | Correct subscriber default vs grants-only. Wired in `resource_entitlement_allows`. |
| `resource_content_allowed` | Account → not restricted → grant OR entitlement. Correct. |
| `can_view_*` vs `can_access_*` | Correct catalog vs content. |
| Using `can_access_test` for **leaderboard view** | Incorrect proxy — see §13. |
| Using `can_view_test` for **owned result page** | Incorrect proxy after year change — see §15. |
| Historical window eligibility | Not represented. Do not overload `can_access_test` for it. |

---

## 5. Historical academic data

**CONFIRMED PRODUCT LAW.** Subscription status **never** rewrites historical academic records.

Never, on activate / expire / renew / grant / revoke / restrict / restore / year change:

- delete attempts
- duplicate attempts
- rescore attempts (except existing `recompute_test` void path — unrelated to subscription)
- reset attempts
- alter frozen answers
- rewrite historical scores
- rewrite historical rank snapshots as a side effect of entitlement

Historical records stay attached to `student_id`. They include at least: `test_attempts`, `attempt_answers`, scores, `rank` / `percentile` snapshots, `practice_answers`, `practice_seen`, and other existing academic rows.

**CONFIRMED PRODUCT LAW.** Subscription only determines what the student may **START / ACCESS NOW**.

**CURRENT IMPLEMENTATION:** already true for writes. Attempts are RPC-only, never deleted (invalidated at worst). Analytics RPCs do not join subscriptions. Cron `expire_due_subscriptions()` only normalizes `status`; it does not touch attempts.

**Exception already in exam law:** an `in_progress` attempt started while entitled may `save_answer` / `submit_attempt` after paid expiry. Entitlement is checked at `start_attempt`, not on every save. That is exam integrity, not a leak of **new** paid tests.

---

## 6. Subscription transitions

**CONFIRMED PRODUCT LAW** for every row: historical data unchanged; current access re-evaluated at time of read; no duplicate analytics.

| | Free → subscribed | Subscribed → expired | Expired → renewed | Grant → revoked | Restricted (resource) → restored | Account blocked → restored |
|---|---|---|---|---|---|---|
| Historical data | Keep | Keep | Keep; no reset | Keep attempts taken under the grant | Keep | Keep (rows were never deleted) |
| Current access | Paid policy applies | Paid starts lock; free remains | Paid policy applies again | Named item re-locks | Named item follows policy again | LMS re-enters |
| New test access | Open **future** paid windows startable | Cannot start paid | New eligible windows startable | Cannot start that test unless policy allows | As policy | As policy |
| Closed paid tests | Stay **not eligible** | Stay historical if sat; not newly startable | Stay not newly eligible | Start stays closed if window closed | Does not rewrite window eligibility | Does not rewrite history |
| Resources | Paid unlock per policy | Paid lock; free usable | Paid unlock | Named item locks | Named item usable if otherwise entitled | Catalog returns |
| Dashboard | Same shell; Start replaces lock | History cards stay; Start locked | Start enabled; history continues | View result stays if owned | Unlock that item | Full LMS |
| Analytics | Same lifetime set; grows when new submits occur | Unchanged | Continues; no duplicate series | Submitted rows stay in lifetime averages | Unchanged | Visible again |
| Leaderboard **ranking** | Unchanged for old tests (not inserted as zero) | Own submitted rank snapshot stays | Unchanged | Rank snapshot stays | Unchanged | Unchanged |
| Leaderboard **view** | See §13 / OWNER DECISION | See §13 | See §13 | View follows view-auth rule, not ranking | — | — |
| Result access | Owned results stay | Owned results stay | Owned results stay | Owned results stay | Owned results stay | Owned results stay after restore |

**CONFIRMED PRODUCT LAW.**

- Free → subscribed: future eligible paid tests become startable. Previously **closed** paid tests do **not** become retroactively eligible.
- Subscribed → expired: historical paid scores remain; paid starts lock; historical analytics remain; owned results remain; `account_status` stays `active`.
- Expired → renewed: history continues; no reset; no duplicate analytics; new eligible windows become accessible. Renewal while still live (including grace) extends `ends_at` from the **existing end**, not from `now()` ([database.md](database.md)).
- Grant revoked: re-locks **Start**, not owned **View result**.
- Resource restriction restored: named item usable again if policy allows; history untouched.
- Account `restricted` / `suspended` / `deactivated` / `revoked` is **not** expiry. Portal blocked. Rows retained. Restore returns visibility. Mid-exam: explicit disposition ([exam-state-machine.md](exam-state-machine.md)).

---

## 7. Test eligibility model

Keep these seven concepts distinct. **CONFIRMED PRODUCT LAW.**

| | Concept | Precise definition | Persistence |
|---|---|---|---|
| A | **Test existence** | A `tests` row that was published (and may now be closed/archived) | `tests` |
| B | **Window eligibility** | During `[opens_at, closes_at)`, this student could have passed `start_attempt` guards (active account, audience/year or grant, content entitlement, not restricted, status published) | **Not stored today** |
| C | **Current access** | `can_access_test` **now** (plus window if starting) | Derived live |
| D | **Participation** | A non-invalidated attempt exists (`in_progress` or `submitted`) | `test_attempts` |
| E | **Submitted score** | `state = 'submitted'` (student, auto, or admin finalize) | `test_attempts` |
| F | **Historical analytics** | Aggregates over **this student’s E** (lifetime default) | Derived live |
| G | **Leaderboard population** | Who is **ranked** on that test | Submitted set only (§13) |

**CONFIRMED PRODUCT LAW.** Current subscription ≠ historical eligibility. Subscribing today does not make the student eligible for a test whose window already closed.

**CURRENT IMPLEMENTATION:** A, C, D, E, F, G(ranking) exist. B does not. C cannot reconstruct B: grants, restrictions, `account_status`, entitlement, and audience can all change after close. Subscription `starts_at`/`ends_at` and grant `created_at`/`revoked_at` are **partial** clues only (`account_status` has no history table).

**ARCHITECTURAL GAP.** Fair, stable B requires either a dedicated eligibility/participation snapshot **or** an explicit product decision to live with derivation limits.

**OWNER DECISION.** Snapshot eligibility (for example at window close or at a failed/successful start check) vs continue deriving until it hurts. Do **not** create the table in this pass.

Until B is reliable, product copy may treat “no attempt + window already closed + never had content access during the window” as **not eligible**, and must **never** treat it as a score of zero.

---

## 8. Missed-test model

**CONFIRMED PRODUCT LAW.** Do not create fake `test_attempts` rows to represent absence.

| State | Meaning | Average / score analytics | Completion | Participation | Per-test rank |
|---|---|---|---|---|---|
| **NOT ELIGIBLE** | Could not sit during the window (unpaid, wrong year, restricted, not in audience, etc.) | Exclude. **No zero.** | Exclude both sides | Exclude both sides | Not listed |
| **MISSED** (eligible, never started) | Window-eligible and never started | Not a submitted score. **Not included as zero by default.** | Denominator: **OWNER DECISION** | Count as non-participant | Not listed (not a zero row) |
| **IN_PROGRESS** (`in_progress`) | Live attempt (including interrupted / resume-while-closed) | Not in submitted averages yet | Incomplete | Participated | Not ranked until submitted |
| **SUBMITTED** (student) | Final scored paper | Include | Complete | Participated | Ranked |
| **Auto-submitted** | `submit_source = 'auto'` | **Real submitted attempt.** Include (blanks are not wrong; score may be 0 from blanks — that is not an ineligible zero) | Complete | Participated | Ranked |
| **Invalidated** | Admin void | Exclude from analytics (existing law) | Labelled history; not a live result | **OWNER DECISION** if it counts as a sit | Excluded |

**CONFIRMED PRODUCT LAW.** **NOT ELIGIBLE** is not **MISSED**. **MISSED** is not automatically a zero. **IN_PROGRESS** is not a score. **SUBMITTED** (including auto-submit of an empty paper) is a real submitted score. These four must never be collapsed.

Admin-configurable “missed = 0” would apply **only** to eligible-missed, never to not-eligible. **OWNER DECISION** whether such a policy exists at all. Recommended default if unset: missed = absent from average, countable in participation.

---

## 9. Late subscriber (Ahmad)

Canonical example:

- Jan: paid test A (window closed before April)
- Feb: paid test B
- Mar: paid test C
- Apr: Ahmad subscribes

**CONFIRMED PRODUCT LAW.**

| Test | Canonical state |
|---|---|
| A, B, C | **NOT ELIGIBLE** — not 0, not missed, no fabricated attempt |
| Tests whose windows open after he is entitled | **ELIGIBLE**; scores recorded only if he sits them |

### 9.1 What Ahmad sees

**CURRENT IMPLEMENTATION:**

- Test list: A/B/C listed (catalog) as **Not eligible**, not Missed. Start remains impossible (`test_window_closed` even with a grant).
- Leaderboard RPC: after April, `can_access_test` is true for closed paid tests still in catalog, so he can **view** classmates’ ranks without ever being eligible to sit. He is **not** in `rank_test`’s set (no submitted row). Ranking itself does not insert zeros.
- Dashboard counters: `student_test_summary` averages **submitted** rows only. A/B/C do not become zeros. They also do not appear as “missed” in SQL — the UI just omits them from `tests_taken`.
- Completion / participation: **no student completion metric** exists. Admin `participation_pct` uses current enrollments × any attempt ever — after April, Ahmad with zero submits looks like a non-participant academy-wide.

**PROPOSED ARCHITECTURE:**

- Test list: A/B/C listed (catalog) as **Not eligible**, not Missed. Start remains impossible (`test_window_closed` even with a grant).
- Leaderboard **ranking**: Ahmad absent on A/B/C.
- Leaderboard **view**: OWNER DECISION (§20.3). Recommended direction: viewing others is not the same as having been in the race; do not show him as a zero participant.
- Dashboard: Attempted = his submits; Eligible = tests with B true; Missed = eligible and never started; Not eligible = A/B/C. Average = attempted only. Completion = attempted / eligible (**not** / all tests that exist). Participation = attempted / eligible.
- Grant after close does **not** reopen the window unless a new admin late-sit action is approved (OWNER DECISION §20.4).

Peer who was subscribed in January and skipped A: **Eligible, missed** — different label, different participation denominator, still no automatic zero on the board.

---

## 10. Dashboard analytics

### 10.1 Student dashboard concepts

**CONFIRMED PRODUCT LAW.** Cards must not say “20 tests / 8 completed / 12 missed” when some of the 12 were never available.

| Concept | Meaning | Feeds average? |
|---|---|---|
| **Attempted** | Submitted (and optionally in-progress, labelled separately) | Yes — submitted only |
| **Eligible** | Window-eligible tests for this student | Denominator for participation/completion |
| **Missed** | Eligible and never started | No (default) |
| **Not eligible** | Existed but could not sit | No; informational only |

Lifetime / historical analytics remain based on the student’s **historical submitted work**. Subscription changes do not rewrite that set; new submits append.

- Free → subscribed: existing dataset remains; new paid submits increase it.
- Expired: historical analytics remain; currently unavailable **functionality** locks.
- Renewed: analytics continue; no reset.

**OWNER DECISION.** Subscription-period metrics (filter submits by `starts_at`..`grace_until`) — only as an **additional** query, never a replacement of lifetime. Charts marking free vs paid points vs one unlabeled series.

### 10.2 CURRENT RPC classification

| RPC | Grain | Filter | Subscription-dependent? |
|---|---|---|---|
| `student_test_summary` | Lifetime | `submitted` for `auth.uid()` | No |
| `student_recent_tests` | Lifetime | submitted, recent | No |
| `student_trend` | Lifetime | submitted, chronological | No |
| `student_subject_performance` | **Current enrollment year subjects** | submitted tests + all practice on those subjects | No |
| `student_weak_chapters` | Lifetime practice | practice answers, min 3 | No |
| `average_rank` (inside summary) | Lifetime | mean of per-test `rank` among submitted | No — **not** a class cumulative board |
| `test_leaderboard` | One test | submitted **and** caller `can_access_test` or admin | **Yes (view gate)** |
| `get_attempt_review` | One attempt | owner/admin + `show_review` + live paid entitlement for review items | Review lock only |
| `test_summary` (admin) | One test | `registered` = **current** active enrollments in audience year; attempted/completed from attempts | Indirectly wrong denominator |
| `admin_platform_summary` | Platform | `participation_pct` = current active enrollments with **any** submitted attempt ever | Wrong denominator |
| `question_difficulty_report` | Platform | practice + test answers | No |

**Inconsistencies (ARCHITECTURAL GAP):**

1. Summary/trend/recent = lifetime submitted; subject bars = current-year subjects only; weak chapters = lifetime practice. Year change desyncs those surfaces.
2. Dashboard has no Attempted / Eligible / Missed / Not eligible split.
3. Tests page “Not attempted” conflates missed and not eligible.
4. No student completion or participation metric using window-eligible tests.
5. `average_rank` looks like a class rank; it is the mean of personal per-test ranks.

**PROPOSED ARCHITECTURE.** Keep lifetime submitted RPCs as default F. Add Eligible/Missed/Not eligible only after B is defined. Do not filter lifetime RPCs by `can_access_test`.

---

## 11. Paid → free dashboard (former subscriber)

**CONFIRMED PRODUCT LAW.**

| Surface | Behavior |
|---|---|
| Historical attempts / **scores / ranks / result summary** | **KEEP** |
| Own **selected answers**, stems, correct keys, explanations (paid review content) | **LOCK** without live paid entitlement. Server must deny. Renewal restores review; never rescores. |
| Dashboard performance strip, recent tests, `/performance` charts | **KEEP** appropriate historical performance (lifetime) |
| Paid Start / paid practice fetch / paid `open_material` | **LOCK** |
| Historical paid result page (own **score / % / summary**) | **KEEP** (authorize by attempt ownership, not `can_view_test`) |
| Historical paid analytics points | **KEEP** on the same charts |
| Paid **functionality** that is not history (start another paid test, open a new paid file, unlock review keys) | Lock / limited preview |
| Account | Stays `active`; LMS shell stays open; free resources usable |

Do not hide historical **scores** because subscription expired. Do not blur **owned** score cards. Paid **review content** is not a score card — lock it server-side (`get_attempt_review` + no student `attempt_answers` SELECT). UI lock/CTA is not authorization.

**CURRENT IMPLEMENTATION:** own scores KEEP via `get_own_test_result` (attempt ownership; not `can_view_test`). `get_attempt_review` denies paid review items without live `resource_content_allowed` (`review_locked_entitlement`). Student `attempt_answers` SELECT is denied (admin SELECT remains). **GAP:** `test_leaderboard` empties after expiry because of `can_access_test` — that remains view-auth / OWNER DECISION §20.3, not ranking, and is **not** the review-lock law.

---

## 12. Free → paid dashboard

**CONFIRMED PRODUCT LAW.**

Before subscription: free dashboard, free activity, locked paid areas, limited paid previews without leaking secrets.

After subscription:

- Existing history remains (no copy, no re-own, no exclude).
- Paid navigation **may** appear (proposed); menus were already visible today.
- Paid resources/tests become startable according to **current** entitlement and **open** windows.
- Analytics expand only as **new submitted work** occurs. Same RPCs, larger submitted set.

Do **not** create a duplicate analytics history or a “paid-only from activation date” default.

---

## 13. Leaderboards

### 13.1 Individual test leaderboard (ships today)

**CONFIRMED PRODUCT LAW — ranking:**

- Population = `test_attempts` where `state = 'submitted'` for that `test_id`.
- `rank = RANK() OVER (ORDER BY score DESC, submitted_at ASC)`; earlier submit wins ties.
- `percentile` per [scoring-rules.md](scoring-rules.md); `n ≤ 1` → `percentile` null, `rank` still 1.
- Invalidated excluded.
- **Not eligible:** not ranked, not inserted as zero.
- **Eligible but missed:** not ranked as zero.
- Started + submitted (including auto-submit): rank normally.

**CURRENT IMPLEMENTATION:** `rank_test` matches ranking law. It does **not** zero-fill absentees or ineligible students. Subscribing, expiring, or renewing does **not** rewrite other people’s ranks (no new submitted row).

**CONFIRMED PRODUCT LAW — view authorization is a different question from ranking.** A student may own a historical result even if they cannot start the test now. Do not remove that result. Do not automatically drop them from **ranking** because entitlement changed.

**CURRENT IMPLEMENTATION — view:** `test_leaderboard` requires `can_access_test` or admin. That uses **current entitlement** as a proxy for “may see the board.” Consequences:

- Late subscriber can read a closed paid board without ever sitting it.
- Expired student who **did** sit it currently cannot read classmates’ rows (own score on the result page still loads via attempt RLS).
- Year change used to 404 the whole result page (`tests` SELECT via `can_view_test`) even though the attempt row exists — closed in 8J-B via `get_own_test_result`.

**ARCHITECTURAL GAP.** Current entitlement is the wrong proxy for historical ownership and for historical eligibility.

**OWNER DECISION.** Closed-test leaderboard visibility (§20.3). Candidate view rule (not implemented): allow if admin **OR** caller has a submitted attempt on that test **OR** currently entitled **OR** (if snapshot exists) was window-eligible. Ranking formula stays submitted-only regardless.

Optional admin overlay: eligible absentees as a **separate** list. Never merge them into `RANK()`.

### 13.2 Cumulative / class leaderboard

**CONFIRMED PRODUCT LAW for this pass:** do **not** implement a cumulative class leaderboard. Dashboard `average_rank` is not one.

See §14.

---

## 14. Cumulative leaderboard (document only)

**CONFIRMED PRODUCT LAW.** Reject any model that treats late joiners as zeros for pre-eligibility tests.

| Model | Fairness | Manipulation | Complexity | Verdict |
|---|---|---|---|---|
| Average over all published tests since launch | Punishes late joiners unless zeros — forbidden | Skip hard tests if absent beats a low sit | Low | **Reject** |
| Average over **historically eligible** tests | Fairer | Same skip issue if missed excluded from average | Needs reliable B | Candidate |
| Total points on eligible tests | Favors early joiners (more tests) | Sit everything easy | Needs B | Weak default |
| Normalized score on eligible set | Better cross-test compare | Skip issue remains | Higher | Candidate add-on |
| Minimum N attempted | Avoids ranking on one lucky test | Threshold can hurt genuine late joiners if calendar-based | Medium | Candidate |
| Cohort / entry-period boards | Visible fairness | Splits the academy | Product-heavy | Optional later |
| Separate late-joiner board | Visible fairness | Two sources of truth | High | Optional later |

**PROPOSED ARCHITECTURAL DIRECTION** (not to implement now): eligible-test-set average **plus** a minimum participation threshold.

**OWNER DECISION.** Whether to ship any cumulative board; exact threshold N; whether N is sits or eligible tests; whether cohorts exist; whether years mix (§20.5–8).

---

## 15. Year change

**CONFIRMED PRODUCT LAW** (class rules already in [permissions.md](permissions.md)):

- Approve year change: expire current enrollment, insert `active` for the new year. Does **not** change `account_status` or subscriptions.
- Previous-year **catalog** disappears unless an allow-grant names the item.
- Guessing another year’s id must return no row / RPC denial — not a UI-only hide.

**CONFIRMED PRODUCT LAW (this document — historical ownership):**

- Old-year **academic records remain attached** to the student.
- Current-year **catalog and subject bars** may show only the live year.
- **Result access** for an owned submitted attempt must not depend on current-year `can_view_test`. Owned **score / summary** is independent of current ability to **start** or **see the catalog row**. Paid **review content** still requires live entitlement + `show_review` (§11).
- Per-test **ranking membership** is unchanged (submitted set on that test). The student is not removed from January’s board because they are now Year 4.
- Dashboard lifetime summary/trend/recent must keep old-year submits.
- Resource visibility for **new** starts follows the new year (plus grants).

**CURRENT IMPLEMENTATION:** `/tests/[id]/result` loads the score/summary via `get_own_test_result` (owned `submitted` attempt). Year change and catalog hide no longer 404 an owned result. Paid review gate remains `get_attempt_review` (8J-A). **Remaining GAP:** `student_subject_performance` drops off-year subjects; `student_weak_chapters` does not.

**PROPOSED ARCHITECTURE.** Result **score** and own rank snapshot: authorize by **attempt ownership**. Review items: ownership + `show_review` + live paid entitlement when the test is paid. Catalog and Start: current year / grant. Do not mix Year 3 and Year 4 into one class cumulative board without OWNER DECISION.

---

## 16. Admin analytics

**CURRENT IMPLEMENTATION.** `admin_platform_summary.participation_pct` = share of **currently active enrollments** that have **any** submitted attempt ever. Not per-test. Late joiners with zero attempts look like non-participants. Students with many attempts inflate the join (no distinct-student guard in the current SQL).

`test_summary.registered` = count of **current** active enrollments in the test’s audience year — so after Ahmad subscribes, he inflates January Test A’s registered count.

**CONFIRMED PRODUCT LAW.**

```
participation (per test) = participants / window-eligible population
```

Participants = submitted (or started — choose one and document it). Denominator = students who were **window-eligible** for that test. Do **not** use current enrollment as a substitute where historical eligibility is required.

Platform-wide “participation” should not be shipped as a single percentage until per-test B exists; if shown, label it honestly (e.g. “share of current students who have ever submitted any test”) rather than implying per-test eligibility.

**ARCHITECTURAL GAP.** Both admin denominators. Fix after B exists (or an explicit weaker labelled metric). Priority: high for fairness reporting, not a blocker for locking Start buttons.

---

## 17. Final state machines (do not collapse)

These machines interact. None is a synonym for another.

### 17.1 Account

`active` → (`restricted` \| `suspended` \| `deactivated` \| `revoked`) → restore to `active`.

Non-active: no LMS. Rows kept. Exam: explicit disposition.

### 17.2 Subscription

No row / expired / deactivated → **free current access**.

`active` and `now() < ends_at + grace_days` → **live paid overlay** (`all_entitled` or `grants_only`).

After `ends_at` but before `grace_until`: still live for paid resources. Cron sets `expired` after grace; helpers use server time, not the cron UPDATE.

Renewal extends or inserts per [database.md](database.md). Never a second `active` row.

### 17.3 Resource (current use)

Catalog? → Restricted? → Granted? → Entitlement/plan/live sub? → (tests: window open?) → use or lock.

### 17.4 Test (lifecycle)

`draft` → `published` → `closed` → `archived`; or `invalidated`. Live window is derived. Unchanged ([test-rules.md](test-rules.md)).

### 17.5 Attempt

`(none)` → `in_progress` → `submitted` (student \| auto \| admin) or `invalidated`. No absence state. Unchanged ([exam-state-machine.md](exam-state-machine.md)).

### 17.6 Dashboard (derived)

Inputs: account (shell or `/pending`), catalog list, current entitlement (Start vs lock), owned attempts (scores), optional eligibility labels.

Subscription expiry flips Start → lock. It does not flip history cards off. Year change may flip catalog; it must not erase owned history.

---

## 18. Data invariants

**CONFIRMED PRODUCT LAW.**

1. Subscription expiry never deletes academic history.
2. Subscription renewal never duplicates academic history.
3. Current subscription never rewrites historical eligibility.
4. Not eligible never becomes a score of zero.
5. Missed is not automatically a zero.
6. Submitted attempts are the source of score analytics.
7. Current resource access is evaluated at read/start time (not cached in the JWT).
8. Historical ownership of a result is independent from current ability to start the test.
9. Navigation visibility does not equal entitlement.
10. UI blur / lock / opacity never substitutes for server-side authorization.
11. Fake attempts are never created to represent absence.
12. Leaderboard **ranking** uses a clearly defined historical population (submitted attempts), not current subscription state.
13. Deny restrictions win over grants and subscription; account block wins over all resource access.
14. Catalog visibility (`can_view_*`) is not content entitlement (`can_access_*`) and is not window eligibility.
15. Free entitlement survives subscribe, expire, and renew.
16. `paid_access_mode = all_entitled` must not require per-item grants for subscribers.
17. Grants never override a blocked account.
18. Closed test windows do not reopen because a grant or subscription appears later, unless an explicit admin late-sit action exists (OWNER DECISION).
19. Auto-submit produces a real submitted attempt; a blank paper zero is not an ineligible zero.
20. `recompute_test` (voids) may change scores/ranks of submitted attempts; subscription transitions must not.
21. Secrets (Drive URL, signed object URL, `correct_key`, explanation, other students’ results beyond approved leaderboard view) never ride on catalog SELECT or blurred UI.
22. One live class enrollment; one live subscription; one live/submitted attempt per test (invalidated history preserved).
23. After paid expiry: **score / % / result summary KEEP**; **review content LOCK** (stems, selected keys, correct keys, explanations). Authorization is server-side. Renewal restores review only.
24. `close_test_now` stops admission **and** clamps live `in_progress` `expires_at` to `least(expires_at, now())`. Existing **30s / 60s** clocks apply to the clamped instant. No new grace. No force-submit. Resume-while-closed is same-device only.
25. Latest MCQ selection wins via monotonic `save_seq`. Unanswered questions contribute zero on auto-submit (blank, not “wrong”).
26. **NOT ELIGIBLE**, **MISSED**, **IN_PROGRESS**, and **SUBMITTED** are four distinct states and must not be collapsed.

---

## 19. Current code / schema gap register

Priority: **P0** correctness/fairness before teaching the UI new labels; **P1** 8J student UX; **P2** later / optional. Implementation impact is documentary — **do not implement in this pass**.

| Current component | Current behavior | Expected behavior | Gap | Priority | Implementation impact | Owner decision? |
|---|---|---|---|---|---|---|
| `test_attempts` | Row only after `start_attempt` | Same; no absence rows | None for storage | — | Do not add fake rows | No |
| Window eligibility (B) | Not stored; cannot be reconstructed safely | Distinct from current `can_access_test` | No snapshot / no documented derivation policy | P0 for completion, admin participation, cumulative | New table **or** accept derivation limits | **Yes** (§20.1) |
| Tests UI “Not attempted” | All closed unattempted catalog tests | Missed vs Not eligible | Copy/logic conflation | P1 | UI + needs B or conservative “Not eligible if never entitled now and window closed” heuristic | Partial |
| Dashboard cards | `tests_taken` / avg / best / mean rank | Attempted, Eligible, Missed, Not eligible + lifetime avg | Missing concepts | P1 | UI; Eligible needs B | Completion denom **yes** |
| `student_test_summary` / `recent` / `trend` | Lifetime submitted; no sub join | Keep as lifetime score analytics | Keep | — | None for law 5–6 | Period metrics **yes** |
| `student_subject_performance` | Current-year subjects only | Lifetime scores remain; current-year view may stay | Off-year submits vanish from subject bars | P1 | RPC overlay or dual grain | Align year vs lifetime **yes** (related) |
| `student_weak_chapters` | Lifetime practice | Decide current-year vs lifetime | Inconsistent with subject bars | P2 | Filter or label | Yes (grain) |
| `test_leaderboard` view | `can_access_test` | Ranking submitted-only; view per §13 | Current entitlement proxy | P0 | RPC where-clause | **Yes** (§20.3) |
| `rank_test` | Submitted only | Submitted only; no zeros | Ranking law already correct | — | None | No |
| Result page `tests` SELECT | Owned attempt via `get_own_test_result` → **score/summary**; review still gated | Same | Closed in 8J-B | — | Keep | No (law in §15) |
| `get_attempt_review` | Owner + `show_review` + live paid entitlement for items | Same | Closed in 8J-A | — | Keep | No |
| `attempt_answers` RLS | Admin SELECT only | Student **none** (RPC only) | Closed in 8J-A | — | Keep | No |
| `close_test_now` | Clamps live `in_progress` `expires_at` to `least(expires_at, closes_at)` | Same | Closed in 8J-C | — | Keep | No (settled) |
| `start_attempt` resume | Skips entitlement, published, and window; then `finalize_if_expired`; same device | Same | Closed in 8J-C | — | Keep | No |
| `start_attempt` **new** start window | Closed → `test_window_closed` even with grant | Same unless late-sit action | No backfill sit | P2 | New RPC if approved | **Yes** (§20.4) |
| `test_summary.registered` | Current audience enrollments | Window-eligible population | Inflates after late subscribe | P1 | Change after B | No (law in §16) |
| `admin_platform_summary.participation_pct` | Current enrollments × any attempt ever | Per-test: participants / window-eligible; or honest label | Wrong if presented as test participation | P1 | SQL rewrite + label | Metric definition details |
| Student nav | Identical for free/paid | May differ; not entitlement | No Free Resources tab | P1 | UI only | Nav chrome **yes** (product) |
| Free Resources library | Folders/tests/practice separate; backfill free | Admin-defined free set, reorder, publish | No mixed-type library / folder publish flag | P1 | 8J UX + maybe publish flag **later** | Types not hardcoded |
| Group grants | None | Optional exception overlay | No group target | P2 | Schema if approved | **Yes** |
| Cumulative class board | Does not exist (`average_rank` is personal mean) | Do not ship in this pass | None if we don’t ship | — | Do not add | **Yes** if ever ship |
| Eligibility on dashboard after subscribe | Ahmad’s A/B/C unlabeled zeros (good) but “Not attempted” (bad) | Not eligible | Label gap only for averages | P1 | UI | No |
| JWT / session | Entitlement not in JWT | Time-of-read | None | — | Keep | No |
| Account vs resource restricted | Separate | Separate | None | — | Keep | Restricted-during-window **yes** (§20.7) |
| `paid_access_mode` / grace | Implemented pre-8J | Keep | None | — | Keep | No |
| Materials `drive_url` | Hidden; `open_material` | Same | None | — | Keep | No |
| Blur / preview paid analytics | Lock notice only; no classmate data in lock card | Previews must not leak | No paid-analytics blur layer yet | P1 | UX; still RPC-gated | What to preview |
| `question_stats` / `test_stats` tables | Documented; summaries often live RPC | Unchanged by subscription | Not used as eligibility | — | Do not overload | No |

---

## 20. Owner decisions only

Do not put implementation preferences here. These are unresolved **product** choices. Existing pending items in [permissions.md](permissions.md) (legacy enrollment `suspended`/`revoked` mapping, curriculum CRUD permission code, R2 bucket/retention, application `cancelled` UI) remain; they are not repeated.

1. **Eligibility snapshot vs historical derivation.** Store window-eligibility (e.g. at close or start check), or live with partial derivation and conservative “not eligible” copy?
2. **Eligible-but-missed completion policy.** Exclude missed from completion denominator, count as incomplete, score as zero, or admin toggle (toggle must never apply to not-eligible)?
3. **Closed-test leaderboard visibility.** Who may **view** the ranked list: current entitlement, owned attempt, was-eligible, any catalog viewer, admin-only?
4. **Admin reopening / late sit.** Today the engine refuses closed windows. New explicit action, or never?
5. **Future cumulative / class leaderboard.** Ship at all? If yes, eligible-set average is the only family that does not zero late joiners.
6. **Minimum participation threshold** (only if 5 is yes). What is N, and is it sits or eligible tests?
7. **Restricted-during-window classification.** Resource-denied (or account-blocked) for part/all of a window: not eligible vs missed?
8. **Cross-year cumulative ranking.** Mix years after year change, or separate year boards?
9. **Subscription-period analytics.** Additional E metrics at all, or lifetime-only on the student dashboard forever?

**Settled (removed from this list):** post-expiry paid review — score KEEP, review content LOCK, server-side (`get_attempt_review` + no student `attempt_answers` SELECT). Classmate **leaderboard view** remains item 3 and is a different question.

Related UX choices (not access law): whether subscribed students hide a Free Resources nav tab; whether trend charts mark free vs paid points; whether group grants ship; what a “controlled paid preview” may show besides a lock + CTA.

---

## 8J implementation note

**8J-0 (this pass)** writes the frozen laws into the four canonical docs only. No application code, SQL migrations, schema edits, or deploys.

**8J-A (done in code):** `get_attempt_review` paid gate + deny student `attempt_answers` SELECT.

**8J-B (done in code):** `get_own_test_result` + result page authorize by owned submitted attempt, not `can_view_test`.

**8J-C (done in code):** `close_test_now` clamps live `in_progress` `expires_at`; resume-while-closed same-device; close → expiry → lazy-finalize → own result.

**8J-D / 8J-E (done in code):** live timer accepts earlier server `expires_at` (never extends from stale local state); local draft / autosave / interrupt / resume / `save_seq` behavior per exam-engine validation.

**8J-F (done in code):** student test-list state classification (`getStudentTestListState`) — In progress / Result / Available / Locked / Upcoming / Missed / Not eligible. Closed+no-attempt uses the documented overlap heuristic (free entitlement, subscription window overlap, test-grant overlap); defaults to Not eligible. No eligibility snapshot table.

**8J-G (done in code):** student Dashboard / Performance **presentation** only — lifetime Attempted labels, catalog Missed vs Not eligible (reuses 8J-F), free/expired access banners + paid-feature lock CTA with no protected payload, Performance grain captions (lifetime / current-year / practice-only). Does **not** rewrite analytics RPCs, eligibility schema, or subscription architecture. Do not start **8J-H** in the same pass.

### Staging validation (2026-09-16)

**STAGING VALIDATED — 8J COMPLETE.** Evidence (E2E 18/18, pgTAP including `020` / `162` / `163` and 8J-specific suites, frozen contract checks, production untouched) is recorded in [validation/8j-staging-signoff-20260916.md](validation/8j-staging-signoff-20260916.md). That sign-off does **not** authorize production deployment.

Do not invent alternative attempt states, grace periods, ranking formulas, or “late subscriber gets zeros.” Eligibility snapshot and classmate leaderboard **view** stay deferred (OWNER DECISION 1 and 3).

Settled access/exam law that 8J must not regress: catalog vs content, deny-wins, `all_entitled` vs `grants_only`, subscription grace 0/1/2, year isolation, free-without-subscription, menus visible with locks, lifetime submitted analytics, submitted-only ranking, immutable attempts, 30s transport / 60s sweep, `expires_at = least(started_at + duration, closes_at)`, close-now clamp, resume-while-closed same-device, post-expiry score KEEP / review LOCK.
