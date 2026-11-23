# DB PR #18 remaining release gate

2026-11-23 — Tracker [Issue #11](https://github.com/doc-jawwad/MedVerseLMS/issues/11).

This addendum preserves the original [S1 sign-off](staging-s1-pr17-pr18-20261123.md). No migration was reapplied, no app rebuilt or redeployed, and no production action occurred. Staging remains app `e14b718` / `medverse_staging` migration `20261123150000`. PR #18 migration contents are unchanged from original head `64a2661`.

## Browser acceptance

The missing same-class Student 360 role/denial/contact scenarios, ordinary Notes folder Free→Paid→Free, actual PDF rendering, highlight delete/reopen, test grouping/manual ordering and nearest-first ungrouped Upcoming checks passed in a real staging browser with synthetic fixtures. [Detailed evidence and sanitized observations](https://github.com/doc-jawwad/MedVerseLMS/blob/73efb133dde283816870137395f9ecf35c2c5a1c/docs/validation/release-remaining-pr17-pr18-20261123.md).

**Cross-class acceptance FAILED:** permission-only profile/enrollment/attempt/practice read paths and the Student 360 definer RPC permit unrelated class reads. Finance subscriptions/applications remain class-scoped; finance profile/enrollment reads do not. Private profile columns are directly selectable despite UI hiding, including the same-class case as implied by the unchanged column-wide SELECT grant/policy.

## Focused correction

[Draft PR #19](https://github.com/doc-jawwad/MedVerseLMS/pull/19), stacked on PR #18, commit `7be2ed16463b416dedcf1ddfc42ca3e4abf979db`: restrictive class-read policies plus explicit RPC gate. **AUTOMATED 33/33 pgTAP PASS at exact SHA**, in a staging BEGIN/ROLLBACK transaction; no persistent schema or ledger change. Not deployed. Same-class private-column protection remains a separate unresolved plan delta; this patch does not claim to solve it. App test 250 assertion 12 needs a stricter zero-row expectation on integration.

## CI readiness

No configured release CI was found: only skipped Supabase Preview at the original exact heads, zero Actions workflows/runs, no webhooks/rulesets, no pipeline config on release lineage, no available CircleCI connector/config/token. Installation enumeration was permission-denied, so undisclosed external setup remains UNKNOWN. No CI run/credits used and **no CI_PASS**.

Recommend the smallest manual-dispatch, read-only, timeout/concurrency-limited release-check workflow for targeted types/lint/unit and isolated PostgreSQL R2 checks, using included minutes only after quota is known. Preserve accepted build/staging evidence and do not hide the 17 classified baseline failures. Recommendation only; no CI configuration installed and no implicit CI-gate waiver.

## Release decision

PRs #17/#18 stay draft and **are not ready for a single founder production-release approval**. Resolve cross-class integration, private-column privacy and CI readiness, then staging-verify the corrected exact candidate. Existing S1 approval is not production authorization.
