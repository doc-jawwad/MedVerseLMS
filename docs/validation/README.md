# Validation archive

Append-only records of environment validation and phase sign-offs.

| Record | Scope | Status |
|--------|--------|--------|
| [pdf-reader-offline-staging-20260923.md](pdf-reader-offline-staging-20260923.md) | Protected PDF.js range reader + Save for Offline | **STAGING DEPLOYED** — 20MB Range reader AUTOMATED pass; large-file UI pending valid fixtures |
| [direct-r2-pdf-upload-staging-20260923.md](direct-r2-pdf-upload-staging-20260923.md) | Direct-to-R2 multipart PDF upload (remove 25MB limit) | **STAGING DEPLOYED** — R2 smoke 5MB–1GB OK; **CORS apply pending** (bucket reports CORS not configured) |
| [production-ps-cutover-0af0241-20260922.md](production-ps-cutover-0af0241-20260922.md) | Prof. Session production cutover (`0af0241` / DB `20260922000007`) | **PRODUCTION DEPLOYED** (with DEV-PS-001 ensure correction) |
| [ospe-staging-rc-20260920.md](ospe-staging-rc-20260920.md) | OSPE Practice final staging RC | **READY FOR FINAL PRODUCTION RELEASE** (staging only; prod not deployed) |
| [rc-staging-20260920.md](rc-staging-20260920.md) | Earlier integration RC (pre-OSPE) | Historical — superseded for OSPE by ospe-staging-rc |
| [8j-staging-signoff-20260916.md](8j-staging-signoff-20260916.md) | Phase 8J on VPS staging | **STAGING VALIDATED — 8J COMPLETE** |
| [production-backup-readiness-20260918.md](production-backup-readiness-20260918.md) | Production backup/restore gate | **NOT READY — missing R2, dump key, aws CLI** |
| [production-backup-dr-20260918.md](production-backup-dr-20260918.md) | Production backup/DR setup | **READY — daily timer enabled, restore drill passed** |

Rules:

- Do **not** delete or rewrite prior records to change history. Add a new dated file (or an additive appendix) if a later pass revises status.
- Product laws remain in the canonical law docs (`access-eligibility-analytics.md`, `exam-state-machine.md`, `scoring-rules.md`, `test-rules.md`, `permissions.md`, `database.md`). Validation files record **evidence**, not new law.
- A staging sign-off **does not** authorize production deployment.
