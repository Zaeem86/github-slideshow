-- ZEMO SIIRTO – base schema: profiles, drivers, orders, events, inspections, settings.
-- Runs before 20261117000000_driver_jobs_and_earnings.sql, which builds on these tables.
--
-- Security model: every table has RLS on. Clients (anon / authenticated) only get
-- SELECT policies here; every write goes through the security-definer functions in
-- 20261118000000_app_api.sql, which check the caller's role and the order's state.

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.cities (
  name text primary key,
  lat double precision not null,
  lon double precision not null
);

insert into public.cities (name, lat, lon) values
  ('Helsinki', 60.1699, 24.9384), ('Espoo', 60.2055, 24.6559), ('Vantaa', 60.2934, 25.0378),
  ('Porvoo', 60.3923, 25.6651), ('Tampere', 61.4978, 23.7610), ('Turku', 60.4518, 22.2666),
  ('Salo', 60.3831, 23.1286), ('Hämeenlinna', 60.9959, 24.4643), ('Lahti', 60.9827, 25.6612),
  ('Kotka', 60.4664, 26.9458), ('Kouvola', 60.8681, 26.7042), ('Lappeenranta', 61.0587, 28.1887),
  ('Mikkeli', 61.6886, 27.2723), ('Jyväskylä', 62.2426, 25.7473), ('Kuopio', 62.8924, 27.6770),
  ('Joensuu', 62.6010, 29.7636), ('Pori', 61.4851, 21.7974), ('Rauma', 61.1272, 21.5113),
  ('Vaasa', 63.0951, 21.6165), ('Seinäjoki', 62.7903, 22.8403), ('Kokkola', 63.8385, 23.1307),
  ('Oulu', 65.0121, 25.4651), ('Kajaani', 64.2222, 27.7278), ('Rovaniemi', 66.5039, 25.7294);

-- Single-row table with pricing rules and company details.
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  base_fee_cents integer not null default 4900 check (base_fee_cents >= 0),
  per_km_cents integer not null default 95 check (per_km_cents >= 0),
  min_price_cents integer not null default 7900 check (min_price_cents >= 0),
  vat_rate numeric(5,2) not null default 25.5 check (vat_rate between 0 and 100),
  driver_share numeric(5,2) not null default 65 check (driver_share between 0 and 100),
  road_factor numeric(4,2) not null default 1.15 check (road_factor >= 1),
  same_city_km integer not null default 15 check (same_city_km > 0),
  -- DEMO: lets customers mark orders as paid without a payment provider.
  -- Set to false before going live and confirm payments from a provider webhook instead.
  allow_demo_payments boolean not null default true,
  company_name text not null default 'ZEMO SIIRTO',
  company_business_id text not null default '',
  company_email text not null default 'info@zemosiirto.fi',
  company_phone text not null default '',
  company_address text not null default '',
  company_iban text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.app_settings default values;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'driver', 'admin')),
  full_name text not null default '',
  email text not null default '',
  phone text not null default '',
  company text not null default '',
  created_at timestamptz not null default now()
);

create table public.driver_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected', 'suspended')),
  is_available boolean not null default true,
  home_city text references public.cities(name),
  date_of_birth date,
  license_number text not null default '',
  license_class text not null default 'B' check (license_class in ('B', 'BE', 'C1', 'C')),
  license_expiry date,
  iban text not null default '',
  license_photo_path text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity (start with 1001) unique,
  customer_id uuid not null references public.profiles(id),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'open', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled')),
  pickup_city text not null references public.cities(name),
  pickup_address text not null check (length(pickup_address) between 1 and 200),
  pickup_date date not null,
  pickup_time time not null,
  pickup_contact text not null default '' check (length(pickup_contact) <= 200),
  dropoff_city text not null references public.cities(name),
  dropoff_address text not null check (length(dropoff_address) between 1 and 200),
  dropoff_contact text not null default '' check (length(dropoff_contact) <= 200),
  car_model text not null check (length(car_model) between 1 and 100),
  car_plate text not null check (length(car_plate) between 1 and 20),
  gearbox text not null default 'Automatic' check (gearbox in ('Automatic', 'Manual')),
  fuel text not null default 'Petrol' check (fuel in ('Petrol', 'Diesel', 'Hybrid', 'Electric')),
  notes text not null default '' check (length(notes) <= 2000),
  -- Price is fixed when the order is created (server-side, from app_settings).
  distance_km integer not null check (distance_km > 0),
  price_net_cents bigint not null check (price_net_cents >= 0),
  vat_rate numeric(5,2) not null,
  vat_cents bigint not null check (vat_cents >= 0),
  price_total_cents bigint not null,
  driver_share numeric(5,2) not null,
  assigned_driver_id uuid references public.profiles(id),
  assigned_at timestamptz,
  payment_method text check (payment_method in ('card', 'mobilepay', 'invoice')),
  payment_last4 text check (payment_last4 ~ '^[0-9]{4}$'),
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  check (price_total_cents = price_net_cents + vat_cents),
  check (status not in ('assigned', 'picked_up', 'in_transit', 'delivered') or assigned_driver_id is not null),
  check (status in ('pending_payment', 'cancelled') or paid_at is not null),
  check (refunded_at is null or (status = 'cancelled' and paid_at is not null))
);

create index orders_customer_idx on public.orders (customer_id);
create index orders_driver_idx on public.orders (assigned_driver_id);
create index orders_status_idx on public.orders (status);

-- Status history / audit log. `status` is set when the event changed the order status.
create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event_type text not null,
  status text,
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id);

-- Pickup and delivery inspections (one of each per order).
create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  stage text not null check (stage in ('pickup', 'delivery')),
  driver_id uuid not null references public.profiles(id),
  odometer_km integer not null check (odometer_km >= 0),
  fuel_level text not null check (fuel_level in ('Full', '3/4', '1/2', '1/4', 'Reserve')),
  keys_count integer check (keys_count >= 0),
  documents_present boolean not null default false,
  areas jsonb not null default '{}' check (jsonb_typeof(areas) = 'object'),
  notes text not null default '' check (length(notes) <= 2000),
  photo_paths text[] not null default '{}',
  person_name text not null check (length(person_name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (order_id, stage)
);

-- Jobs a driver chose not to see again.
create table public.job_rejections (
  order_id uuid not null references public.orders(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (order_id, driver_id)
);

-- ---------------------------------------------------------------------------
-- Admin helper (also redefined, identically, in the next migration)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- New sign-ups get a profile. Role comes from sign-up metadata but can only be
-- 'customer' or 'driver'; admins are promoted manually:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- ---------------------------------------------------------------------------
create or replace function public._try_date(p text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::date;
exception when others then
  return null;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role text := case when m->>'role' = 'driver' then 'driver' else 'customer' end;
begin
  insert into public.profiles (id, role, full_name, email, phone, company)
  values (new.id, v_role, left(coalesce(m->>'full_name', ''), 200), coalesce(new.email, ''),
          left(coalesce(m->>'phone', ''), 50), left(coalesce(m->>'company', ''), 200));

  if v_role = 'driver' then
    insert into public.driver_profiles (user_id, home_city, date_of_birth, license_number, license_class,
                                        license_expiry, iban, license_photo_path)
    values (
      new.id,
      (select c.name from public.cities c where c.name = m->>'home_city'),
      public._try_date(m->>'date_of_birth'),
      left(coalesce(m->>'license_number', ''), 50),
      case when m->>'license_class' in ('B', 'BE', 'C1', 'C') then m->>'license_class' else 'B' end,
      public._try_date(m->>'license_expiry'),
      upper(replace(coalesce(m->>'iban', ''), ' ', '')),
      nullif(m->>'license_photo_path', '')
    );

    -- Don't keep personal data in the auth metadata (it is copied into every JWT).
    begin
      update auth.users
      set raw_user_meta_data = raw_user_meta_data - 'iban' - 'license_number' - 'date_of_birth'
      where id = new.id;
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public._try_date(text) from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row level security (read-only for clients; writes go through functions)
-- ---------------------------------------------------------------------------
alter table public.cities          enable row level security;
alter table public.app_settings    enable row level security;
alter table public.profiles        enable row level security;
alter table public.driver_profiles enable row level security;
alter table public.orders          enable row level security;
alter table public.order_events    enable row level security;
alter table public.inspections     enable row level security;
alter table public.job_rejections  enable row level security;

create policy "Anyone can read cities" on public.cities
  for select to anon, authenticated using (true);

create policy "Anyone can read settings" on public.app_settings
  for select to anon, authenticated using (true);

create policy "Read own profile, admins read all" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "Read own driver profile, admins read all" on public.driver_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "Customers, assigned drivers and admins read orders" on public.orders
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or assigned_driver_id = (select auth.uid())
    or (select public.is_admin())
    or (status = 'open' and exists (
      select 1 from public.driver_profiles d
      where d.user_id = (select auth.uid()) and d.review_status = 'approved'))
  );

create policy "Read events of visible orders" on public.order_events
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_events.order_id));

create policy "Read inspections of visible orders" on public.inspections
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = inspections.order_id));

create policy "Read own job rejections, admins read all" on public.job_rejections
  for select to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_admin()));
