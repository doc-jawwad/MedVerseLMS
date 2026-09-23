#!/bin/bash
# Production Prof Session migrations ONLY — medverse DB.
# Authorized cutover. Does not touch medverse_staging or Cloud.
set -euo pipefail

MIG_DIR=/tmp/medverse-ps-migs/supabase/migrations
DB=medverse

psql_prod() {
  sudo -n -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

echo "PROD_DB=$(psql_prod -Atc 'select current_database()')"
test "$(psql_prod -Atc 'select current_database()')" = "medverse"

HEAD="$(psql_prod -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
echo "HEAD_BEFORE=$HEAD"
test "$HEAD" = "20260922000004"

apply_one() {
  local ver="$1"
  local file="$2"
  local name="$3"
  if psql_prod -Atc "select 1 from supabase_migrations.schema_migrations where version='$ver'" | grep -q 1; then
    echo "ALREADY_APPLIED=$ver"
    return 0
  fi
  echo "APPLYING=$ver"
  psql_prod -f "$MIG_DIR/$file"
  psql_prod -c "insert into supabase_migrations.schema_migrations (version, name) values ('$ver', '$name') on conflict (version) do nothing;"
  echo "RECORDED=$ver"
}

apply_one 20260922000005 20260922000005_prof_session_subject_ia.sql prof_session_subject_ia
apply_one 20260922000006 20260922000006_prof_session_day_practice_batch.sql prof_session_day_practice_batch
apply_one 20260922000007 20260922000007_prof_session_day_practice_year_scope.sql prof_session_day_practice_year_scope

HEAD_AFTER="$(psql_prod -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
echo "HEAD_AFTER=$HEAD_AFTER"
test "$HEAD_AFTER" = "20260922000007"

# Staging must be unchanged
STG="$(sudo -n -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1")"
echo "STAGING_HEAD=$STG"
test "$STG" = "20260922000007"

echo "MIGRATIONS_OK"
