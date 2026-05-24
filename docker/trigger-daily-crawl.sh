#!/usr/bin/env bash
set -euo pipefail

curl -fsS \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"triggerType":"cron"}' \
  "http://127.0.0.1:${PORT:-3000}/api/crawl/daily"
