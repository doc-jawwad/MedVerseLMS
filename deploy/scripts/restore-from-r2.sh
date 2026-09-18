#!/usr/bin/env bash
# Decrypt an R2 object and pg_restore into loopback Postgres.
# For restore drills on a scratch/VPS clone — never Cloud hosted databases.
# Never restore into live medverse or medverse_staging.
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: restore-from-r2.sh --key OBJECT_KEY [--dry-run]

Downloads an encrypted dump from R2, decrypts to a temp dir, pg_restore
--clean --if-exists --exit-on-error into PGHOST (loopback only).

Refuses Cloud hosts and live databases (medverse, medverse_staging).
Create a throwaway database first (for example medverse_restore_drill).

Required env: same as backup-to-r2.sh plus MEDVERSE_RESTORE_CONFIRM=I_UNDERSTAND_RESTORE
when MEDVERSE_ENV=production.

Optional:
  MEDVERSE_RESTORE_SCHEMA=public — restore one schema only
  MEDVERSE_RESTORE_EXCLUDE_EXTENSION=pg_cron — same-host drills; pg_cron
    can exist in only one database (cron.database_name). A replacement VPS
    restore is a full dump with cron.database_name=medverse.
EOF
}

DRY_RUN=0
OBJECT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --key) OBJECT="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$OBJECT" ]]; then
  echo "--key OBJECT_KEY is required" >&2
  exit 2
fi

is_loopback_pghost() {
  case "${1:-}" in
    127.0.0.1|localhost|::1|/var/run/postgresql|/run/postgresql) return 0 ;;
    *) return 1 ;;
  esac
}

MEDVERSE_ENV="${MEDVERSE_ENV:-}"
if [[ "$MEDVERSE_ENV" != "local" && "$MEDVERSE_ENV" != "vps-staging" && "$MEDVERSE_ENV" != "production" ]]; then
  echo "MEDVERSE_ENV must be local, vps-staging, or production" >&2
  exit 2
fi

if [[ "$MEDVERSE_ENV" == "production" && "${MEDVERSE_RESTORE_CONFIRM:-}" != "I_UNDERSTAND_RESTORE" ]]; then
  echo "refusing production restore: set MEDVERSE_RESTORE_CONFIRM=I_UNDERSTAND_RESTORE" >&2
  exit 2
fi

for name in PGHOST PGDATABASE PGUSER DUMP_ENCRYPTION_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required environment variable: $name" >&2
    exit 2
  fi
done

if [[ "$PGHOST" == *supabase.co* || "$PGHOST" == *pooler.supabase.com* ]]; then
  echo "refusing to restore into a Cloud / hosted Supabase host" >&2
  exit 2
fi

if ! is_loopback_pghost "$PGHOST"; then
  echo "refusing non-loopback PGHOST" >&2
  exit 2
fi

if [[ "$PGDATABASE" == "medverse" || "$PGDATABASE" == "medverse_staging" ]]; then
  echo "refusing to restore into live database ${PGDATABASE}; use a throwaway database" >&2
  exit 2
fi

ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"
echo "restore plan: env=${MEDVERSE_ENV} db=${PGDATABASE} host=${PGHOST} dry_run=${DRY_RUN}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "dry-run: no download, no pg_restore"
  exit 0
fi

if ! command -v pg_restore >/dev/null || ! command -v openssl >/dev/null || ! command -v aws >/dev/null; then
  echo "need pg_restore, openssl, and aws (AWS CLI v2) on PATH" >&2
  exit 2
fi

TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/medverse-restore.XXXXXX")"
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${R2_REGION:-auto}"
unset AWS_DEBUG AWS_MAX_ATTEMPTS_DEBUG || true

ENC="$TMPDIR/dump.enc"
DUMP="$TMPDIR/dump"
aws s3 cp "s3://${R2_BUCKET}/${OBJECT}" "$ENC" --endpoint-url "$ENDPOINT" --only-show-errors
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:DUMP_ENCRYPTION_KEY -in "$ENC" -out "$DUMP"
RESTORE_ARGS=(--clean --if-exists --exit-on-error --no-owner --no-acl -d "$PGDATABASE")
if [[ -n "${MEDVERSE_RESTORE_SCHEMA:-}" ]]; then
  echo "restore schema filter=${MEDVERSE_RESTORE_SCHEMA}"
  RESTORE_ARGS+=(-n "$MEDVERSE_RESTORE_SCHEMA")
fi
if [[ -n "${MEDVERSE_RESTORE_EXCLUDE_EXTENSION:-}" ]]; then
  echo "restore exclude extension=${MEDVERSE_RESTORE_EXCLUDE_EXTENSION}"
  LIST="$TMPDIR/toc.list"
  pg_restore -l "$DUMP" | python3 -c '
import re, sys
ext = sys.argv[1]
cron_word = re.compile(r"\bcron\b")
for line in sys.stdin:
    if line.startswith(";"):
        sys.stdout.write(line)
        continue
    if ext in line or "pg_cron" in line or cron_word.search(line):
        continue
    sys.stdout.write(line)
' "${MEDVERSE_RESTORE_EXCLUDE_EXTENSION}" > "$LIST"
  RESTORE_ARGS+=(--use-list "$LIST")
fi
pg_restore "${RESTORE_ARGS[@]}" "$DUMP"
echo "restore complete"
