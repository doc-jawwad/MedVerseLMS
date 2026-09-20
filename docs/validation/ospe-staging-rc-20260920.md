# Staging RC validation — OSPE Practice final integration

Date: 2026-09-20 (Asia/Karachi)  
Branch: `integration/medverse-final`  
App (staging release): `0f45690` (`0f456902516a1a14a3471caad32a4ee4bb7ccac1`)  
RC commit: this commit on `integration/medverse-final` (`git log -1 --oneline` after OSPE grants RC).  
Staging DB head: `20260920070000`  
Production app: `8721ac6` (unchanged)  
Production DB: `20260919254000` (unchanged)

## Ancestry (no duplicates)

| Commit | Present |
|--------|---------|
| `0f45690` OSPE UI | yes |
| `79188c3` OSPE Data Spine | yes |
| `94e0c28` Data Spine app wiring | yes |
| `cbf4ae8` PDF paid-folder fix | yes |
| `9b42354` Theme / Admin Students | yes |

## Scope

OSPE Practice schema + UI + staging migrate/deploy + grants repair. Staging only. **Production not deployed.**

## Local gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **PASS** (AUTOMATED) |
| `npm run test:unit` | **PASS** 385/385 (AUTOMATED) |
| `npm run test:db` | **PASS** including `200_ospe_practice`, `190_data_spine`, exam suites (AUTOMATED) |

## Staging backup + migration

| Check | Result |
|------|--------|
| Target DB | `medverse_staging` only |
| Pre-OSPE backup | `/opt/medverse-staging/backups/` (prior `pre-ospe-migration-*`) |
| Pre-grants backup | `/opt/medverse-staging/backups/pre-ospe-grants-20260920T063155Z.dump` (608K; `pg_restore -l` TOC readable) |
| Applied | `20260920053838_ospe_practice_stations.sql` then `20260920070000_ospe_stations_authenticated_grants.sql` |
| Mechanism | `psql` as postgres + `schema_migrations` insert (normal apply path; no `session_replication_role`, no disabled triggers) |
| Head | `20260920070000` |
| `ospe_stations` + RPCs | present; RLS on |
| PostgREST | `NOTIFY pgrst, 'reload schema'` + staging SIGUSR1 |
| Prod DB head | `20260919254000` unchanged |

### Grants repair note

First OSPE migrate created the table with column-level SELECT only. Host `ALTER DEFAULT PRIVILEGES` for tables was missing on staging, so `authenticated` lacked INSERT/UPDATE/DELETE → `[createOspeStation.insert] permission denied`. Fix migration restores DML grants + default privileges. **AUTOMATED** re-verified via OSPE E2E create/publish.

## Staging app deploy

| Check | Result |
|------|--------|
| Release | `/opt/medverse-staging/releases/20260920T061206Z-0f45690-ospe-rc` |
| Health | `https://staging.medversepk.com/api/health` → 200 `{"ok":true}` |
| Prod current | `/opt/medverse/releases/20260920T042607Z-8721ac6-rc` unchanged |
| Staging env | `MEDVERSE_ENV` staging; Auth/origin staging (no production Auth URL in staging unit env) |

## Staging E2E (AUTOMATED)

| Suite | Result |
|------|--------|
| `ospe-practice-e2e` (admin create → publish → student reveal; answer absent pre-reveal) | **PASS** |
| `pdf-paid-folder-e2e` (paid folder create → PDF upload → API gate; no R2 URL leak) | **PASS** |
| `ospe-practice` layout 320 / 375 / 1280 | **PASS** |
| `exam-engine` (start/save/refresh/skip/submit/device/offline) | **PASS** 10/10 |
| `staging-smoke`, `pwa`, `admin-rbac-staging`, `admin-class-context`, `free-student-nav` | **PASS** |

## Security (AUTOMATED + STATIC)

| Check | Result |
|------|--------|
| OSPE answer not in pre-reveal HTML | **PASS** (E2E) |
| OSPE image via `/api/ospe-stations/:id` private stream | **PASS** (E2E) |
| PDF `/api/study-content/:id` no R2/cloudflare URL in body | **PASS** (E2E) |
| RLS year-scoped admin + student catalog column grants | **PASS** (pgTAP `200_ospe_practice`) |

## Practice / profile / dashboard

| Area | Level | Notes |
|------|-------|-------|
| OSPE practice reveal + progress | AUTOMATED | E2E + pgTAP |
| MCQ / Pearl / Profile / Dashboard Top N | STATIC / prior staging RC | No new regression in this pass; exam + smoke green |

## Classification

**READY FOR FINAL PRODUCTION RELEASE**

Staging OSPE + PDF + exam + smoke/PWA/RBAC gates are green; production app and DB were not modified. This record does **not** authorize production deploy — that remains a separate explicit step.
