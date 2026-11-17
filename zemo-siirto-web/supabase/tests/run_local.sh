#!/usr/bin/env bash
# Runs the migrations + API tests on a throwaway local Postgres (needs initdb/pg_ctl/psql).
# Usage: bash run_local.sh [port]   – run as a non-root user (e.g. su postgres -c "bash run_local.sh").
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-5499}"
BIN="$(dirname "$(command -v pg_ctl || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")"
TMP="$(mktemp -d)"
trap '"$BIN/pg_ctl" -D "$TMP/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"$BIN/initdb" -D "$TMP/data" -A trust >/dev/null
"$BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP" -l "$TMP/log" start >/dev/null
PSQL="psql -X -q -v ON_ERROR_STOP=1 -h $TMP -p $PORT -d postgres"
$PSQL -f "$HERE/local_supabase_stub.sql"
for f in "$HERE"/../migrations/*.sql; do $PSQL -f "$f" >/dev/null; done
OUT="$($PSQL -f "$HERE/api_test.sql")"
echo "$OUT"
echo "---"; echo "$(grep -c '^PASS' <<<"$OUT") passed, $(grep -c '^FAIL' <<<"$OUT" || true) failed"
! grep -q '^FAIL' <<<"$OUT"
