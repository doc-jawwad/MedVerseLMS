# Data Spine migration 20260919250000 — real-data backfill repair

**Date:** 2026-09-20  
**Status:** repaired in-repo; production retry gated on local + disposable real-data rehearsal

## Failure (production)

During production apply of `20260919250000_data_spine_core.sql`:

- Applied & recorded through `20260919240000`
- Partial (unrecorded) from failed `19250000`: nullable `profiles.college_name`, `profiles.avatar_object_key` (+ check), `subscriptions.year_id`, `subscription_applications.year_id` (+ FKs)
- Failed at `UPDATE subscription_applications … SET year_id = …`
- Trigger: `subscription_applications_rpc_only` → `protect_subscription_application()` → `subscription_application_rpc_only`
- Cause: backfill did not set GUC `medverse.subscription_application_rpc = '1'`
- Production had **3** live `subscription_applications` rows; schema-only rehearsal had **0**, so the failure was missed

App remained on `ecda0fa-check5-low-fixes`. Tagged backup:  
`s3://medverse-prod-backups/medverse/production/pre-migration-spine/20260920T034541Z.dump.enc`

## Repair

In `20260919250000_data_spine_core.sql`, wrap year_id backfill UPDATEs in a single `DO $$ … $$` block that:

1. `set_config('medverse.subscription_application_rpc', '1', true)` (established RPC-only convention; trigger stays enabled)
2. Runs enrollment + year-1 orphan backfills for `subscriptions` and `subscription_applications`
3. Clears the GUC (including on exception)

`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` / recreate check, and `CREATE INDEX IF NOT EXISTS` already make the leading DDL safe to re-run after the partial production state. Later `CREATE OR REPLACE` RPC bodies are naturally re-runnable.

## Coverage required before production retry

1. Clean apply from `19240000` → `19254000`
2. Partial-state re-apply (columns present, `19250000` unrecorded, real application rows)
3. Disposable DB with real `subscription_applications` rows (not schema-only)
4. `npm run test:db` including `190_data_spine.sql`
