#!/bin/bash
journalctl -u medverse-staging-next.service --since "20 min ago" --no-pager | grep -Eiv 'Bearer|apikey|eyJ|sb_|password|secret' | tail -50
echo ---LIMITS---
python3 <<'PY'
import json
d=json.load(open('/opt/medverse-staging/current/.next/required-server-files.json'))
e=(d.get('config') or d).get('experimental') or {}
print('serverActions', e.get('serverActions'))
print('proxy', e.get('proxyClientMaxBodySize'))
print('commit', open('/opt/medverse-staging/current/RELEASE_COMMIT').read().strip())
PY
echo ---CADDY---
sed -n '60,120p' /etc/caddy/Caddyfile
