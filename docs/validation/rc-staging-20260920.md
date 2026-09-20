# Staging RC validation — integration/medverse-final

Date: 2026-09-20 (Asia/Karachi)
Branch: `integration/medverse-final`
Contrast source: `wip/contrast-brand-polish` @ `dc8f815` (cherry-picked with conflict resolution)
Data Spine wiring: `94e0c28`
Contrast + feature integration: `685a5b6`

## Scope

Feature lanes + Data Spine app wiring + contrast polish.
Staging-only. Production untouched. No new migrations in this RC
(staging already at `20260919254000`).

## Local gates (pre-deploy)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS |
| `npm run test:unit` | PASS (375/375) |
| `npm run test:db` | BLOCKED — Docker Desktop / local Supabase not available on agent host (daemon pipe missing). Not skipped as PASS. |

## Staging pre-deploy

| Check | Result |
|------|--------|
| Target DB | `medverse_staging` |
| Staging migration head | `20260919254000` |
| Production migration head (untouched) | `20260919160000` |
| Pre-RC backup | `/opt/medverse-staging/backups/pre-rc-20260920T030703Z.dump` (~565701 bytes, `pg_restore -l` TOC readable) |

## Classification

Filled after staging runtime validation.
