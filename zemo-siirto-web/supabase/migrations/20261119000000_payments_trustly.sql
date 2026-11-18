-- ZEMO SIIRTO – real payments (Trustly bank payments) and refunds.
--
-- Flow:
--   1. Customer clicks "Pay with your bank": the app calls start_payment() as the customer,
--      which creates a payments row. Its id is sent to Trustly as MessageID.
--   2. The app server calls Trustly Deposit and stores Trustly's orderid with attach_provider_order()
--      (service role only), then redirects the customer to Trustly.
--   3. Trustly sends signed notifications (pending / credit / cancel / debit) to the app.
--      The app verifies the signature and calls record_payment_event() (service role only).
--      Only a verified "credit" for the full amount marks the order as paid.
--   4. Refunds: admin_refund_info() (admin) → Trustly Refund → complete_refund() (service role only).
--
-- Functions marked "service role only" cannot be called by browsers or signed-in users; the app
-- calls them from the server with SUPABASE_SERVICE_ROLE_KEY.

-- Orders can now be paid with Trustly.
alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
  check (payment_method in ('card', 'mobilepay', 'invoice', 'trustly'));

create table public.payments (
  id uuid primary key default gen_random_uuid(),            -- sent to Trustly as MessageID
  order_id uuid not null references public.orders(id),
  provider text not null check (provider in ('trustly')),
  provider_order_id text unique,                              -- Trustly orderid
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  status text not null default 'initiated'
    check (status in ('initiated', 'pending', 'paid', 'cancelled', 'failed', 'debited', 'refunded')),
  checkout_url text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_idx on public.payments (order_id);

-- Every provider notification, stored once (providers retry, so duplicates are expected).
create table public.payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid references public.payments(id),
  provider text not null,
  provider_notification_id text not null,
  method text not null,
  amount_cents bigint,
  currency text,
  payload jsonb not null,
  outcome text not null,
  created_at timestamptz not null default now(),
  unique (provider, provider_notification_id)
);

create index payment_events_payment_idx on public.payment_events (payment_id);

alter table public.payments enable row level security;
alter table public.payment_events enable row level security;

create policy "Customers read payments of own orders, admins read all" on public.payments
  for select to authenticated
  using ((select public.is_admin()) or exists (
    select 1 from public.orders o where o.id = payments.order_id and o.customer_id = (select auth.uid())));

create policy "Admins read payment events" on public.payment_events
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- 1. Customer starts a payment
-- ---------------------------------------------------------------------------
create or replace function public.start_payment(p_order uuid, p_provider text default 'trustly')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('customer');
  o public.orders;
  c public.profiles;
  v_id uuid;
begin
  if p_provider <> 'trustly' then raise exception 'Unknown payment provider'; end if;
  select * into o from public.orders where id = p_order and customer_id = v_uid for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'pending_payment' then raise exception 'This order is already paid'; end if;
  if exists (select 1 from public.payments where order_id = p_order and status in ('pending', 'paid')) then
    raise exception 'A payment for this order is already being processed';
  end if;

  -- Earlier unfinished attempts are abandoned.
  update public.payments set status = 'cancelled', updated_at = now()
  where order_id = p_order and status = 'initiated';

  insert into public.payments (order_id, provider, amount_cents)
  values (p_order, p_provider, o.price_total_cents)
  returning id into v_id;

  select * into c from public.profiles where id = v_uid;
  return jsonb_build_object(
    'payment_id', v_id, 'order_number', 'ZS-' || o.order_number, 'amount_cents', o.price_total_cents,
    'currency', 'EUR', 'customer_id', v_uid, 'email', c.email, 'full_name', c.full_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Server stores the provider's order id (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.attach_provider_order(p_payment uuid, p_provider_order_id text, p_checkout_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set provider_order_id = p_provider_order_id, checkout_url = p_checkout_url, updated_at = now()
  where id = p_payment and status = 'initiated' and provider_order_id is null;
  if not found then raise exception 'Payment not found or already started'; end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Verified provider notification (service role only). Idempotent.
--    Returns the outcome so the caller can log it.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_event(
  p_provider text,
  p_notification_id text,
  p_method text,
  p_message_id text,
  p_provider_order_id text,
  p_amount_cents bigint,
  p_currency text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments;
  o public.orders;
  v_outcome text;
begin
  if exists (select 1 from public.payment_events where provider = p_provider and provider_notification_id = p_notification_id) then
    return 'duplicate';
  end if;

  select * into pay from public.payments
  where provider = p_provider
    and (id::text = p_message_id or (p_provider_order_id is not null and provider_order_id = p_provider_order_id))
  for update;

  if not found then
    v_outcome := 'unknown_payment';
  elsif pay.provider_order_id is not null and p_provider_order_id is not null and pay.provider_order_id <> p_provider_order_id then
    v_outcome := 'order_id_mismatch';
  else
    select * into o from public.orders where id = pay.order_id for update;

    if p_method = 'pending' then
      if pay.status = 'initiated' then
        update public.payments set status = 'pending', updated_at = now() where id = pay.id;
      end if;
      v_outcome := 'pending';

    elsif p_method = 'credit' then
      if p_currency is distinct from pay.currency or p_amount_cents is null or p_amount_cents < pay.amount_cents then
        v_outcome := 'amount_mismatch';           -- money arrived but not the expected amount: admin must check
      elsif pay.status = 'paid' then
        v_outcome := 'already_paid';
      else
        update public.payments set status = 'paid', paid_at = now(), updated_at = now() where id = pay.id;
        if o.status = 'pending_payment' then
          update public.orders set status = 'open', paid_at = now(), payment_method = 'trustly', payment_last4 = null
          where id = o.id;
          perform public._event(o.id, null, 'payment_received', 'open');
          v_outcome := 'paid';
        else
          -- Paid after the order was cancelled (or paid twice): money must be returned.
          update public.orders set paid_at = coalesce(paid_at, now()), payment_method = coalesce(payment_method, 'trustly')
          where id = o.id;
          v_outcome := 'paid_but_order_' || o.status;
        end if;
      end if;

    elsif p_method = 'cancel' then
      if pay.status in ('initiated', 'pending') then
        update public.payments set status = 'cancelled', updated_at = now() where id = pay.id;
      end if;
      v_outcome := 'cancelled';

    elsif p_method = 'debit' then
      -- Money taken back after a credit (e.g. the bank reversed it).
      update public.payments set status = 'debited', updated_at = now() where id = pay.id;
      if o.status = 'open' and o.payment_method = 'trustly' then
        update public.orders set status = 'pending_payment', paid_at = null, payment_method = null where id = o.id;
        perform public._event(o.id, null, 'payment_reversed', 'pending_payment');
      end if;
      v_outcome := 'debited';

    else
      v_outcome := 'ignored_' || p_method;
    end if;
  end if;

  insert into public.payment_events (payment_id, provider, provider_notification_id, method, amount_cents, currency, payload, outcome)
  values (pay.id, p_provider, p_notification_id, p_method, p_amount_cents, p_currency, p_payload, v_outcome);
  return v_outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Refunds
-- ---------------------------------------------------------------------------
-- Admin asks what to refund (checks it is allowed); the server then calls the provider.
create or replace function public.admin_refund_info(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pay public.payments;
  o public.orders;
begin
  perform public._require_role('admin');
  select * into o from public.orders where id = p_order;
  if not found or o.status <> 'cancelled' or o.paid_at is null or o.refunded_at is not null then
    raise exception 'Nothing to refund on this order';
  end if;
  select * into pay from public.payments where order_id = p_order and status = 'paid' order by paid_at desc limit 1;
  if not found or pay.provider_order_id is null then raise exception 'No online payment found for this order'; end if;
  return jsonb_build_object('payment_id', pay.id, 'provider', pay.provider, 'provider_order_id', pay.provider_order_id,
    'amount_cents', pay.amount_cents, 'currency', pay.currency);
end;
$$;

-- Server records a refund the provider accepted (service role only).
create or replace function public.complete_refund(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments;
begin
  select * into pay from public.payments where id = p_payment and status = 'paid' for update;
  if not found then raise exception 'Payment not found or not refundable'; end if;
  update public.payments set status = 'refunded', refunded_at = now(), updated_at = now() where id = p_payment;
  update public.orders set refunded_at = now() where id = pay.order_id and status = 'cancelled' and refunded_at is null;
  perform public._event(pay.order_id, null, 'refunded_online', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Show the latest payment attempt in the app state (adds "paymentStatus").
-- ---------------------------------------------------------------------------
create or replace function public._payment_status(p_order uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.status from public.payments p where p.order_id = p_order order by p.created_at desc limit 1;
$$;

create or replace function public._order_json(o public.orders, p_uid uuid, p_role text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with v as (select (p_role = 'driver' and o.assigned_driver_id is distinct from p_uid) as redact)
  select jsonb_build_object(
    'id', 'ZS-' || o.order_number,
    'uuid', o.id,
    'createdAt', o.created_at,
    'customerId', o.customer_id,
    'customer', case when v.redact then jsonb_build_object('name', '', 'email', '', 'phone', '', 'company', '')
      else (select jsonb_build_object('name', c.full_name, 'email', c.email, 'phone', c.phone, 'company', c.company)
            from public.profiles c where c.id = o.customer_id) end,
    'pickup', jsonb_build_object('city', o.pickup_city, 'address', o.pickup_address,
      'date', to_char(o.pickup_date, 'YYYY-MM-DD'), 'time', to_char(o.pickup_time, 'HH24:MI'),
      'contact', case when v.redact then '' else o.pickup_contact end),
    'dropoff', jsonb_build_object('city', o.dropoff_city, 'address', o.dropoff_address,
      'contact', case when v.redact then '' else o.dropoff_contact end),
    'car', jsonb_build_object('model', o.car_model, 'plate', o.car_plate, 'gearbox', o.gearbox, 'fuel', o.fuel),
    'notes', o.notes,
    'price', jsonb_build_object('km', o.distance_km, 'net', o.price_net_cents / 100.0, 'vat', o.vat_cents / 100.0,
      'total', o.price_total_cents / 100.0, 'vatRate', o.vat_rate, 'driverShare', o.driver_share),
    'status', o.status,
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at) order by e.id)
      from public.order_events e where e.order_id = o.id and e.status is not null), '[]'::jsonb),
    'driverId', coalesce(o.assigned_driver_id::text, ''),
    'rejectedBy', coalesce((select jsonb_agg(r.driver_id) from public.job_rejections r
      where r.order_id = o.id and (p_role = 'admin' or r.driver_id = p_uid)), '[]'::jsonb),
    'inspection', coalesce((select jsonb_object_agg(i.stage, jsonb_build_object(
        'at', i.created_at, 'odo', i.odometer_km, 'fuel', i.fuel_level, 'keys', i.keys_count,
        'docs', i.documents_present, 'areas', i.areas, 'notes', i.notes,
        'photos', to_jsonb(i.photo_paths), 'person', i.person_name))
      from public.inspections i where i.order_id = o.id), '{}'::jsonb),
    'payment', case when o.paid_at is null then null
      else jsonb_build_object('method', o.payment_method, 'last4', o.payment_last4, 'paidAt', o.paid_at) end,
    'paymentStatus', case when v.redact then null else public._payment_status(o.id) end,
    'refundedAt', o.refunded_at,
    'driverPaidAt', (select p.paid_at from public.driver_earnings de
      join public.driver_payouts p on p.id = de.payout_id
      where de.order_id = o.id and p.status = 'paid')
  )
  from v;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
revoke all on function public.start_payment(uuid, text) from public, anon;
grant execute on function public.start_payment(uuid, text) to authenticated;
revoke all on function public.admin_refund_info(uuid) from public, anon;
grant execute on function public.admin_refund_info(uuid) to authenticated;

-- Service role only (the app server, after verifying the provider's signature).
revoke all on function public.attach_provider_order(uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_payment_event(text, text, text, text, text, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_refund(uuid) from public, anon, authenticated;
revoke all on function public._payment_status(uuid) from public, anon, authenticated;
revoke all on function public._order_json(public.orders, uuid, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.attach_provider_order(uuid, text, text) to service_role;
    grant execute on function public.record_payment_event(text, text, text, text, text, bigint, text, jsonb) to service_role;
    grant execute on function public.complete_refund(uuid) to service_role;
  end if;
end;
$$;
