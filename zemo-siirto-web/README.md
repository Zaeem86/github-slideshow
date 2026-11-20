# Zemo Siirto – web app

Next.js 16 + TypeScript + Supabase (SSR auth with cookies). An approved independent driver drives the customer's
own car from pickup to destination – not vehicle transport by truck.

```
/                         landing page + instant price
/customer/  login · dashboard · create-order · pay/[id] · tracking
/driver/    login · available-jobs · my-jobs · inspection · navigation · earnings · profile
/admin/     login · dashboard · drivers · customers · orders · orders/[id] · pricing · payments · settings
/invoice/[id]             printable invoice (the order's customer or an admin)
/auth/callback            email confirmation links   ·   /auth/signout
```

## How it works

- **Reads:** each page calls `get_app_state()` once on the server (React `cache`), which returns only what the
  signed-in user may see. Portal layouts and pages redirect to the right login page.
- **Writes:** every form posts to a Server Action in `app/actions.ts`, which calls one role-checked database
  function (`supabase/migrations/20261118000000_app_api.sql`). The database decides what is allowed;
  results come back as `?ok=` / `?error=` and are shown at the top of the page.
- **Prices** are calculated in the database when the order is created; the browser only shows a live estimate.
- **Order flow:** create order → pay → driver accepts (`accept_transfer`) → pickup inspection → start driving →
  delivery inspection (`complete_transfer` books the driver's earnings) → admin pays out (`create_driver_payout`).

## Deploy

Step-by-step guide (Arabic): **[DEPLOY.md](DEPLOY.md)** – Supabase project, Vercel (root directory `zemo-siirto-web`,
region Stockholm), domain, first admin, Trustly. After deploying, `GET /api/health` must return `"ok": true`.

## Setup (local development)

1. Node.js 20.9+ → `npm install`
2. Create a Supabase project (EU region) and run the migrations **in order** (SQL Editor, or `supabase db push`):
   `supabase/migrations/20261116000000_base_schema.sql`, `…20261117000000_driver_jobs_and_earnings.sql`,
   `…20261118000000_app_api.sql`, `…20261119000000_payments_trustly.sql`
3. `cp .env.example .env.local` and fill in the Project URL and the publishable (or anon) key from
   Project Settings → API. Never put the `service_role` / secret key in a `NEXT_PUBLIC_` variable.
4. Supabase → Authentication → URL Configuration: Site URL = your domain (e.g. `https://zemosiirto.fi`),
   and add `https://zemosiirto.fi/auth/callback` to Redirect URLs.
5. `npm run dev` → http://localhost:3000
6. Server secrets (`SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`, `TRUSTLY_*`) go in your host's secret settings – see
   `.env.example` and **Payments** below.
7. First admin: sign up at `/customer/login`, then in the SQL Editor
   `update public.profiles set role = 'admin' where email = 'you@example.com';`

## Payments (Trustly bank payments)

The customer pays from their own online bank through Trustly; refunds go back the same way.

1. **Pay:** `startTrustlyPayment` creates a payment (`start_payment`), calls Trustly `Deposit` (signed with our
   private key, response verified with Trustly's public key) and sends the customer to Trustly.
2. **Confirm:** Trustly posts signed notifications to `/api/trustly/notifications`. The signature is verified,
   the event is stored once (`record_payment_event`, retries are ignored) and answered with our signed `OK`.
   Only a `credit` for the full amount marks the order paid; `debit` reverses it; `cancel` lets the customer retry.
3. **Refund:** Admin → Payments → *Refund via Trustly* calls Trustly `Refund` and records it (`complete_refund`).

To go live:
1. Sign a merchant agreement with Trustly; get API username/password and Trustly's public key (test and production).
2. Create an RSA key pair, give Trustly the **public** key, keep the private key in `TRUSTLY_PRIVATE_KEY`:
   `openssl genrsa -out merchant.key 2048 && openssl rsa -in merchant.key -pubout -out merchant.pub`
3. Set `TRUSTLY_*`, `APP_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the server; test with `TRUSTLY_ENV=test`.
4. Switch off demo payments: `update public.app_settings set allow_demo_payments = false;`

> The protocol (JSON-RPC 1.1, RSA-SHA1 over method + uuid + sorted serialized data, test/production endpoints,
> Deposit/Refund fields, the signed `OK` answer) was taken from the trustly-client library; Trustly's docs were not
> reachable while building this. **Confirm with Trustly** the notification field names (`notificationid`,
> `messageid`, `orderid`, `amount`, `currency`) and the Refund answer (`result: "1"`) during test-environment onboarding.

## Before launch

- **Payments:** see above – until Trustly is configured, only the demo payment (`demo_pay_order`) is available.
- **Commission:** set in Admin → Pricing as the driver share (65% now ⇒ 35% commission; 85% ⇒ 15%).
- **Photos** (inspection, licence) are recorded by file name only – add Supabase Storage uploads.
- **Driver expenses** are in the database and included in payouts, but have no page yet.
- Review privacy notice, terms, insurance/liability, VAT treatment and driver contracts with Finnish advisers.

## Tests

| What | Command |
|---|---|
| Type check / lint / build | `npx tsc --noEmit` · `npm run lint` · `npm run build` |
| 66 SQL checks (roles, RLS, pricing, race rules, earnings, payouts, payments, refunds) | `bash tests/sql/run_local.sh` (needs local Postgres; run as a non-root user) |
| Browser end-to-end, all portals + Trustly payments | `bash tests/run_e2e.sh` (starts everything below; also runs in GitHub Actions) |

End-to-end against the real SQL, with the real `@supabase/ssr` client:

1. Start a throwaway Postgres; run `tests/sql/local_supabase_stub.sql`, then the migrations in order.
2. `PGHOST=… PGPORT=… PGUSER=… PGDATABASE=… node tests/mocks/fake-supabase/server.js 8790` –
   a local stand-in for Supabase Auth + REST (testing only, never deploy).
3. `NEXT_PUBLIC_SUPABASE_URL=http://localhost:8790 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=anon npm run build && npx next start -p 3100`
4. `node tests/e2e.js http://localhost:3100 http://localhost:8790` (Playwright)

Payments end-to-end with the mock Trustly (`tests/mocks/fake-trustly/server.js`, testing only):

1. Create two key pairs (merchant, trustly) with the `openssl` commands above.
2. Start the Supabase stand-in with `FAKE_SERVICE_KEY=service-secret`, and the mock:
   `node tests/mocks/fake-trustly/server.js 8791 merchant.pub trustly.key zemo-test test-pass`
3. Start the app with `SUPABASE_SERVICE_ROLE_KEY=service-secret APP_URL=http://localhost:3100 TRUSTLY_API_URL=http://localhost:8791/api/1
   TRUSTLY_USERNAME=zemo-test TRUSTLY_PASSWORD=test-pass TRUSTLY_PRIVATE_KEY="$(cat merchant.key)" TRUSTLY_PUBLIC_KEY="$(cat trustly.pub)"`
4. `node tests/e2e-payments.js http://localhost:3100 http://localhost:8790 http://localhost:8791`
