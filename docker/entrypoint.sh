#!/usr/bin/env bash
set -euo pipefail

service cron start

if [[ "${INIT_STORAGE_ON_START:-true}" == "true" && -n "${MYSQL_HOST:-}" && -n "${MINIO_ENDPOINT:-}" ]]; then
  for attempt in {1..30}; do
    if node /app/scripts/init-storage.mjs; then
      break
    fi

    if [[ "$attempt" == "30" ]]; then
      echo "Storage initialization failed after ${attempt} attempts" >&2
      exit 1
    fi

    echo "Storage is not ready yet; retrying in 2s (${attempt}/30)"
    sleep 2
  done
fi

cd /app/web
exec npm run start -- --hostname 0.0.0.0
