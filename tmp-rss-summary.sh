#!/bin/bash
PID=$(systemctl show medverse-staging-next.service -p MainPID --value)
echo "PID=$PID"
echo "NOW_RSS_KB=$(ps -o rss= -p "$PID" | tr -d ' ')"
echo "TMP_MB=$(du -sm /tmp 2>/dev/null | cut -f1)"
echo "PROD=$(cat /opt/medverse/current/RELEASE_COMMIT)"
echo "STG=$(cat /opt/medverse-staging/current/RELEASE_COMMIT)"
echo "--- rss samples unique ---"
grep -o 'rss_kb=[0-9]*' /tmp/rss-u200.log | sort | uniq -c
