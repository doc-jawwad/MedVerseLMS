#!/bin/bash
sudo -u postgres psql -d medverse_staging -f /tmp/tmp-qa-verify-r2.sql
echo PROD
cat /opt/medverse/current/RELEASE_COMMIT
sudo -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1"
echo STG
cat /opt/medverse-staging/current/RELEASE_COMMIT
readlink -f /opt/medverse-staging/current
