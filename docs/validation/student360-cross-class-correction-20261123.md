# Student 360 cross-class read correction — review candidate

Tracker: [Issue #11](https://github.com/doc-jawwad/MedVerseLMS/issues/11). Based on DB PR #18 `64a2661`; separate feature branch `codex/student360-class-read-scope`. **Not deployed or installed.**

## Confirmed defect on staging

MANUAL browser + authenticated PostgREST observations on app `e14b718`, migration head `20261123150000`: a synthetic limited administrator assigned only Year 1 could open a current Year-3 synthetic student. `view_students` displayed email, status, class and analytics through the unscoped `admin_student_profile` definer RPC. `restrict_students` displayed name/status and Manage. `view_analytics` displayed cross-class aggregates. Finance (`manage_subscriptions`, alone and with `review_subscription_applications`) displayed the Year-3 enrollment and misleading empty subscription summary; direct profile SELECT returned email, college, last login and avatar key. Subscription/application SELECT itself remained class-scoped. The target's expired Year-1 enrollment must not authorize access to its current Year-3 identity.

Contact nuance: same-class Auth-metadata contact fallback was browser-tested with a nonempty synthetic marker; the marker was hidden from restricted/analytics/finance UI roles. The selected Year-3 profile has no surviving Cloud Auth user, so cross-class Auth-contact rendering is **UNVERIFIED**, not claimed. Cross-class email and enrollment disclosure are already sufficient to establish the security failure.

## Focused correction

Migration `20261123170000_student360_admin_class_read_scope.sql` intersects existing SELECT policies on profiles, enrollments, test attempts and practice answers with assigned-class scope and adds an explicit gate before the definer profile RPC reads anything. It retains existing permission checks, Main Admin access, own-student reads and existing function grants. Current active enrollment takes priority over historical enrollment; otherwise the latest enrollment supplies the class; no enrollment fails closed for limited admins. The helper also requires an existing student/attempt read permission. Admin-directory rows require existing `manage_admins`. No permission or RLS widening.

AUTOMATED: `252_student360_admin_class_read_scope.sql` verifies positive/negative profile, enrollment, RPC, attempt and practice reads; finance alone; no-permission denial; Main Admin and student-own preservation; old enrollment bypass; anon denial. Candidate DDL and fixtures are executed in one **BEGIN/ROLLBACK** transaction against `medverse_staging`: no migration ledger entry, persistent schema change, service restart or app deployment. Exact-SHA result is attached to the correction PR.

## Limits and next gate

- This is a read-scope correction, not a complete audit of every security-definer mutation or reporting RPC.
- **Separate unresolved privacy blocker:** same-class `profiles` SELECT remains column-wide for existing profile-reading roles, including finance/restricted management. UI hiding does not enforce the plan's `view_students`-only private biodata boundary. A narrow server/database projection for permitted name/status reads and restricted access to private columns needs an approved plan delta and integration tests; do not loosen RLS to solve it.
- App branch test `250_student_360_role_reads.sql` currently codifies the old cross-class profile/enrollment visibility in assertion 12. Integration with this correction must strengthen that assertion to zero rows. Do not run its old expected leakage against the corrected schema or label that mismatch a regression to preserve.
- No full migration replay or full pgTAP rerun was performed. Existing accepted baseline has 17 classified failures. No CI_PASS exists. Browser acceptance of this correction remains NOT_RUN because the deployed staging schema was preserved.
- Rollback, only under separately approved deployment: drop the four newly named restrictive policies, restore the previous `admin_student_profile` definition from the reviewed parent, then drop the helper. This reopens the confirmed defect and is not authorized here.

Production release remains **BLOCKED**, including after this focused correction, until the private-column exposure and CI gate are resolved and the corrected candidate has targeted staging acceptance.
