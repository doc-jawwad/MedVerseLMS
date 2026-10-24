#!/usr/bin/env bash
# Staging-ONLY deploy of Issue 5 Prof. Session one-liner source PDF.
# Target: 1f61560 (PR #2). Previous expected: a2966d9 (PDF-scroll staging tip).
# Migration 20261024120000 must already be applied to medverse_staging (app deploy only).
# Never touches /opt/medverse (production), production units, production DB, or Auth.
set -euo pipefail

readonly TARGET_SHA="1f61560e89ddf79f33eac1445b82d3b43c73277b"
readonly TARGET_SHORT="1f61560"
readonly PREV_EXPECTED_SHA="a2966d96d3fecae594fc9f573620b730f24f287a"
readonly STAGING_REF="vygtwrsshcyfahfzurgq"
readonly PROD_REF="pxoxijlhcvbrostrquft"
readonly SSH_ALIAS="medverse-vps"
readonly NEXT_UNIT="medverse-staging-next.service"
readonly DEPLOY_UNIT="mv-staging-issue5-olpdf-deploy-${TARGET_SHORT}"
readonly REQUIRED_FILES=(
  src/app/api/one-liners/[id]/route.ts
  src/lib/actions/one-liners.ts
  "src/app/(admin)/admin/one-liners/one-liner-editor.tsx"
  src/components/academic/prof-session-slot-page.tsx
  supabase/migrations/20261024120000_one_liner_source_pdf.sql
  package.json
  package-lock.json
  next.config.ts
  deploy/systemd/medverse-staging-next.service
)

die() { echo "FAIL: $*" >&2; exit "${2:-3}"; }

STG_ROOT=/opt/medverse-staging
PROD_CURRENT=/opt/medverse/current
ENV_FILE=/etc/medverse-staging/nextjs.env
STATUS_DIR="$STG_ROOT/deploy-status"
STATUS_FILE="$STATUS_DIR/issue5-olpdf-${TARGET_SHORT}.status"
LOG_FILE="$STATUS_DIR/issue5-olpdf-${TARGET_SHORT}.log"
INCOMING="$STG_ROOT/deploy-incoming"
ROLLBACK_FILE="$STATUS_DIR/issue5-olpdf-${TARGET_SHORT}.rollback"

local_check() {
  local full
  full="$(git rev-parse --verify "${TARGET_SHORT}^{commit}")" || die "commit ${TARGET_SHORT} not found locally"
  [[ "$full" == "$TARGET_SHA" ]] || die "${TARGET_SHORT} resolves to $full, expected $TARGET_SHA"
  local f
  for f in "${REQUIRED_FILES[@]}"; do
    git cat-file -e "${TARGET_SHA}:${f}" 2>/dev/null || die "required file missing at ${TARGET_SHORT}: $f"
  done
  git show "${TARGET_SHA}:src/app/api/one-liners/[id]/route.ts" | grep -q 'authorize_one_liner_object' || die "API marker missing"
  git merge-base --is-ancestor "${PREV_EXPECTED_SHA}" "${TARGET_SHA}" || die "target does not descend from ${PREV_EXPECTED_SHA:0:7}"
  echo "check ok: ${TARGET_SHA}"
}

print_plan() {
  cat <<EOF
plan (staging only):
  release dir     : ${STG_ROOT}/releases/<UTC>-${TARGET_SHORT}-issue5-olpdf
  activated via   : symlink ${STG_ROOT}/current
  restarted unit  : ${NEXT_UNIT} only (port 3010)
  never touched   : production tree/units/DB
  rollback        : $0 rollback
EOF
}

ssh_cmd() { ssh -o BatchMode=yes -o ConnectTimeout=15 -o IdentitiesOnly=yes "${SSH_ALIAS}" "$@"; }
ssh_preflight() {
  ssh_cmd true >/dev/null 2>&1 || die "SSH to ${SSH_ALIAS} not usable" 4
}

st() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$STATUS_FILE"
  echo ">> $*"
}

remote_run() {
  local tarball="${1:-}" want_sha256="${2:-}"
  [[ "$(id -u)" -eq 0 ]] || die "remote-run must run as root on the VPS" 2
  [[ -n "$tarball" && -f "$tarball" ]] || die "missing tarball"
  [[ "$want_sha256" =~ ^[0-9a-f]{64}$ ]] || die "missing/invalid expected sha256"
  [[ "$STG_ROOT" == "/opt/medverse-staging" ]] || die "STG_ROOT not staging"
  [[ "$ENV_FILE" == "/etc/medverse-staging/nextjs.env" ]] || die "ENV_FILE not staging"
  [[ "$PROD_CURRENT" == "/opt/medverse/current" ]] || die "PROD_CURRENT unexpected"

  local stg_real prod_real
  stg_real="$(realpath -m "$STG_ROOT")"
  prod_real="$(realpath -m "$(dirname "$PROD_CURRENT")")"
  [[ "$stg_real" != "$prod_real" && "$stg_real/" != "$prod_real/"* && "$prod_real/" != "$stg_real/"* ]] \
    || die "staging and production roots overlap"
  [[ "$ENV_FILE" != /etc/medverse/* ]] || die "ENV_FILE is a production path"

  mkdir -p "$STATUS_DIR" "$INCOMING"
  exec 9>"$STATUS_DIR/lock-issue5-olpdf"
  flock -n 9 || die "another issue5-olpdf deploy is running" 5
  exec > >(tee -a "$LOG_FILE") 2>&1
  st "START target=${TARGET_SHA}"

  [[ "$(sha256sum "$tarball" | cut -d' ' -f1)" == "$want_sha256" ]] || { st "FAILED tarball sha256 mismatch"; die "tarball sha256 mismatch"; }
  st "TARBALL_VERIFIED"

  [[ -f "$ENV_FILE" ]] || die "staging env file missing"
  grep -q "$STAGING_REF" "$ENV_FILE" || die "staging env does not reference ${STAGING_REF}"
  if grep -q "$PROD_REF" "$ENV_FILE"; then die "staging env references production Auth ref"; fi
  grep -q 'staging\.medversepk\.com' "$ENV_FILE" || die "staging env lacks staging origin"
  if grep -Eq 'lms\.medversepk\.com' "$ENV_FILE"; then die "staging env references production origin"; fi
  st "ENV_IDENTITY_OK"

  local unit
  unit="$(systemctl cat "$NEXT_UNIT")" || die "unit $NEXT_UNIT not found"
  grep -q '^WorkingDirectory=/opt/medverse-staging/current' <<<"$unit" || die "unit WorkingDirectory is not staging"
  grep -q '^EnvironmentFile=/etc/medverse-staging/nextjs.env' <<<"$unit" || die "unit EnvironmentFile is not staging"
  grep -q 'PORT=3010' <<<"$unit" || die "unit port is not 3010"
  st "SERVICE_IDENTITY_OK"

  # Migration must already be on staging DB
  local mig_head
  mig_head="$(sudo -n -u postgres psql -d medverse_staging -Atc "select version from supabase_migrations.schema_migrations where version='20261024120000'")"
  [[ "$mig_head" == "20261024120000" ]] || die "staging DB missing migration 20261024120000; apply before app deploy"
  local prod_col
  prod_col="$(sudo -n -u postgres psql -d medverse -Atc "select count(*) from information_schema.columns where table_schema='public' and table_name='one_liners' and column_name='r2_object_key'")"
  [[ "$prod_col" == "0" ]] || die "production unexpectedly has one_liners.r2_object_key"
  st "DB_PRECHECK_OK"

  local prod_before prev
  prod_before="$(readlink -e "$PROD_CURRENT" || true)"
  [[ -n "$prod_before" ]] || die "cannot resolve production current"
  prev="$(readlink -e "$STG_ROOT/current" || true)"
  [[ -n "$prev" && -d "$prev" && "$prev" == "$stg_real/releases/"* ]] || die "current staging release not under releases"
  [[ -f "$prev/RELEASE_COMMIT" ]] || die "previous staging release has no RELEASE_COMMIT"
  [[ "$(tr -d '[:space:]' <"$prev/RELEASE_COMMIT")" == "$PREV_EXPECTED_SHA" ]] \
    || die "staging runs $(tr -d '[:space:]' <"$prev/RELEASE_COMMIT"), expected ${PREV_EXPECTED_SHA}"
  printf 'PREV=%s\nPREV_SHA=%s\n' "$prev" "$(tr -d '[:space:]' <"$prev/RELEASE_COMMIT")" >"$ROLLBACK_FILE"
  st "ROLLBACK_RECORDED prev=$(basename "$prev")"

  local stamp dst
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dst="$STG_ROOT/releases/${stamp}-${TARGET_SHORT}-issue5-olpdf"
  [[ ! -e "$dst" ]] || die "release dir exists"
  mkdir -p "$dst"
  tar -xzf "$tarball" -C "$dst"
  local f
  for f in "${REQUIRED_FILES[@]}"; do [[ -f "$dst/$f" ]] || die "release missing $f"; done
  grep -q 'authorize_one_liner_object' "$dst/src/app/api/one-liners/[id]/route.ts" || die "release lacks API authz"
  printf '%s\n' "$TARGET_SHA" >"$dst/RELEASE_COMMIT"
  st "RELEASE_UNPACKED dir=$(basename "$dst")"

  chown -R medverse:medverse "$dst"
  st "BUILD_START"
  sudo -u medverse bash -c "
    set -euo pipefail; set +x
    cd '$dst'
    set -a; source '$ENV_FILE'; set +a
    export NODE_ENV=production SENTRY_RELEASE='$TARGET_SHA' NEXT_PUBLIC_SENTRY_RELEASE='$TARGET_SHA'
    npm ci --include=dev
    npm run build
  " || { st "FAILED build (staging current unchanged)"; die "build failed"; }
  grep -Rqs 'staging.medversepk.com' "$dst/.next" || { st "FAILED origin not baked"; die "staging origin not baked"; }
  if grep -Rqs 'lms.medversepk.com' "$dst/.next"; then st "FAILED prod origin baked"; die "production origin baked"; fi
  if grep -Rqs "$PROD_REF" "$dst/.next"; then st "FAILED prod ref baked"; die "production Auth ref baked"; fi
  st "BUILD_OK"

  ln -sfn "$dst" "$STG_ROOT/current"
  [[ "$(readlink -f "$STG_ROOT/current")" == "$(readlink -f "$dst")" ]] || die "symlink verification failed"
  st "ACTIVATED"
  systemctl restart "$NEXT_UNIT"

  local ok=0 i
  for i in $(seq 1 45); do
    if curl -fsS http://127.0.0.1:3010/api/health >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  local live_sha
  live_sha="$(tr -d '[:space:]' <"$STG_ROOT/current/RELEASE_COMMIT")"
  if [[ "$ok" -ne 1 || "$live_sha" != "$TARGET_SHA" \
        || "$(readlink -f "$PROD_CURRENT")" != "$prod_before" ]]; then
    st "FAILED post-activation; rolling back"
    ln -sfn "$prev" "$STG_ROOT/current"
    systemctl restart "$NEXT_UNIT"
    st "FAILED_ROLLED_BACK to $(basename "$prev")"
    die "post-activation verification failed; rolled back" 6
  fi
  st "DONE sha=${live_sha} prod_current_unchanged=yes"
  echo "RELEASE_COMMIT=${live_sha}"
}

remote_rollback() {
  [[ "$(id -u)" -eq 0 ]] || die "rollback must run as root" 2
  [[ -f "$ROLLBACK_FILE" ]] || die "no rollback record"
  local prev
  prev="$(sed -n 's/^PREV=//p' "$ROLLBACK_FILE")"
  [[ "$prev" == "$(realpath -m "$STG_ROOT")/releases/"* && -d "$prev" ]] || die "recorded previous release invalid"
  ln -sfn "$prev" "$STG_ROOT/current"
  systemctl restart "$NEXT_UNIT"
  st "ROLLED_BACK to $(basename "$prev")"
}

mode="${1:-check}"
case "$mode" in
  check) local_check; print_plan ;;
  push)
    local_check; print_plan
    ssh_preflight
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    tar_name="medverse-${TARGET_SHORT}-issue5-olpdf.tar.gz"
    git -c core.autocrlf=false -c core.eol=lf archive --format=tar "$TARGET_SHA" | gzip -n >"$tmp/$tar_name"
    sum="$(sha256sum "$tmp/$tar_name" | cut -d' ' -f1)"
    # On Windows, sha256sum may be missing — handled by caller using certutil if needed
    ssh_cmd "mkdir -p ${INCOMING}"
    scp -o BatchMode=yes -o IdentitiesOnly=yes "$tmp/$tar_name" "$0" "${SSH_ALIAS}:${INCOMING}/"
    ssh_cmd "sudo -n systemd-run --unit=${DEPLOY_UNIT} --collect /bin/bash ${INCOMING}/$(basename "$0") remote-run ${INCOMING}/${tar_name} ${sum}"
    echo "started detached unit ${DEPLOY_UNIT}"
    ;;
  status)
    ssh_preflight
    ssh_cmd "cat ${STATUS_FILE} 2>/dev/null; echo ---; tail -n 60 ${LOG_FILE} 2>/dev/null; echo ---; systemctl is-active ${DEPLOY_UNIT} 2>&1 || true; echo ---; cat ${STG_ROOT}/current/RELEASE_COMMIT 2>/dev/null; systemctl is-active ${NEXT_UNIT}"
    ;;
  rollback)
    ssh_preflight
    ssh_cmd "sudo -n /bin/bash ${INCOMING}/$(basename "$0") remote-rollback"
    ;;
  remote-run) shift; remote_run "$@" ;;
  remote-rollback) remote_rollback ;;
  *) die "unknown mode: $mode" 2 ;;
esac