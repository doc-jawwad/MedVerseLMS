# Remaining release verification — PR #17 / PR #18

Date: 2026-11-23 (Asia/Karachi). Tracker: [Issue #11](https://github.com/doc-jawwad/MedVerseLMS/issues/11). Master SaaS Development Rulebook v3.3. **Production release BLOCKED.**

## Candidate and preserved evidence

- Browser target: existing `https://staging.medversepk.com`, deployed app `e14b718555c6de88b9b82fa12ecc28eca2c4b0a8`, release `20261123T152737Z-e14b718-pr17`; database `medverse_staging`, migration head `20261123150000`.
- Original DB PR #18 head `64a2661ce860a4b5ef292f6e06fb48bfc724c140`; migration code comes from `9784833`, subsequent original-head changes are documentation only.
- Reused S1 access 20/20, browser 6/6, unit 37/37, clean TypeScript and classified 17 existing pgTAP failures. No rebuild, redeploy, migration reapplication or repeat of those passing suites.
- New evidence: local Playwright/Chromium against the deployed staging app, synthetic users only. These browser observations are **MANUAL** under the QA skill's real-browser category (script-driven browser against explicitly authorized staging, not a local dev server). Sanitized observations: [results.json](evidence/release-remaining-20261123/results.json). Concrete page snapshots/screenshots remain in the task worktree's ignored `test-results/release-missing/` directory; credentials are excluded from committed evidence.

## Student 360 acceptance

| Scenario | Browser result |
|---|---|
| Year-1 `view_students`, same-class student | MANUAL PASS: biodata/email, class, analytics, history. Nonempty synthetic Auth contact marker rendered in a separate meaningful fallback check. |
| `restrict_students`, same class | MANUAL PASS: name/status and Manage; no biodata, email or contact marker. No account mutation performed. |
| `view_analytics`, same class | MANUAL PASS: anonymous Student header, unknown status, analytics/tests/practice; no name/email/contact or finance. Empty grants placeholder carries no data. |
| Finance (`manage_subscriptions` + review), same class | MANUAL PASS: class, subscriptions and application/payment history; no biodata/contact. |
| `manage_subscriptions` alone | MANUAL PASS: class/subscriptions only; no application history or biodata/contact. |
| `manage_payment_settings` only; admin with no permissions | MANUAL PASS: explicit page denial for both same/cross-class targets; direct profile/enrollment/finance queries returned zero rows. |
| Unauthorized same-class UI contact | MANUAL PASS: nonempty contact marker absent for restricted, analytics and subscription-only roles; marker and role restored afterward. |
| Cross-class student reads | **MANUAL FAIL / SECURITY BLOCKER**: assigned Year 1 could open current Year-3 Student 360. `view_students` displayed cross-class email, class and metrics; restricted management displayed name/status/Manage; analytics displayed aggregates; finance displayed Year-3 enrollment. |
| Direct authenticated PostgREST cross-class reads | **MANUAL FAIL / SECURITY BLOCKER**: `view_students`, restricted management, finance and subscription-only roles retrieved private profile columns (email, college, last login, avatar key). `view_students` and subscription roles retrieved enrollment history/current enrollment. Analytics profile/enrollment reads returned zero, but analytics aggregates were visible through attempts/practice paths. |
| Cross-class subscriptions/applications | MANUAL PASS: empty under finance/subscription roles. This does not compensate for the identity/enrollment leak. |

Scope: profile RLS uses permission-only `can_admin_select_profiles()`, enrollment RLS uses permission-only `can_admin_select_enrollments()`. `admin_student_profile` checks `view_students` but no target class. Attempts/practice SELECT also lacks target-class scope. Existing expired Year-1 enrollment on the Year-3 target does not justify current cross-class access.

**Residual private-column exposure:** UI section hiding is not a database boundary. Existing profile-reading roles can query private columns directly even within an assigned class. This requires a narrow database/server projection for permitted name/status data plus private-column protection; no broad RLS grant is an acceptable fix. This remains blocked after the focused class-scope patch. Cross-class Auth-phone rendering was not proven: the selected historical synthetic Year-3 profile has no surviving Cloud Auth user. Do not claim a phone exploit from the confirmed email leak.

## Ordinary Free-folder and PDF acceptance

MANUAL PASS: existing synthetic ordinary Notes folder `Free Notes Sample` was changed **Free → Paid → Free through admin UI**. The free student lost its PDF link while Paid and regained it on route re-entry after Free, without manual reload. The admin selector reflected the saved value. Original Free state was restored.

MANUAL PASS: clicked `Sample Free PDF`, observed a rendered canvas (1271 × 1645) and text layer, with study-content HTTP 200/206 responses. This proves actual PDF opening, not merely the resource index.

MANUAL PASS: selected actual PDF text, saved a new highlight, reopened and saw the same highlight; removed it, observed success/removal, reopened and confirmed the same highlight id remained absent. Only the task-created highlight was deleted.

## Student grouping and Upcoming ordering

MANUAL PASS: existing group headings and placement order rendered on `/tests`; existing closed grouped test was in Previous. Five task-owned future synthetic tests plus a wrong-year negative fixture verified: group sort order, manual placement order overriding date inside a group, **nearest-first** ungrouped Upcoming order, all five in Upcoming, wrong-year title absent. Task-owned future tests were returned to draft through the existing RPC and deleted along with their groups; no existing test or attempt was edited.

## CI readiness

**No configured release CI found; CI_PASS unavailable.** At exact original heads GitHub returned only completed **SKIPPED Supabase Preview**, zero commit statuses and no Actions jobs. Repository Actions workflows/runs both total zero; repository webhooks and rulesets lists empty; release-lineage tree has no Actions, CircleCI or other pipeline configuration. No CircleCI connector, local CircleCI CLI config or CircleCI token was available. App-installation enumeration was permission-denied (403/401); therefore an undisclosed external dashboard cannot be categorically ruled out. No pipeline was triggered and no credits were consumed.

Smallest recommended arrangement: a manually dispatched GitHub Actions release-check workflow with read-only repository permissions, one concurrent job per ref, strict timeout and no deploy/secrets. Run exact-SHA type/lint + focused unit checks; run relevant R2 pgTAP positive/negative suites in an isolated PostgreSQL job. Reuse accepted build/staging artifacts, and keep the 17 baseline failures explicitly classified rather than ignoring failures. Confirm available included Actions minutes before enabling; otherwise run the same checks on existing approved resources and label them LOCAL_PASS/AUTOMATED, never CI_PASS. This recommendation is **not installed** and does not silently waive the existing CI gate.

## Focused correction and remaining release gate

Separate branch `codex/student360-class-read-scope`, commit `7be2ed16463b416dedcf1ddfc42ca3e4abf979db`, prepares restrictive student-class SELECT policies and an explicit Student 360 RPC check. **AUTOMATED 33/33 pgTAP PASS at that exact SHA**, run with candidate DDL and fixtures in BEGIN/ROLLBACK on staging; no persistent schema/ledger change. See its correction PR and `student360-cross-class-correction-20261123.md` for boundaries and integration requirements. Browser verification of the corrected schema remains NOT_RUN because staging was preserved.

A single founder production-release approval is **not ready**: resolve class-scope integration and private-column exposure, accept/establish the CI arrangement, then verify the corrected exact candidate on staging. Preserve existing S1 evidence. No production deployment, production DB write, protected merge or service restart was performed.

## Cleanup and preservation

The old reusable limited-admin credential was invalid; no password was reset. Recorded S1 authority was used to create one clearly synthetic, bounded role fixture. All role assignments and synthetic contact metadata were restored, the new account is removed at task cleanup, and ordinary folder state is Free. End check: original staging release/migration head unchanged, correction helper absent, task-owned group/test count zero. Unrelated worktree changes were left intact.
