# 8J staging sign-off — 2026-09-16

**Status: STAGING VALIDATED — 8J COMPLETE**

This record documents staging validation of phase **8J**. It does **not** authorize production deployment, production migration apply, production release cutover, or production env/service changes.

## Environments compared (at sign-off)

| | Staging (validated) | Production (untouched) |
|---|---|---|
| App origin | `https://staging.medversepk.com` | Production LMS (not exercised in this pass) |
| App release | `20260916T055422Z-lazy-finalize` | `/opt/medverse/releases/20260915T022632Z-duplicate-registration-fix` |
| Database | `medverse_staging` | Production VPS / Cloud prod (not modified) |
| Migration head | `20260916123000` | `20260914000002` |
| Auth | Cloud staging `vygtwrsshcyfahfzurgq` | Production Auth project (not used) |

Production safety for this phase: **PASS** — no production SQL, no production deployment, production migration head unchanged, production services untouched.

## 8J scope and completion

| Item | Result |
|------|--------|
| **8J-A** Paid Review Lock | **PASS** |
| **8J-B** Own Test Result | **PASS** |
| **8J-C** Close Test Now | **PASS** |
| **8J-D** Timer | **PASS** |
| **8J-E** Local Draft / Autosave | **PASS** |
| **8J-F** Test-State Classification | **PASS** |
| **8J-G** Dashboard Presentation | **PASS** |
| Browser / Playwright E2E | **18/18 PASS** against `https://staging.medversepk.com` |
| Data integrity | **PASS** |

## Frozen product laws validated (no inventing alternatives)

Validated against the canonical docs (not against ad-hoc expectations):

- Already-submitted-before-call → Postgres `P0001` `already_submitted`
- Lazy-finalized-during-call → committed payload `{ already_submitted: true, ... }` (no duplicate attempt, no rescore)
- One-device enforcement
- `save_seq` monotonicity
- Historical own result survives subscription expiry and year change
- Paid review locks after expiry and restores after renewal (score KEEP / review LOCK)
- `close_test_now` clamps only live `in_progress` attempts
- Close → expiry → lazy-finalize → `/result` (own historical result) works
- Attempt timing / close-now / resume laws in [exam-state-machine.md](../exam-state-machine.md)
- Access / eligibility / dashboard laws in [access-eligibility-analytics.md](../access-eligibility-analytics.md)
- Scoring / ranking constraints in [scoring-rules.md](../scoring-rules.md)
- Test lifecycle / kill-switch constraints in [test-rules.md](../test-rules.md)

## Database (pgTAP) evidence recorded at sign-off

| Suite / area | Result |
|--------------|--------|
| `020_exam_and_scoring` | **23/23 PASS** |
| `162_close_test_now` | **48/48 PASS** |
| `163_lazy_finalize_own_result` | **10/10 PASS** |
| All 8J-specific suites | **PASS** |
| Foundational / security / entitlement / subscription / year-isolation suites | **PASS** |

Note: an earlier incomplete run reporting **534/535** was resolved by the `start_attempt` contract fix (migration head through `20260916123000` on staging). That prior count is historical context only; it is not the final sign-off figure.

## Browser / E2E evidence

- Command path: `npm run test:e2e:staging` (forces `E2E_TARGET=staging`; does not load production-oriented `.env.local`)
- Suites exercised for final pass include: `staging-smoke`, `exam-engine`, `close-test-now`, `own-test-result`, `integrated-8j-lifecycle`
- Aggregate: **18/18 PASS** on `https://staging.medversepk.com`

## Known environmental issues (not blockers)

These were observed during staging work and are **not** treated as 8J product blockers:

1. **Realtime WebSocket instability** on the staging origin (session watch / Realtime channels can flap). Application correctness for 8J was validated via RPC/HTTP/browser flows; Realtime is not required for the frozen exam laws above.
2. **Occasional Cloudflare behavior for non-browser requests** (e.g. scripted/curl-style calls from some networks may see challenge/403 where a real browser session succeeds). Browser and staging-safe Playwright paths were the acceptance path for UI.
3. **pgTAP / local runner notes** — prefer local Docker for schema suites; Cloud production/staging URLs remain refused by the runner unless an explicit allow env is set. Staging VPS DB validation used approved staging-only procedures. Windows unit runs may still hit unrelated CRLF shebang issues on bash backup scripts; that is host tooling, not an 8J law failure.

## Explicit non-authorization

**STAGING VALIDATED — 8J COMPLETE** means staging product behavior and tests for 8J are accepted.

It does **not**:

- authorize production migration apply past `20260914000002`
- authorize promoting `20260916T055422Z-lazy-finalize` (or any staging build) to production
- authorize pointing production traffic, secrets, or cron at staging
- close remaining **OWNER DECISION** items in [access-eligibility-analytics.md](../access-eligibility-analytics.md) (e.g. eligibility snapshot, classmate leaderboard view)

Production cutover remains a separate, explicit approval.

## Related canonical docs

- [access-eligibility-analytics.md](../access-eligibility-analytics.md) — 8J access / eligibility / dashboard source of truth
- [exam-state-machine.md](../exam-state-machine.md) — attempt lifecycle
- [deployment.md](../deployment.md) — environments and ops constraints
- [validation/README.md](README.md) — archive index
