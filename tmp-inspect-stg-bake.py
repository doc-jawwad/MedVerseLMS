#!/bin/bash
set -euo pipefail
REL="$(ls -dt /opt/medverse-staging/releases/*aaadd7b* 2>/dev/null | head -1)"
echo "REL=$REL"
if [[ -n "$REL" && -d "$REL/.next" ]]; then
  grep -Rol 'pxoxijlhcvbrostrquft' "$REL/.next" 2>/dev/null | head -15 || echo "no hits in .next"
  # sample hit context without secrets
  HIT="$(grep -Rol 'pxoxijlhcvbrostrquft' "$REL/.next" 2>/dev/null | head -1 || true)"
  if [[ -n "$HIT" ]]; then
    echo "HIT_FILE=$HIT"
    python3 - <<PY
from pathlib import Path
p=Path("$HIT")
t=p.read_text(errors="ignore")
i=t.find("pxoxijlhcvbrostrquft")
print("CTX=", repr(t[max(0,i-40):i+60]))
PY
  fi
fi
python3 - <<'PY'
from pathlib import Path
t=Path("/etc/medverse-staging/nextjs.env").read_text()
for line in t.splitlines():
  if not line.strip() or line.lstrip().startswith("#") or "=" not in line: continue
  k,v=line.split("=",1)
  if "SUPABASE" in k or "URL" in k:
    host="pxox" in v or "vygt" in v
    print(k, "has_prod_ref=", ("pxoxijlhcvbrostrquft" in v), "has_stg_ref=", ("vygtwrsshcyfahfzurgq" in v), "len=", len(v))
PY
