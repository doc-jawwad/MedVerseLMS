#!/usr/bin/env bash
# Remove stale staging credential/PII leftovers from /tmp.
# Never prints file contents. Skips files held open by a live process.
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root" >&2
  exit 2
fi

# Explicit credential / password / browser-auth leftovers from staging work.
TARGETS=(
  /tmp/8j_browser_creds.json
  /tmp/8jde_browser.json
  /tmp/8jd_pw.json
  /tmp/pw.json
  /tmp/auth.json
  /tmp/8j_admin_pass.txt
  /tmp/8j_student_pass.txt
  /tmp/8jd_student_pass.txt
  /tmp/8jde_e2e.env
  /tmp/8j_staging_caddy.env
  /tmp/8j_staging_harness.env
  /tmp/p2.json
  /tmp/p1.json
  /tmp/ly.json
  /tmp/ly2.json
  /tmp/rs.json
)

# Also sweep obvious pass/cred patterns (names only).
while IFS= read -r -d '' f; do
  TARGETS+=("$f")
done < <(find /tmp -maxdepth 1 -type f \( \
  -name '*_pass.txt' -o -name '*pass*.txt' -o -name '*creds*.json' -o -name '*_pw.json' \
  -o -name '*browser*.json' -o -name '*e2e.env' -o -name '*harness.env' \
  \) -print0 2>/dev/null || true)

removed=0
skipped_busy=0
missing=0
declare -A seen=()

for f in "${TARGETS[@]}"; do
  [[ -n "${seen[$f]:-}" ]] && continue
  seen[$f]=1
  if [[ ! -e "$f" ]]; then
    missing=$((missing + 1))
    continue
  fi
  # Skip if any process has it open
  if fuser "$f" >/dev/null 2>&1; then
    echo "SKIP_BUSY path=$(basename "$f")"
    skipped_busy=$((skipped_busy + 1))
    continue
  fi
  mode="$(stat -c '%a' "$f" 2>/dev/null || echo '?')"
  # shred if available; else rm
  if command -v shred >/dev/null 2>&1; then
    shred -u "$f" 2>/dev/null || rm -f "$f"
  else
    rm -f "$f"
  fi
  echo "REMOVED path=$(basename "$f") was_mode=$mode"
  removed=$((removed + 1))
done

echo "removed=$removed skipped_busy=$skipped_busy"
echo "=== remaining suspicious names (should be empty or non-cred) ==="
find /tmp -maxdepth 1 -type f \( \
  -name '*pass*' -o -name '*cred*' -o -name '*pw.json' -o -name '*browser*.json' \
  -o -name 'auth.json' -o -name '*e2e.env' -o -name '*harness.env' \
  \) -printf '%m %u %p\n' 2>/dev/null || true
echo "TMP_CLEAN_OK"
