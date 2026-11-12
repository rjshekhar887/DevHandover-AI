#!/bin/sh
set -eu

mkdir -p /app/data
npm run db:push --workspace=apps/backend

if [ "${DEMO_MODE:-false}" = "true" ]; then
  npm run db:seed --workspace=apps/backend
fi

exec "$@"
