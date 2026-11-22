-- Real addresses and road distances (Google Maps).
-- The app server asks Google for the route (Places + Routes) and saves it as a route quote with the service role.
-- create_order takes the quote id: the price comes from the real road distance and the customer cannot change it.
-- Orders without a quote still use the city-based estimate (_quote), e.g. when Google is not configured.
-- Run after 20261122000000_driver_trip.sql.

-- Cities come from the address now, so they are no longer limited to the cities table.
alter table public.orders drop constraint if exists orders_pickup_city_fkey;
alter table public.orders drop constraint if exists orders_dropoff_city_fkey;
alter table public.orders add constraint orders_pickup_city_check check (length(pickup_city) between 1 and 100);
alter table public.orders add constraint orders_dropoff_city_check check (length(dropoff_city) between 1 and 100);
alter table public.orders
  add column if not exists pickup_lat double precision check (pickup_lat between -90 and 90),
  add column if not exists pickup_lng double precision check (pickup_lng between -180 and 180),
  add column if not exists dropoff_lat double precision check (dropoff_lat between -90 and 90),
  add column if not exists dropoff_lng double precision check (dropoff_lng between -180 and 180),
  add column if not exists drive_minutes integer check (drive_minutes >= 0),
  add column if not exists route_polyline text check (length(route_polyline) <= 100000);

create table public.route_quotes (
  id uuid primary key default gen_random_uuid(),
  from_address text not null check (length(from_address) between 1 and 200),
  from_city text not null check (length(from_city) between 1 and 100),
  from_lat double precision not null check (from_lat between -90 and 90),
  from_lng double precision not null check (from_lng between -180 and 180),
  to_address text not null check (length(to_address) between 1 and 200),
  to_city text not null check (length(to_city) between 1 and 100),
  to_lat double precision not null check (to_lat between -90 and 90),
  to_lng double precision not null check (to_lng between -180 and 180),
  distance_m integer not null check (distance_m > 0 and distance_m < 3000000),
  duration_s integer not null check (duration_s >= 0),
  polyline text not null default '' check (length(polyline) <= 100000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);
-- Only the app server (service role) reads and writes quotes.
alter table public.route_quotes enable row level security;
revoke all on public.route_quotes from anon, authenticated;

-- Price for a road distance: same rules as _quote (base fee + per km, minimum price, VAT).
create or replace function public._price_for_km(p_km integer)
returns table (net_cents bigint, vat_cents bigint, total_cents bigint, vat_rate numeric, driver_share numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.app_settings;
begin
  select * into s from public.app_settings x where x.id = 1;
  net_cents := greatest(s.min_price_cents, s.base_fee_cents + s.per_km_cents * p_km);
  vat_cents := round(net_cents * s.vat_rate / 100);
  total_cents := net_cents + vat_cents;
  vat_rate := s.vat_rate;
  driver_share := s.driver_share;
  return next;
end;
$$;

-- Service role only: save a route from Google and return its price.
create or replace function public.save_route_quote(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_km integer;
  x record;
begin
  delete from public.route_quotes where expires_at < now() - interval '1 day';
  insert into public.route_quotes (from_address, from_city, from_lat, from_lng, to_address, to_city, to_lat, to_lng,
                                   distance_m, duration_s, polyline)
  values (trim(p->>'from_address'), trim(p->>'from_city'), (p->>'from_lat')::float8, (p->>'from_lng')::float8,
          trim(p->>'to_address'), trim(p->>'to_city'), (p->>'to_lat')::float8, (p->>'to_lng')::float8,
          (p->>'distance_m')::integer, (p->>'duration_s')::integer, coalesce(p->>'polyline', ''))
  returning id into v_id;
  v_km := greatest(1, ceil((p->>'distance_m')::integer / 1000.0))::integer;
  select * into x from public._price_for_km(v_km);
  return jsonb_build_object('id', v_id, 'km', v_km, 'minutes', round((p->>'duration_s')::integer / 60.0),
    'net', x.net_cents / 100.0, 'vat', x.vat_cents / 100.0, 'total', x.total_cents / 100.0, 'vatRate', x.vat_rate);
end;
$$;

create or replace function public.create_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_role('customer');
  q record;
  rq public.route_quotes;
  v_qid uuid;
  v_id uuid;
  v_no bigint;
  v_date date := public._try_date(p->>'pickup_date');
begin
  if v_date is null or v_date < (now() at time zone 'Europe/Helsinki')::date then
    raise exception 'Pickup date must be today or later';
  end if;
  if coalesce(p->>'quote_id', '') <> '' then
    -- Real road route (Google Maps), saved by the app server: addresses, coordinates and distance come from it.
    begin v_qid := (p->>'quote_id')::uuid; exception when others then raise exception 'Invalid price quote'; end;
    select * into rq from public.route_quotes r where r.id = v_qid and r.expires_at > now();
    if not found then raise exception 'The price quote has expired – please check the price again'; end if;
    p := p || jsonb_build_object('pickup_city', rq.from_city, 'pickup_address', rq.from_address,
                                 'dropoff_city', rq.to_city, 'dropoff_address', rq.to_address);
  end if;
  if coalesce(trim(p->>'pickup_address'), '') = '' or coalesce(trim(p->>'dropoff_address'), '') = ''
     or coalesce(trim(p->>'car_model'), '') = '' or coalesce(trim(p->>'car_plate'), '') = '' then
    raise exception 'Please fill in the addresses and the vehicle';
  end if;

  if rq.id is not null then
    select greatest(1, ceil(rq.distance_m / 1000.0))::integer as km, x.* into q from public._price_for_km(greatest(1, ceil(rq.distance_m / 1000.0))::integer) x;
  else
    select * into q from public._quote(p->>'pickup_city', p->>'dropoff_city');
  end if;

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

  if rq.id is not null then
    update public.orders set pickup_lat = rq.from_lat, pickup_lng = rq.from_lng, dropoff_lat = rq.to_lat, dropoff_lng = rq.to_lng,
           drive_minutes = round(rq.duration_s / 60.0), route_polyline = rq.polyline
     where id = v_id;
  end if;

  perform public._event(v_id, v_uid, 'order_created', 'pending_payment');
  return jsonb_build_object('id', 'ZS-' || v_no, 'uuid', v_id);
end;
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
    'route', jsonb_build_object('fromLat', o.pickup_lat, 'fromLng', o.pickup_lng, 'toLat', o.dropoff_lat, 'toLng', o.dropoff_lng,
      'minutes', o.drive_minutes, 'polyline', o.route_polyline),
    'lastPosition', case when v.redact then null else o.last_position end,
    'driverPaidAt', (select p.paid_at from public.driver_earnings de
      join public.driver_payouts p on p.id = de.payout_id
      where de.order_id = o.id and p.status = 'paid')
  )
  from v;
$$;

revoke all on function public._price_for_km(integer) from public, anon, authenticated;
revoke all on function public.save_route_quote(jsonb) from public, anon, authenticated;
revoke all on function public._order_json(public.orders, uuid, text) from public, anon, authenticated;
revoke all on function public.create_order(jsonb) from public, anon;
grant execute on function public.create_order(jsonb) to authenticated;
