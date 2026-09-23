#!/bin/bash
set -euo pipefail
echo STAGING
readlink -f /opt/medverse-staging/current
cat /opt/medverse-staging/current/RELEASE_COMMIT
sudo -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1"
curl -sS https://staging.medversepk.com/api/health
echo
echo PROD
readlink -f /opt/medverse/current
cat /opt/medverse/current/RELEASE_COMMIT
sudo -u postgres psql -d medverse -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 1"
