#!/usr/bin/env bash
# Staging-ONLY, app-only deploy of the Test Builder random-selection scope fix
# (Issue #3): "Add N random" honours the visible pool's text search and CSV
# import-set filters; an empty/unknown import batch yields an empty pool.
# Commit 16a74f42c0af8c41552c67f10b5f5fbc9275fb3f (feat/test-reattempts).
#
# Never: applies migrations, touches /opt/medverse (production), production
# units, production env, production Auth (pxoxijlhcvbrostrquft), PostgREST,
# or any database. Refuses to run unless staging currently runs the expected
# parent release (so it cannot overwrite an unexpected release).
#
# Modes (run from the repo on the workstation unless noted):
#   check      Offline. Verify commit, files, no-migration delta. No network. (default)
#   push       check + SSH preflight + upload tarball + detached systemd unit.
#   status     Show remote status file + log tail.
#   rollback   Restore the previous staging release recorded by the deploy.
#   remote-run (VPS only, as root, invoked by `push`).
#
# SSH prerequisite: `ssh -o BatchMode=yes medverse-vps true` must succeed with
# the already-authorised key. This script never tries other keys or hosts.
set -euo pipefail

readonly TARGET_SHA="16a74f42c0af8c41552c67f10b5f5fbc9275fb3f"
readonly TARGET_SHORT="16a74f4"
# Staging must currently run exactly this release (last pinned reattempts fix).
readonly PREV_EXPECTED_SHA="8563b25e0a0332d37810f29863bcc7d7a25784d8"
readonly STAGING_REF="vygtwrsshcyfahfzurgq"
readonly PROD_REF="pxoxijlhcvbrostrquft"
readonly SSH_ALIAS="medverse-vps"
readonly NEXT_UNIT="medverse-staging-next.service"
readonly DEPLOY_UNIT="mv-staging-random-scope-deploy-${TARGET_SHORT}"
readonly REQUIRED_FILES=(
  src/lib/tests/random-selection-scope.ts
  src/lib/actions/tests.ts
  "src/app/(admin)/admin/tests/[id]/page.tsx"
  package.json
  package-lock.json
  next.config.ts
  deploy/systemd/medverse-staging-next.service
)

die() { echo "FAIL: $*" >&2; exit "${2:-3}"; }

# --- paths -------------------------------------------------------------
# Real values are constants. Overrides exist ONLY for the offline test
# harness and are honoured only together with MV_DRY_RUN=1.
STG_ROOT=/opt/medverse-staging
PROD_CURRENT=/opt/medverse/current
ENV_FILE=/etc/medverse-staging/nextjs.env
DRY_RUN=0
if [[ "${MV_DRY_RUN:-}" == "1" ]]; then
  DRY_RUN=1
  STG_ROOT="${MV_TEST_STG_ROOT:-$STG_ROOT}"
  PROD_CURRENT="${MV_TEST_PROD_CURRENT:-$PROD_CURRENT}"
  ENV_FILE="${MV_TEST_ENV_FILE:-$ENV_FILE}"
elif [[ -n "${MV_TEST_STG_ROOT:-}${MV_TEST_PROD_CURRENT:-}${MV_TEST_ENV_FILE:-}${MV_TARGET_SHA:-}" ]]; then
  die "test overrides are only honoured with MV_DRY_RUN=1"
fi
STATUS_DIR="$STG_ROOT/deploy-status"
STATUS_FILE="$STATUS_DIR/random-scope-${TARGET_SHORT}.status"
LOG_FILE="$STATUS_DIR/random-scope-${TARGET_SHORT}.log"
INCOMING="$STG_ROOT/deploy-incoming"
ROLLBACK_FILE="$STATUS_DIR/random-scope-${TARGET_SHORT}.rollback"

# --- offline checks ----------------------------------------------------
local_check() {
  local full
  full="$(git rev-parse --verify "${TARGET_SHORT}^{commit}")" || die "commit ${TARGET_SHORT} not found locally"
  [[ "$full" == "$TARGET_SHA" ]] || die "${TARGET_SHORT} resolves to $full, expected $TARGET_SHA"
  local f
  for f in "${REQUIRED_FILES[@]}"; do
    git cat-file -e "${TARGET_SHA}:${f}" 2>/dev/null || die "required file missing at ${TARGET_SHORT}: $f"
  done
  git show "${TARGET_SHA}:src/lib/tests/random-selection-scope.ts" | grep -q 'importBatchYieldsEmptyPool' || die "fix marker missing: wrong code at target"
  git merge-base --is-ancestor "${PREV_EXPECTED_SHA}" "${TARGET_SHA}" || die "target does not descend from ${PREV_EXPECTED_SHA:0:7}"
  local mig
  mig="$(git diff --name-only "${PREV_EXPECTED_SHA}" "${TARGET_SHA}" -- supabase/migrations)"
  [[ -z "$mig" ]] || die "migrations differ from ${PREV_EXPECTED_SHA:0:7}: $mig"
  echo "check ok: ${TARGET_SHA}"
  echo "  files verified: ${#REQUIRED_FILES[@]}; migrations vs ${PREV_EXPECTED_SHA:0:7}: none"
  echo "  untracked/working-tree files are NOT part of the release (git archive of the commit)"
}

print_plan() {
  cat <<EOF
plan (staging only):
  host alias      : ${SSH_ALIAS} (shared VPS; staging selected by path/port/units below)
  release dir     : ${STG_ROOT}/releases/<UTC>-${TARGET_SHORT}-random-scope
  activated via   : symlink ${STG_ROOT}/current
  restarted unit  : ${NEXT_UNIT} only (port 3010)
  never touched   : the production tree and units, PostgREST, databases, migrations
  rollback        : $0 rollback   (or: ln -sfn <prev> ${STG_ROOT}/current && systemctl restart ${NEXT_UNIT})
EOF
}

# --- ssh helpers (push/status/rollback) --------------------------------
ssh_cmd() { ssh -o BatchMode=yes -o ConnectTimeout=15 -o IdentitiesOnly=yes "${SSH_ALIAS}" "$@"; }

ssh_preflight() {
  ssh_cmd true >/dev/null 2>&1 || die "SSH to ${SSH_ALIAS} not usable with the authorised key (BatchMode). Load the key into ssh-agent (or run from a terminal where it works), confirm 'ssh -o BatchMode=yes ${SSH_ALIAS} true', then retry. Not trying other keys/hosts." 4
}

# --- remote-run (VPS, root) --------------------------------------------
st() { # state line; never prints secrets
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$STATUS_FILE"
  echo ">> $*"
}

remote_run() {
  local tarball="${1:-}" want_sha256="${2:-}"
  if [[ "$DRY_RUN" -eq 0 && "$(id -u)" -ne 0 ]]; then die "remote-run must run as root on the VPS" 2; fi
  [[ -n "$tarball" && -f "$tarball" ]] || die "missing tarball: ${tarball:-<none>}"
  [[ "$want_sha256" =~ ^[0-9a-f]{64}$ ]] || die "missing/invalid expected sha256"

  # Path-confusion guards: staging root must be exactly the staging tree and
  # must never equal or contain/sit inside the production tree.
  if [[ "$DRY_RUN" -eq 0 ]]; then
    [[ "$STG_ROOT" == "/opt/medverse-staging" ]] || die "STG_ROOT not staging"
    [[ "$ENV_FILE" == "/etc/medverse-staging/nextjs.env" ]] || die "ENV_FILE not staging"
    [[ "$PROD_CURRENT" == "/opt/medverse/current" ]] || die "PROD_CURRENT unexpected"
  fi
  local stg_real prod_real
  stg_real="$(realpath -m "$STG_ROOT")"
  prod_real="$(realpath -m "$(dirname "$PROD_CURRENT")")"
  [[ "$stg_real" != "$prod_real" && "$stg_real/" != "$prod_real/"* && "$prod_real/" != "$stg_real/"* ]] \
    || die "staging and production roots overlap"
  [[ "$ENV_FILE" != /etc/medverse/* ]] || die "ENV_FILE is a production path"

  mkdir -p "$STATUS_DIR" "$INCOMING"
  exec 9>"$STATUS_DIR/lock"
  flock -n 9 || die "another random-scope deploy is running (see status)" 5
  exec > >(tee -a "$LOG_FILE") 2>&1
  st "START target=${TARGET_SHA} dry_run=${DRY_RUN}"

  [[ "$(sha256sum "$tarball" | cut -d' ' -f1)" == "$want_sha256" ]] || { st "FAILED tarball sha256 mismatch"; die "tarball sha256 mismatch"; }
  st "TARBALL_VERIFIED"

  # Staging environment identity (values never printed).
  [[ -f "$ENV_FILE" ]] || { st "FAILED no staging env"; die "staging env file missing"; }
  grep -q "$STAGING_REF" "$ENV_FILE" || { st "FAILED staging ref absent"; die "staging env does not reference ${STAGING_REF}"; }
  if grep -q "$PROD_REF" "$ENV_FILE"; then st "FAILED prod ref in staging env"; die "staging env references production Auth ref"; fi
  grep -q 'staging\.medversepk\.com' "$ENV_FILE" || { st "FAILED staging origin"; die "staging env lacks staging origin"; }
  if grep -Eq 'lms\.medversepk\.com' "$ENV_FILE"; then st "FAILED prod origin in env"; die "staging env references production origin"; fi
  st "ENV_IDENTITY_OK"

  # Service identity (real run): unit must be the staging unit on port 3010.
  if [[ "$DRY_RUN" -eq 0 ]]; then
    local unit
    unit="$(systemctl cat "$NEXT_UNIT")" || die "unit $NEXT_UNIT not found"
    grep -q '^WorkingDirectory=/opt/medverse-staging/current' <<<"$unit" || die "unit WorkingDirectory is not staging"
    grep -q '^EnvironmentFile=/etc/medverse-staging/nextjs.env' <<<"$unit" || die "unit EnvironmentFile is not staging"
    grep -q 'PORT=3010' <<<"$unit" || die "unit port is not 3010"
  fi
  st "SERVICE_IDENTITY_OK"

  local prod_before prev
  prod_before="$(readlink -e "$PROD_CURRENT" || true)"
  [[ -n "$prod_before" ]] || die "cannot resolve production current (refusing to proceed blind)"
  prev="$(readlink -e "$STG_ROOT/current" || true)"
  [[ -n "$prev" && -d "$prev" && "$prev" == "$stg_real/releases/"* ]] || die "current staging release not under $stg_real/releases"
  [[ -f "$prev/RELEASE_COMMIT" ]] || die "previous staging release has no RELEASE_COMMIT"
  [[ "$(tr -d '[:space:]' <"$prev/RELEASE_COMMIT")" == "$PREV_EXPECTED_SHA" ]]     || die "staging runs $(tr -d '[:space:]' <"$prev/RELEASE_COMMIT"), expected ${PREV_EXPECTED_SHA}; refusing to overwrite an unexpected release"
  printf 'PREV=%s\nPREV_SHA=%s\n' "$prev" "$(tr -d '[:space:]' <"$prev/RELEASE_COMMIT")" >"$ROLLBACK_FILE"
  st "ROLLBACK_RECORDED prev=$(basename "$prev")"

  local stamp dst
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dst="$STG_ROOT/releases/${stamp}-${TARGET_SHORT}-random-scope"
  [[ ! -e "$dst" ]] || die "release dir exists"
  mkdir -p "$dst"
  tar -xzf "$tarball" -C "$dst"
  local f
  for f in "${REQUIRED_FILES[@]}"; do [[ -f "$dst/$f" ]] || die "release missing $f"; done
  grep -q 'importBatchYieldsEmptyPool' "$dst/src/lib/tests/random-selection-scope.ts" || die "release lacks the fix"
  # No-migration proof: schema must be identical to what staging runs now.
  diff -rq "$dst/supabase/migrations" "$prev/supabase/migrations" >/dev/null \
    || die "migrations differ from current staging release; this deploy is callback-only"
  printf '%s\n' "$TARGET_SHA" >"$dst/RELEASE_COMMIT"
  st "RELEASE_UNPACKED dir=$(basename "$dst")"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    st "DRY_RUN_DONE (no build, no symlink change, no restart)"
    echo "dry-run complete: would build $dst, activate it, restart ${NEXT_UNIT} only"
    return 0
  fi

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
  if grep -Rqs 'lms.medversepk.com' "$dst/.next"; then st "FAILED prod origin baked"; die "production origin baked into staging build"; fi
  if grep -Rqs "$PROD_REF" "$dst/.next"; then st "FAILED prod ref baked"; die "production Auth ref baked into staging build"; fi
  st "BUILD_OK"

  ln -sfn "$dst" "$STG_ROOT/current"
  [[ "$(readlink -f "$STG_ROOT/current")" == "$(readlink -f "$dst")" ]] || die "symlink verification failed"
  st "ACTIVATED"
  systemctl restart "$NEXT_UNIT"

  local ok=0 i
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3010/api/health >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  local smoke=1  # health check above is the only smoke test (no auth-specific probe)
  local live_sha
  live_sha="$(tr -d '[:space:]' <"$STG_ROOT/current/RELEASE_COMMIT")"
  if [[ "$ok" -ne 1 || "$smoke" -ne 1 || "$live_sha" != "$TARGET_SHA" \
        || "$(readlink -f "$PROD_CURRENT")" != "$prod_before" ]]; then
    st "FAILED post-activation checks health=$ok smoke=$smoke; rolling back"
    ln -sfn "$prev" "$STG_ROOT/current"
    systemctl restart "$NEXT_UNIT"
    st "FAILED_ROLLED_BACK to $(basename "$prev")"
    die "post-activation verification failed; rolled back to previous staging release" 6
  fi
  st "DONE sha=${live_sha} prod_current_unchanged=yes"
  echo "RELEASE_COMMIT=${live_sha}"
}

remote_rollback() {
  [[ "$DRY_RUN" -eq 1 || "$(id -u)" -eq 0 ]] || die "rollback (remote) must run as root" 2
  [[ -f "$ROLLBACK_FILE" ]] || die "no rollback record at $ROLLBACK_FILE"
  local prev
  prev="$(sed -n 's/^PREV=//p' "$ROLLBACK_FILE")"
  [[ "$prev" == "$(realpath -m "$STG_ROOT")/releases/"* && -d "$prev" ]] || die "recorded previous release invalid"
  [[ "$DRY_RUN" -eq 1 ]] && { echo "dry-run rollback would point current -> $prev"; return 0; }
  ln -sfn "$prev" "$STG_ROOT/current"
  systemctl restart "$NEXT_UNIT"
  st "ROLLED_BACK to $(basename "$prev")"
}

# --- dispatch ----------------------------------------------------------
mode="${1:-check}"
case "$mode" in
  check)
    local_check; print_plan ;;
  push)
    local_check; print_plan
    ssh_preflight
    tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
    tar_name="medverse-${TARGET_SHORT}-random-scope.tar.gz"
    git -c core.autocrlf=false -c core.eol=lf archive --format=tar "$TARGET_SHA" | gzip -n >"$tmp/$tar_name"
    sum="$(sha256sum "$tmp/$tar_name" | cut -d' ' -f1)"
    ssh_cmd "mkdir -p ${INCOMING}"
    scp -o BatchMode=yes -o IdentitiesOnly=yes "$tmp/$tar_name" "$0" "${SSH_ALIAS}:${INCOMING}/"
    ssh_cmd "sudo -n systemd-run --unit=${DEPLOY_UNIT} --collect /bin/bash ${INCOMING}/$(basename "$0") remote-run ${INCOMING}/${tar_name} ${sum}"
    echo "started detached unit ${DEPLOY_UNIT}; follow with: $0 status" ;;
  status)
    ssh_preflight
    ssh_cmd "cat ${STATUS_FILE} 2>/dev/null; echo ---; tail -n 40 ${LOG_FILE} 2>/dev/null; echo ---; systemctl is-active ${DEPLOY_UNIT} 2>&1 || true" ;;
  rollback)
    ssh_preflight
    ssh_cmd "sudo -n /bin/bash ${INCOMING}/$(basename "$0") remote-rollback" ;;
  remote-run) shift; remote_run "$@" ;;
  remote-rollback) remote_rollback ;;
  *) die "unknown mode: $mode" 2 ;;
esac
