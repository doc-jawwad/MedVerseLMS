# Validation archive

Append-only records of environment validation and phase sign-offs.

| Record | Scope | Status |
|--------|--------|--------|
| [8j-staging-signoff-20260916.md](8j-staging-signoff-20260916.md) | Phase 8J on VPS staging | **STAGING VALIDATED — 8J COMPLETE** |
| [production-backup-readiness-20260918.md](production-backup-readiness-20260918.md) | Production backup/restore gate | **NOT READY — missing R2, dump key, aws CLI** |
| [production-backup-dr-20260918.md](production-backup-dr-20260918.md) | Production backup/DR setup | **READY — daily timer enabled, restore drill passed** |

Rules:

- Do **not** delete or rewrite prior records to change history. Add a new dated file (or an additive appendix) if a later pass revises status.
- Product laws remain in the canonical law docs (`access-eligibility-analytics.md`, `exam-state-machine.md`, `scoring-rules.md`, `test-rules.md`, `permissions.md`, `database.md`). Validation files record **evidence**, not new law.
- A staging sign-off **does not** authorize production deployment.
