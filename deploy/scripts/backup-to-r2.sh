#!/usr/bin/env bash
# Encrypted pg_dump → temporary file → Cloudflare R2, then verify + retain 7–14 scheduled copies.
# Canonical: docs/deployment.md. Do not run against Cloud hosted Postgres.
set -euo pipefail

umask 077

usage() {
  cat <<'EOF'
Usage: backup-to-r2.sh [--dry-run] [--tag TAG] [--help]

Creates a custom-format pg_dump, encrypts it (openssl AES-256-CBC + PBKDF2),
uploads to R2, HEADs the object (size must match), then deletes older
scheduled copies beyond BACKUP_KEEP_COUNT (7–14). Tagged dumps
(pre-exam, pre-migration, …) are not pruned. Local dump files are
removed on success.

Environment (typically /etc/medverse/backup.env):
  MEDVERSE_ENV              local | vps-staging | production
  MEDVERSE_BACKUP_CONFIRM   required when MEDVERSE_ENV=production
                            (exact value: I_UNDERSTAND_PRODUCTION)
  PGHOST PGPORT PGDATABASE PGUSER   (loopback VPS Postgres)
  DUMP_ENCRYPTION_KEY
  R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET
  R2_ENDPOINT               optional
  BACKUP_KEEP_COUNT         optional, default 14 (clamped to 7–14)
  MEDVERSE_BACKUP_TAG       optional, default scheduled (or --tag)

Does not print secrets. Does not dump Cloud (*.supabase.co) hosts.
EOF
}

DRY_RUN=0
TAG="${MEDVERSE_BACKUP_TAG:-scheduled}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "backup tag must not be empty" >&2
  exit 2
fi

redact_host() {
  local h="${1:-}"
  if [[ -z "$h" ]]; then
    echo "(unset)"
    return
  fi
  echo "$h"
}

is_cloud_host() {
  local h="${1:-}"
  [[ "$h" == *supabase.co* ]] && return 0
  [[ "$h" == *pooler.supabase.com* ]] && return 0
  [[ "$h" == *pxoxijlhcvbrostrquft* ]] && return 0
  [[ "$h" == *vygtwrsshcyfahfzurgq* ]] && return 0
  return 1
}

is_loopback_pghost() {
  case "${1:-}" in
    127.0.0.1|localhost|::1|/var/run/postgresql|/run/postgresql) return 0 ;;
    *) return 1 ;;
  esac
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "missing required environment variable: $name" >&2
    exit 2
  fi
}

MEDVERSE_ENV="${MEDVERSE_ENV:-}"
if [[ "$MEDVERSE_ENV" != "local" && "$MEDVERSE_ENV" != "vps-staging" && "$MEDVERSE_ENV" != "production" ]]; then
  echo "MEDVERSE_ENV must be local, vps-staging, or production" >&2
  exit 2
fi

if [[ "$MEDVERSE_ENV" == "production" && "${MEDVERSE_BACKUP_CONFIRM:-}" != "I_UNDERSTAND_PRODUCTION" ]]; then
  echo "refusing production backup: set MEDVERSE_BACKUP_CONFIRM=I_UNDERSTAND_PRODUCTION" >&2
  exit 2
fi

require_env PGHOST
require_env PGDATABASE
require_env PGUSER
require_env DUMP_ENCRYPTION_KEY
require_env R2_ACCOUNT_ID
require_env R2_ACCESS_KEY_ID
require_env R2_SECRET_ACCESS_KEY
require_env R2_BUCKET

if is_cloud_host "$PGHOST" || is_cloud_host "${PGDATABASE:-}" || is_cloud_host "${SUPABASE_DB_URL:-}"; then
  echo "refusing to dump a Cloud / hosted Supabase host" >&2
  exit 2
fi

if ! is_loopback_pghost "$PGHOST"; then
  echo "refusing non-loopback PGHOST (Postgres must not be reachable on the public internet)" >&2
  exit 2
fi

KEEP="${BACKUP_KEEP_COUNT:-14}"
if ! [[ "$KEEP" =~ ^[0-9]+$ ]] || [[ "$KEEP" -lt 7 || "$KEEP" -gt 14 ]]; then
  echo "BACKUP_KEEP_COUNT must be an integer from 7 to 14" >&2
  exit 2
fi

ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OBJECT="medverse/${MEDVERSE_ENV}/${TAG}/${STAMP}.dump.enc"

echo "backup plan: env=${MEDVERSE_ENV} db=${PGDATABASE} host=$(redact_host "$PGHOST") tag=${TAG} keep=${KEEP} object=${OBJECT} dry_run=${DRY_RUN}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "dry-run: no dump, no upload"
  exit 0
fi

if ! command -v pg_dump >/dev/null || ! command -v openssl >/dev/null || ! command -v aws >/dev/null; then
  echo "need pg_dump, openssl, and aws (AWS CLI v2) on PATH" >&2
  exit 2
fi

LOCK="${TMPDIR:-/tmp}/medverse-backup.lock"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "refusing: another backup is already running" >&2
  exit 3
fi

TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/medverse-dump.XXXXXX")"
cleanup() {
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

DUMP="$TMPDIR/medverse.dump"
ENC="$TMPDIR/medverse.dump.enc"

# Custom format (-Fc) as documented. No --verbose (would log object names with roles).
pg_dump -Fc --no-owner --no-acl -f "$DUMP"

openssl enc -aes-256-cbc -pbkdf2 -salt \
  -pass env:DUMP_ENCRYPTION_KEY \
  -in "$DUMP" -out "$ENC"
rm -f "$DUMP"

BYTES="$(stat -c%s "$ENC")"
echo "encrypted dump bytes=${BYTES}"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${R2_REGION:-auto}"
# Prevent aws from echoing request params in debug modes we do not set.
unset AWS_DEBUG AWS_MAX_ATTEMPTS_DEBUG || true

aws s3 cp "$ENC" "s3://${R2_BUCKET}/${OBJECT}" --endpoint-url "$ENDPOINT" --only-show-errors

REMOTE="$(
  aws s3api head-object \
    --bucket "$R2_BUCKET" \
    --key "$OBJECT" \
    --endpoint-url "$ENDPOINT" \
    --query 'ContentLength' \
    --output text
)"
REMOTE="${REMOTE//$'\r'/}"
if [[ "$REMOTE" != "$BYTES" ]]; then
  echo "HEAD size mismatch local=${BYTES} remote=${REMOTE}" >&2
  exit 1
fi

echo "upload verified: s3://${R2_BUCKET}/${OBJECT}"

# Retention: prune only scheduled dumps. Tagged copies (pre-exam, etc.) stay.
if [[ "$TAG" == "scheduled" ]]; then
  PREFIX="medverse/${MEDVERSE_ENV}/scheduled/"
  mapfile -t KEYS < <(
    aws s3api list-objects-v2 \
      --bucket "$R2_BUCKET" \
      --prefix "$PREFIX" \
      --endpoint-url "$ENDPOINT" \
      --query 'sort_by(Contents,&LastModified)[].Key' \
      --output text | tr '\t' '\n' | sed '/^$/d;/^None$/d'
  )

  COUNT="${#KEYS[@]}"
  if [[ "$COUNT" -gt "$KEEP" ]]; then
    DELETE_N=$((COUNT - KEEP))
    for ((i = 0; i < DELETE_N; i++)); do
      old="${KEYS[$i]}"
      [[ -n "$old" ]] || continue
      [[ "$old" == "${PREFIX}"* ]] || continue
      aws s3api delete-object \
        --bucket "$R2_BUCKET" \
        --key "$old" \
        --endpoint-url "$ENDPOINT" \
        --output text >/dev/null
      echo "retention deleted older scheduled copy (key not printed)"
    done
  fi
fi

echo "backup complete"
