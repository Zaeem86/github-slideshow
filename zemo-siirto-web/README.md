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

## Setup

1. Node.js 20.9+ → `npm install`
2. Create a Supabase project (EU region) and run the migrations **in order** (SQL Editor, or `supabase db push`):
   `supabase/migrations/20261116000000_base_schema.sql`, `…20261117000000_driver_jobs_and_earnings.sql`,
   `…20261118000000_app_api.sql`
3. `cp .env.example .env.local` and fill in the Project URL and the publishable (or anon) key from
   Project Settings → API. Never put the `service_role` / secret key in a `NEXT_PUBLIC_` variable.
4. Supabase → Authentication → URL Configuration: Site URL = your domain (e.g. `https://zemosiirto.fi`),
   and add `https://zemosiirto.fi/auth/callback` to Redirect URLs.
5. `npm run dev` → http://localhost:3000
6. First admin: sign up at `/customer/login`, then in the SQL Editor
   `update public.profiles set role = 'admin' where email = 'you@example.com';`

## Before launch

- **Payments are simulated** (`demo_pay_order`; card numbers never leave the browser). Connect Stripe or
  Paytrail with a server-side webhook, then `update public.app_settings set allow_demo_payments = false;`
- **Commission:** set in Admin → Pricing as the driver share (65% now ⇒ 35% commission; 85% ⇒ 15%).
- **Photos** (inspection, licence) are recorded by file name only – add Supabase Storage uploads.
- **Driver expenses** are in the database and included in payouts, but have no page yet.
- Review privacy notice, terms, insurance/liability, VAT treatment and driver contracts with Finnish advisers.

## Tests

| What | Command |
|---|---|
| Type check / lint / build | `npx tsc --noEmit` · `npm run lint` · `npm run build` |
| 47 SQL checks (roles, RLS, pricing, race rules, earnings, payouts) | `bash supabase/tests/run_local.sh` (needs local Postgres; run as a non-root user) |
| Browser end-to-end, all three portals | see below |

End-to-end against the real SQL, with the real `@supabase/ssr` client:

1. Start a throwaway Postgres; run `supabase/tests/local_supabase_stub.sql`, then the three migrations.
2. `PGHOST=… PGPORT=… PGUSER=… PGDATABASE=… node supabase/tests/fake-supabase/server.js 8790` –
   a local stand-in for Supabase Auth + REST (testing only, never deploy).
3. `NEXT_PUBLIC_SUPABASE_URL=http://localhost:8790 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=anon npm run build && npx next start -p 3100`
4. `node tests/e2e.js http://localhost:3100 http://localhost:8790` (Playwright)
