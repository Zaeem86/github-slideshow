-- ZEMO SIIRTO – application API.
--
-- The website calls only these functions (via supabase.rpc). Each one is
-- SECURITY DEFINER, checks who the caller is (auth.uid() + profiles.role) and the
-- current order state, and writes the order event log. Functions starting with
-- "_" and complete_transfer are internal and cannot be called by clients.

-- ===========================================================================
-- Internal helpers
-- ===========================================================================
create or replace function public._require_role(p_role text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and role = p_role) then
    raise exception 'Your account is not allowed to do this' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public._require_approved_driver()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('driver');
begin
  if not exists (select 1 from public.driver_profiles where user_id = v_uid and review_status = 'approved') then
    raise exception 'Your driver account is not approved' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Distance-based price, same formula as the website's live quote.
create or replace function public._quote(p_from text, p_to text)
returns table (km integer, net_cents bigint, vat_cents bigint, total_cents bigint, vat_rate numeric, driver_share numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.cities;
  b public.cities;
  s public.app_settings;
  d double precision;
begin
  select * into a from public.cities c where c.name = p_from;
  if not found then raise exception 'Unknown pickup city'; end if;
  select * into b from public.cities c where c.name = p_to;
  if not found then raise exception 'Unknown delivery city'; end if;
  select * into s from public.app_settings x where x.id = 1;

  if p_from = p_to then
    km := s.same_city_km;
  else
    d := 2 * 6371 * asin(sqrt(
      power(sin(radians(b.lat - a.lat) / 2), 2) +
      cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lon - a.lon) / 2), 2)));
    km := round((d * s.road_factor)::numeric);
  end if;

  net_cents := greatest(s.min_price_cents, s.base_fee_cents + s.per_km_cents * km);
  vat_cents := round(net_cents * s.vat_rate / 100);
  total_cents := net_cents + vat_cents;
  vat_rate := s.vat_rate;
  driver_share := s.driver_share;
  return next;
end;
$$;

create or replace function public._event(p_order uuid, p_actor uuid, p_type text, p_status text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.order_events (order_id, actor_id, event_type, status)
  values (p_order, p_actor, p_type, p_status);
$$;

-- One order as JSON, shaped for the website. Drivers who are not assigned to the
-- order don't get the customer's personal details or contact people.
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
    'refundedAt', o.refunded_at,
    'driverPaidAt', (select p.paid_at from public.driver_earnings de
      join public.driver_payouts p on p.id = de.payout_id
      where de.order_id = o.id and p.status = 'paid')
  )
  from v;
$$;

-- ===========================================================================
-- Read: everything the signed-in user may see, in one call
-- ===========================================================================
create or replace function public.get_app_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_email text;
  s public.app_settings;
  v_orders jsonb;
  v_drivers jsonb;
  v_customers jsonb;
begin
  select * into s from public.app_settings x where x.id = 1;
  if v_uid is not null then
    select p.role, p.email into v_role, v_email from public.profiles p where p.id = v_uid;
  end if;

  select coalesce(jsonb_agg(public._order_json(o, v_uid, v_role) order by o.order_number), '[]'::jsonb)
  into v_orders
  from public.orders o
  where v_role = 'admin'
     or (v_role = 'customer' and o.customer_id = v_uid)
     or (v_role = 'driver' and (
          o.assigned_driver_id = v_uid
          or (o.status = 'open' and exists (
                select 1 from public.driver_profiles d where d.user_id = v_uid and d.review_status = 'approved'))));

  if v_role in ('admin', 'driver') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'status', d.review_status, 'name', p.full_name, 'email', p.email, 'phone', p.phone,
      'city', coalesce(d.home_city, ''), 'dob', coalesce(to_char(d.date_of_birth, 'YYYY-MM-DD'), ''),
      'licenseNo', d.license_number, 'licenseClass', d.license_class,
      'licenseExpiry', coalesce(to_char(d.license_expiry, 'YYYY-MM-DD'), ''),
      'iban', d.iban, 'licensePhoto', coalesce(d.license_photo_path, ''), 'createdAt', p.created_at
    ) order by p.created_at), '[]'::jsonb)
    into v_drivers
    from public.profiles p join public.driver_profiles d on d.user_id = p.id
    where v_role = 'admin' or p.id = v_uid;
  elsif v_role = 'customer' then
    -- Only the drivers of the customer's own orders, name and phone only.
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'status', 'approved', 'name', p.full_name, 'phone', p.phone)), '[]'::jsonb)
    into v_drivers
    from public.profiles p
    where p.id in (select o.assigned_driver_id from public.orders o where o.customer_id = v_uid);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone, 'company', p.company, 'createdAt', p.created_at
  ) order by p.created_at), '[]'::jsonb)
  into v_customers
  from public.profiles p
  where p.role = 'customer' and (v_role = 'admin' or (v_role = 'customer' and p.id = v_uid));

  return jsonb_build_object(
    'remote', true,
    'settings', jsonb_build_object(
      'baseFee', s.base_fee_cents / 100.0, 'perKm', s.per_km_cents / 100.0, 'minPrice', s.min_price_cents / 100.0,
      'vatRate', s.vat_rate, 'driverShare', s.driver_share, 'roadFactor', s.road_factor, 'sameCityKm', s.same_city_km,
      'demoPayments', s.allow_demo_payments),
    'company', jsonb_build_object(
      'name', s.company_name, 'businessId', s.company_business_id, 'email', s.company_email,
      'phone', s.company_phone, 'address', s.company_address, 'iban', s.company_iban),
    'session', jsonb_build_object(
      'customerId', case when v_role = 'customer' then v_uid::text else '' end,
      'driverId', case when v_role = 'driver' then v_uid::text else '' end,
      'admin', coalesce(v_role = 'admin', false)),
    'admin', case when v_role = 'admin' then jsonb_build_object('email', v_email) else null end,
    'orders', v_orders,
    'drivers', coalesce(v_drivers, '[]'::jsonb),
    'customers', v_customers
  );
end;
$$;

-- ===========================================================================
-- Customer actions
-- ===========================================================================
create or replace function public.create_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('customer');
  q record;
  v_id uuid;
  v_no bigint;
  v_date date := public._try_date(p->>'pickup_date');
begin
  if v_date is null or v_date < (now() at time zone 'Europe/Helsinki')::date then
    raise exception 'Pickup date must be today or later';
  end if;
  if coalesce(trim(p->>'pickup_address'), '') = '' or coalesce(trim(p->>'dropoff_address'), '') = ''
     or coalesce(trim(p->>'car_model'), '') = '' or coalesce(trim(p->>'car_plate'), '') = '' then
    raise exception 'Please fill in the addresses and the vehicle';
  end if;

  select * into q from public._quote(p->>'pickup_city', p->>'dropoff_city');

  insert into public.orders (
    customer_id, pickup_city, pickup_address, pickup_date, pickup_time, pickup_contact,
    dropoff_city, dropoff_address, dropoff_contact, car_model, car_plate, gearbox, fuel, notes,
    distance_km, price_net_cents, vat_rate, vat_cents, price_total_cents, driver_share)
  values (
    v_uid, p->>'pickup_city', trim(p->>'pickup_address'), v_date, coalesce((p->>'pickup_time')::time, '09:00'),
    coalesce(trim(p->>'pickup_contact'), ''),
    p->>'dropoff_city', trim(p->>'dropoff_address'), coalesce(trim(p->>'dropoff_contact'), ''),
    trim(p->>'car_model'), upper(trim(p->>'car_plate')), coalesce(p->>'gearbox', 'Automatic'),
    coalesce(p->>'fuel', 'Petrol'), coalesce(trim(p->>'notes'), ''),
    q.km, q.net_cents, q.vat_rate, q.vat_cents, q.total_cents, q.driver_share)
  returning id, order_number into v_id, v_no;

  perform public._event(v_id, v_uid, 'order_created', 'pending_payment');
  return jsonb_build_object('id', 'ZS-' || v_no, 'uuid', v_id);
end;
$$;

-- DEMO ONLY: marks the customer's own order as paid. Turn off with
--   update public.app_settings set allow_demo_payments = false;
-- and confirm payments from a payment-provider webhook (service role) instead.
create or replace function public.demo_pay_order(p_order uuid, p_method text, p_last4 text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('customer');
  v_status text;
begin
  if not (select allow_demo_payments from public.app_settings where id = 1) then
    raise exception 'Online payment is not available yet';
  end if;
  select status into v_status from public.orders where id = p_order and customer_id = v_uid for update;
  if not found then raise exception 'Order not found'; end if;
  if v_status <> 'pending_payment' then raise exception 'This order is already paid'; end if;
  if p_method not in ('card', 'mobilepay', 'invoice') then raise exception 'Unknown payment method'; end if;

  update public.orders
  set status = 'open', paid_at = now(), payment_method = p_method,
      payment_last4 = case when p_method = 'card' then p_last4 end
  where id = p_order;
  perform public._event(p_order, v_uid, 'payment_received', 'open');
end;
$$;

-- Customers cancel before a driver is assigned; admins cancel anything not finished.
create or replace function public.cancel_order(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.is_admin();
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not (v_admin or o.customer_id = v_uid) then raise exception 'Order not found'; end if;
  if v_admin then
    if o.status in ('delivered', 'cancelled') then raise exception 'This order can no longer be cancelled'; end if;
  elsif o.status not in ('pending_payment', 'open') then
    raise exception 'A driver is already on the way – please contact us to cancel';
  end if;

  update public.order_assignments
  set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'order_cancelled'
  where order_id = p_order and status in ('accepted', 'in_progress');

  update public.orders set status = 'cancelled' where id = p_order;
  perform public._event(p_order, v_uid, 'order_cancelled', 'cancelled');
end;
$$;

create or replace function public.update_my_profile(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in first'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  update public.profiles
  set full_name = left(trim(p->>'name'), 200),
      phone = left(coalesce(trim(p->>'phone'), phone), 50),
      company = left(coalesce(trim(p->>'company'), company), 200)
  where id = v_uid;
end;
$$;

-- ===========================================================================
-- Driver actions
-- ===========================================================================

-- Redefined from 20261117000000 so the event also records the new status.
create or replace function public.accept_transfer(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver_id uuid;
  v_status text;
begin
  select p.id
  into v_driver_id
  from public.profiles p
  join public.driver_profiles d on d.user_id = p.id
  where p.id = auth.uid()
    and p.role = 'driver'
    and d.review_status = 'approved'
    and d.is_available = true;

  if v_driver_id is null then
    return jsonb_build_object('success', false, 'message', 'Driver is not approved or available');
  end if;

  select o.status into v_status from public.orders o where o.id = p_order_id for update;

  if not found or v_status <> 'open' then
    return jsonb_build_object('success', false, 'message', 'Job is no longer available');
  end if;

  if exists (select 1 from public.order_assignments a where a.order_id = p_order_id and a.driver_id = v_driver_id) then
    return jsonb_build_object('success', false, 'message', 'You have already claimed this job once');
  end if;

  insert into public.order_assignments (order_id, driver_id, status) values (p_order_id, v_driver_id, 'accepted');

  update public.orders
  set status = 'assigned', assigned_driver_id = v_driver_id, assigned_at = now()
  where id = p_order_id;

  insert into public.order_events (order_id, actor_id, event_type, status, created_at)
  values (p_order_id, v_driver_id, 'driver_accepted', 'assigned', now());

  return jsonb_build_object('success', true, 'message', 'Job successfully assigned');
exception
  when unique_violation then
    return jsonb_build_object('success', false, 'message', 'Job was already accepted');
end;
$$;

create or replace function public.reject_transfer(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_approved_driver();
begin
  if not exists (select 1 from public.orders where id = p_order and status = 'open') then
    raise exception 'Job is no longer available';
  end if;
  insert into public.job_rejections (order_id, driver_id) values (p_order, v_uid) on conflict do nothing;
end;
$$;

-- Give an accepted (not yet picked up) job back to the pool.
create or replace function public.release_transfer(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('driver');
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.assigned_driver_id is distinct from v_uid then raise exception 'Not your job'; end if;
  if o.status <> 'assigned' then raise exception 'The car is already picked up – contact support'; end if;

  update public.order_assignments
  set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'released_by_driver'
  where order_id = p_order and driver_id = v_uid and status = 'accepted';

  update public.orders set status = 'open', assigned_driver_id = null, assigned_at = null where id = p_order;
  insert into public.job_rejections (order_id, driver_id) values (p_order, v_uid) on conflict do nothing;
  perform public._event(p_order, v_uid, 'driver_released', 'open');
end;
$$;

create or replace function public.start_transfer(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('driver');
  o public.orders;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.assigned_driver_id is distinct from v_uid then raise exception 'Not your job'; end if;
  if o.status <> 'picked_up' then raise exception 'Record the pickup inspection first'; end if;
  update public.orders set status = 'in_transit' where id = p_order;
  perform public._event(p_order, v_uid, 'driving_started', 'in_transit');
end;
$$;

-- Internal: finish a transfer and book the driver's earnings.
-- gross = order price excl. VAT, net = driver's share, commission = platform's part.
create or replace function public.complete_transfer(p_order_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_net bigint;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status not in ('picked_up', 'in_transit') then raise exception 'Order is not in transit'; end if;

  update public.orders set status = 'delivered' where id = p_order_id;

  update public.order_assignments
  set status = 'completed'
  where order_id = p_order_id and driver_id = o.assigned_driver_id and status in ('accepted', 'in_progress');

  v_net := round(o.price_net_cents * o.driver_share / 100);
  insert into public.driver_earnings (driver_id, order_id, gross_amount_cents, commission_cents, net_amount_cents)
  values (o.assigned_driver_id, p_order_id, o.price_net_cents, o.price_net_cents - v_net, v_net);

  perform public._event(p_order_id, coalesce(p_actor, o.assigned_driver_id), 'delivered', 'delivered');
end;
$$;

create or replace function public.record_inspection(p_order uuid, p_stage text, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_approved_driver();
  o public.orders;
  v_pickup_odo integer;
  v_odo integer := (p->>'odometer_km')::integer;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.assigned_driver_id is distinct from v_uid then raise exception 'Not your job'; end if;
  if p_stage = 'pickup' and o.status <> 'assigned' then raise exception 'Pickup is already recorded'; end if;
  if p_stage = 'delivery' and o.status not in ('picked_up', 'in_transit') then raise exception 'Record the pickup first'; end if;
  if p_stage not in ('pickup', 'delivery') then raise exception 'Unknown inspection stage'; end if;
  if v_odo is null or v_odo < 0 then raise exception 'Odometer reading is required'; end if;
  if coalesce(trim(p->>'person_name'), '') = '' then raise exception 'Name of the person handing over / receiving is required'; end if;

  if p_stage = 'delivery' then
    select odometer_km into v_pickup_odo from public.inspections where order_id = p_order and stage = 'pickup';
    if v_odo < coalesce(v_pickup_odo, 0) then raise exception 'Odometer is lower than at pickup'; end if;
  end if;

  insert into public.inspections (order_id, stage, driver_id, odometer_km, fuel_level, keys_count,
                                  documents_present, areas, notes, photo_paths, person_name)
  values (p_order, p_stage, v_uid, v_odo, p->>'fuel_level',
          case when p_stage = 'pickup' then (p->>'keys_count')::integer end,
          coalesce((p->>'documents_present')::boolean, false),
          coalesce(p->'areas', '{}'::jsonb), coalesce(trim(p->>'notes'), ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p->'photo_paths') x), '{}'),
          trim(p->>'person_name'));

  if p_stage = 'pickup' then
    update public.orders set status = 'picked_up' where id = p_order;
    update public.order_assignments set status = 'in_progress'
      where order_id = p_order and driver_id = v_uid and status = 'accepted';
    perform public._event(p_order, v_uid, 'pickup_inspected', 'picked_up');
  else
    perform public.complete_transfer(p_order, v_uid);
  end if;
end;
$$;

create or replace function public.update_driver_profile(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('driver');
  v_iban text := upper(replace(coalesce(p->>'iban', ''), ' ', ''));
begin
  if v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$' then raise exception 'Invalid IBAN'; end if;
  if not exists (select 1 from public.cities where name = p->>'city') then raise exception 'Unknown city'; end if;
  update public.profiles set phone = left(coalesce(trim(p->>'phone'), phone), 50) where id = v_uid;
  update public.driver_profiles set home_city = p->>'city', iban = v_iban where user_id = v_uid;
end;
$$;

-- ===========================================================================
-- Payouts
-- ===========================================================================

-- Group a driver's pending earnings (and approved, unpaid expenses) up to
-- p_period_end into a payout. An open payout for the same period is topped up.
create or replace function public.create_driver_payout(
  p_driver uuid,
  p_period_end date default null,
  p_mark_paid boolean default false,
  p_provider_transfer_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end date := coalesce(p_period_end, (now() at time zone 'Europe/Helsinki')::date);
  v_start date;
  v_earn bigint;
  v_exp bigint;
  v_exp_start date;
  v_payout uuid;
begin
  perform public._require_role('admin');

  select min((e.completed_at at time zone 'Europe/Helsinki')::date), coalesce(sum(e.net_amount_cents), 0)
  into v_start, v_earn
  from public.driver_earnings e
  where e.driver_id = p_driver and e.status = 'pending'
    and (e.completed_at at time zone 'Europe/Helsinki')::date <= v_end;

  select min((x.created_at at time zone 'Europe/Helsinki')::date), coalesce(sum(x.amount_cents), 0)
  into v_exp_start, v_exp
  from public.driver_expenses x
  where x.driver_id = p_driver and x.approval_status = 'approved' and x.payout_id is null
    and (x.created_at at time zone 'Europe/Helsinki')::date <= v_end;

  if v_earn = 0 and v_exp = 0 then raise exception 'Nothing to pay out for this driver'; end if;
  v_start := least(coalesce(v_start, v_exp_start), coalesce(v_exp_start, v_start));

  select id into v_payout from public.driver_payouts
  where driver_id = p_driver and period_start = v_start and period_end = v_end and status in ('pending', 'processing')
  for update;

  if v_payout is null then
    if exists (select 1 from public.driver_payouts where driver_id = p_driver and period_start = v_start and period_end = v_end) then
      raise exception 'A payout for % – % already exists; new earnings go into the next payout period', v_start, v_end;
    end if;
    insert into public.driver_payouts (driver_id, period_start, period_end, total_earnings_cents,
                                       expense_reimbursements_cents, payout_amount_cents, requested_at)
    values (p_driver, v_start, v_end, v_earn, v_exp, v_earn + v_exp, now())
    returning id into v_payout;
  else
    update public.driver_payouts
    set total_earnings_cents = total_earnings_cents + v_earn,
        expense_reimbursements_cents = expense_reimbursements_cents + v_exp,
        payout_amount_cents = payout_amount_cents + v_earn + v_exp
    where id = v_payout;
  end if;

  update public.driver_earnings e set status = 'in_payout', payout_id = v_payout
  where e.driver_id = p_driver and e.status = 'pending'
    and (e.completed_at at time zone 'Europe/Helsinki')::date <= v_end;

  update public.driver_expenses x set payout_id = v_payout
  where x.driver_id = p_driver and x.approval_status = 'approved' and x.payout_id is null
    and (x.created_at at time zone 'Europe/Helsinki')::date <= v_end;

  if p_mark_paid then
    perform public.mark_payout_paid(v_payout, p_provider_transfer_id);
  end if;
  return v_payout;
end;
$$;

create or replace function public.mark_payout_paid(p_payout uuid, p_provider_transfer_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_role('admin');
  update public.driver_payouts
  set status = 'paid', paid_at = now(), provider_transfer_id = coalesce(p_provider_transfer_id, provider_transfer_id)
  where id = p_payout and status in ('pending', 'processing');
  if not found then raise exception 'Payout not found or already paid'; end if;
  update public.driver_earnings set status = 'paid' where payout_id = p_payout;
end;
$$;

-- ===========================================================================
-- Admin actions
-- ===========================================================================
create or replace function public.admin_set_driver_status(p_driver uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.driver_profiles;
begin
  perform public._require_role('admin');
  select * into d from public.driver_profiles where user_id = p_driver for update;
  if not found then raise exception 'Driver not found'; end if;
  if p_status = 'approved' then
    if d.license_expiry is null or d.license_expiry < current_date then raise exception 'Driving licence is missing or expired'; end if;
    if d.date_of_birth is null or d.date_of_birth > current_date - interval '20 years' then raise exception 'Driver must be at least 20 years old'; end if;
  end if;
  update public.driver_profiles set review_status = p_status, reviewed_at = now() where user_id = p_driver;
end;
$$;

create or replace function public.admin_assign_driver(p_order uuid, p_driver uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public._require_role('admin');
  v_status text;
begin
  if not exists (select 1 from public.driver_profiles where user_id = p_driver and review_status = 'approved') then
    raise exception 'Driver is not approved';
  end if;
  select status into v_status from public.orders where id = p_order for update;
  if not found or v_status <> 'open' then raise exception 'Order is no longer waiting for a driver'; end if;

  begin
    insert into public.order_assignments (order_id, driver_id, status) values (p_order, p_driver, 'accepted');
  exception when unique_violation then
    raise exception 'This driver already had this job once – choose another driver';
  end;

  update public.orders set status = 'assigned', assigned_driver_id = p_driver, assigned_at = now() where id = p_order;
  perform public._event(p_order, v_admin, 'admin_assigned', 'assigned');
end;
$$;

create or replace function public.admin_mark_refunded(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public._require_role('admin');
begin
  update public.orders set refunded_at = now()
  where id = p_order and status = 'cancelled' and paid_at is not null and refunded_at is null;
  if not found then raise exception 'Nothing to refund on this order'; end if;
  perform public._event(p_order, v_admin, 'refunded', null);
end;
$$;

create or replace function public.admin_update_settings(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_role('admin');
  update public.app_settings set
    base_fee_cents = round((p->>'baseFee')::numeric * 100),
    per_km_cents   = round((p->>'perKm')::numeric * 100),
    min_price_cents = round((p->>'minPrice')::numeric * 100),
    vat_rate       = (p->>'vatRate')::numeric,
    driver_share   = (p->>'driverShare')::numeric,
    road_factor    = (p->>'roadFactor')::numeric,
    same_city_km   = (p->>'sameCityKm')::integer,
    updated_at     = now()
  where id = 1;
end;
$$;

create or replace function public.admin_update_company(p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._require_role('admin');
  update public.app_settings set
    company_name        = left(coalesce(trim(p->>'name'), company_name), 200),
    company_business_id = left(coalesce(trim(p->>'businessId'), ''), 50),
    company_email       = left(coalesce(trim(p->>'email'), ''), 200),
    company_phone       = left(coalesce(trim(p->>'phone'), ''), 50),
    company_address     = left(coalesce(trim(p->>'address'), ''), 300),
    company_iban        = left(upper(replace(coalesce(p->>'iban', ''), ' ', '')), 40),
    updated_at          = now()
  where id = 1;
end;
$$;

-- ===========================================================================
-- Permissions
-- ===========================================================================
-- Internal functions: no client access.
revoke all on function public._require_role(text) from public, anon, authenticated;
revoke all on function public._require_approved_driver() from public, anon, authenticated;
revoke all on function public._quote(text, text) from public, anon, authenticated;
revoke all on function public._event(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public._order_json(public.orders, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_transfer(uuid, uuid) from public, anon, authenticated;

-- Readable by visitors too (landing page needs the pricing rules).
revoke all on function public.get_app_state() from public;
grant execute on function public.get_app_state() to anon, authenticated;

-- Signed-in users only; each function checks the role itself.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_order(jsonb)', 'public.demo_pay_order(uuid, text, text)', 'public.cancel_order(uuid)',
    'public.update_my_profile(jsonb)', 'public.accept_transfer(uuid)', 'public.reject_transfer(uuid)',
    'public.release_transfer(uuid)', 'public.start_transfer(uuid)', 'public.record_inspection(uuid, text, jsonb)',
    'public.update_driver_profile(jsonb)', 'public.create_driver_payout(uuid, date, boolean, text)',
    'public.mark_payout_paid(uuid, text)', 'public.admin_set_driver_status(uuid, text)',
    'public.admin_assign_driver(uuid, uuid)', 'public.admin_mark_refunded(uuid)',
    'public.admin_update_settings(jsonb)', 'public.admin_update_company(jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
