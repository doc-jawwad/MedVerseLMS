# Staging RC validation — integration/medverse-final

Date: 2026-09-20 (Asia/Karachi)
Branch: `integration/medverse-final`
RC commit: `8721ac6` (`8721ac629d1a162cd147907bdf875749b7b5963e`)
Contrast source: `wip/contrast-brand-polish` @ `dc8f815` (cherry-picked; conflicts resolved keeping feature code)
Data Spine wiring: `94e0c28`
Contrast integration: `685a5b6`

## Scope

Feature lanes + Data Spine app wiring + contrast polish.
Staging-only. Production untouched. No new migrations in this RC
(staging already at `20260919254000`).

## Local gates (pre-deploy)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS |
| `npm run test:unit` | PASS (375/375) |
| `npm run test:db` | BLOCKED — Docker Desktop / local Supabase unavailable on agent host. Not recorded as PASS. |

## Staging pre-deploy

| Check | Result |
|------|--------|
| Target DB | `medverse_staging` |
| Staging migration head | `20260919254000` |
| Production migration head | `20260919160000` (unchanged) |
| Pre-RC backup | `/opt/medverse-staging/backups/pre-rc-20260920T030703Z.dump` (565701 bytes; `pg_restore -l` TOC readable) |

## Staging deploy

| Check | Result |
|------|--------|
| Release path | `/opt/medverse-staging/releases/20260920T030800Z-8721ac6-rc` |
| `RELEASE_COMMIT` | `8721ac629d1a162cd147907bdf875749b7b5963e` |
| Production current | `/opt/medverse/releases/20260919T044404Z-ecda0fa-check5-low-fixes` (unchanged) |
| Health loopback `:3010` | `{"ok":true}` |
| Health public | `https://staging.medversepk.com/api/health` → `{"ok":true}` |
| New migrations applied | None (already at Data Spine head) |
| PostgREST | Restarted staging unit (schema cache reload) |
| Spine RPCs present | All 17 expected names present in `pg_proc` |

## Staging E2E

| Suite | Result |
|------|--------|
| staging-smoke, own-test-result, pwa, admin-class | PASS |
| free-student-nav | **FAIL** (1) — `/performance` expects `/subscription required/i`; page uses ResourceLockNotice (“subscription **is** required”) |
| exam-engine + integrated-8j-lifecycle | **PASS 12/12** |

## Classification

**NOT READY** for production release.

Blockers: free-student navigation E2E failure; local Data Spine pgTAP not executed on this host.
