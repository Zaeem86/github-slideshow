#!/usr/bin/env bash
# Runs both browser end-to-end tests against the real SQL migrations:
# throwaway Postgres → Supabase stand-in → mock Trustly + mock Google Maps → production build of the app → Playwright.
#
#   bash tests/run_e2e.sh
#
# Uses an existing Postgres if PGHOST/PGPORT/PGUSER/PGDATABASE are set (the database must be empty);
# otherwise starts a temporary cluster (needs initdb/pg_ctl and a non-root user).
# Needs: node, npm dependencies installed, and Playwright with Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
PIDS=()
cleanup() {
  # The app runs in its own process group (setsid), so its child next-server stops too.
  if [ -n "${NEXT_PID:-}" ]; then kill -- "-$NEXT_PID" 2>/dev/null || true; fi
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  if [ -n "${OWN_PG:-}" ]; then "$PGBIN/pg_ctl" -D "$TMP/pg" stop -m fast >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

if [ -z "${PGHOST:-}" ]; then
  OWN_PG=1
  PGBIN="$(dirname "$(command -v pg_ctl || ls /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")"
  "$PGBIN/initdb" -D "$TMP/pg" -A trust >/dev/null
  "$PGBIN/pg_ctl" -D "$TMP/pg" -o "-p 5499 -k $TMP" -l "$TMP/pg.log" start >/dev/null
  export PGHOST="$TMP" PGPORT=5499 PGUSER="$(whoami)" PGDATABASE=postgres
fi
PSQL="psql -X -q -v ON_ERROR_STOP=1"
$PSQL -f tests/sql/local_supabase_stub.sql
for f in supabase/migrations/*.sql; do $PSQL -f "$f" >/dev/null; done

# Test keys: ours (merchant) and the mock Trustly's.
for n in merchant trustly; do
  openssl genrsa -out "$TMP/$n.key" 2048 2>/dev/null
  openssl rsa -in "$TMP/$n.key" -pubout -out "$TMP/$n.pub" 2>/dev/null
done

start_supabase() {
  FAKE_SERVICE_KEY=service-secret node tests/mocks/fake-supabase/server.js 8790 > "$TMP/supabase.log" 2>&1 &
  SB_PID=$!; PIDS+=("$SB_PID"); sleep 1
}
reset_data() {
  kill "$SB_PID" 2>/dev/null || true
  $PSQL -c "truncate auth.users cascade" -c "update public.app_settings set base_fee_cents = 4900" 2>&1 | grep -v NOTICE || true
  start_supabase
}

start_supabase
node tests/mocks/fake-google/server.js 8792 test-google-key > "$TMP/google.log" 2>&1 &
PIDS+=($!)
node tests/mocks/fake-trustly/server.js 8791 "$TMP/merchant.pub" "$TMP/trustly.key" zemo-test test-pass > "$TMP/trustly.log" 2>&1 &
PIDS+=($!)

NEXT_PUBLIC_SUPABASE_URL=http://localhost:8790 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=anon npx next build > "$TMP/build.log" 2>&1 \
  || { tail -40 "$TMP/build.log"; exit 1; }
GOOGLE_MAPS_SERVER_KEY=test-google-key GOOGLE_PLACES_URL=http://localhost:8792 GOOGLE_ROUTES_URL=http://localhost:8792 \
  SUPABASE_SERVICE_ROLE_KEY=service-secret APP_URL=http://localhost:3100 TRUSTLY_ENV=test \
  TRUSTLY_API_URL=http://localhost:8791/api/1 TRUSTLY_USERNAME=zemo-test TRUSTLY_PASSWORD=test-pass \
  TRUSTLY_PRIVATE_KEY="$(cat "$TMP/merchant.key")" TRUSTLY_PUBLIC_KEY="$(cat "$TMP/trustly.pub")" \
  setsid npx next start -p 3100 > "$TMP/next.log" 2>&1 &
NEXT_PID=$!; PIDS+=("$NEXT_PID")
for _ in $(seq 1 30); do curl -sf http://localhost:3100/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -s http://localhost:3100/api/health; echo

status=0
echo "=== payments (Trustly)"; node tests/e2e-payments.js http://localhost:3100 http://localhost:8790 http://localhost:8791 || status=1
reset_data
echo "=== all portals";       node tests/e2e.js http://localhost:3100 http://localhost:8790 || status=1
if [ $status -ne 0 ]; then echo "--- app log"; tail -40 "$TMP/next.log"; fi
exit $status
