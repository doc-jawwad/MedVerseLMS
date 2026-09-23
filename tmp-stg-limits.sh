#!/bin/bash
set -euo pipefail
echo COMMIT
cat /opt/medverse-staging/current/RELEASE_COMMIT
echo --- next.config ---
grep -n bodySizeLimit /opt/medverse-staging/current/next.config.ts || true
echo --- required-server-files snippet ---
python3 - <<'PY'
import json
p='/opt/medverse-staging/current/.next/required-server-files.json'
try:
  d=json.load(open(p))
  cfg=d.get('config') or d
  exp=(cfg.get('experimental') or {})
  print('experimental.serverActions=', exp.get('serverActions'))
except Exception as e:
  print('err',e)
PY
echo --- caddy ---
ls /etc/caddy || true
grep -nE 'request_body|max_size|staging.medversepk|medverse' /etc/caddy/Caddyfile 2>/dev/null | head -60 || true
find /etc/caddy -type f 2>/dev/null | head -20
echo --- recent staging next errors ---
journalctl -u medverse-staging-next.service -n 80 --no-pager 2>/dev/null | grep -Eiv 'Bearer|apikey|eyJ|sb_|password|secret' | tail -40
