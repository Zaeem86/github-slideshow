-- Driver trip (ZEMO driver app):
--   * inspection photos are stored in Supabase Storage (private bucket "inspection-photos"),
--     path  <order uuid>/<pickup|delivery>/<slot>.jpg  – required slots: odometer, front, right, left, rear
--   * the name of the person handing over is optional (the trip screen asks for photos instead)
--   * the driver's GPS position during the trip: last position on the order + a location log
--   * news and decisions shown to drivers on their home screen
-- Run after 20261119000000_payments_trustly.sql.

-- ===========================================================================
-- Inspection photos
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('inspection-photos', 'inspection-photos', false)
on conflict (id) do nothing;

-- The driver assigned to the order may add / replace photos while the job is active.
create policy "Assigned driver uploads inspection photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and exists (select 1 from public.orders o
                where o.id::text = (storage.foldername(name))[1]
                  and o.assigned_driver_id = (select auth.uid())
                  and o.status in ('assigned', 'picked_up', 'in_transit'))
  );
create policy "Assigned driver replaces inspection photos" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'inspection-photos'
    and exists (select 1 from public.orders o
                where o.id::text = (storage.foldername(name))[1]
                  and o.assigned_driver_id = (select auth.uid())
                  and o.status in ('assigned', 'picked_up', 'in_transit'))
  );
-- The customer, the assigned driver and admins may view the photos of an order.
create policy "Order parties view inspection photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'inspection-photos'
    and exists (select 1 from public.orders o
                where o.id::text = (storage.foldername(name))[1]
                  and (o.customer_id = (select auth.uid())
                       or o.assigned_driver_id = (select auth.uid())
                       or (select public.is_admin())))
  );

alter table public.inspections drop constraint if exists inspections_person_name_check;
alter table public.inspections alter column person_name set default '';
alter table public.inspections add constraint inspections_person_name_check check (length(person_name) <= 200);

-- Same rules as before, plus: the five required photos must be uploaded for this order and stage.
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
  v_prefix text := p_order::text || '/' || p_stage || '/';
  v_slot text;
  v_paths text[];
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.assigned_driver_id is distinct from v_uid then raise exception 'Not your job'; end if;
  if p_stage not in ('pickup', 'delivery') then raise exception 'Unknown inspection stage'; end if;
  if p_stage = 'pickup' and o.status <> 'assigned' then raise exception 'Pickup is already recorded'; end if;
  if p_stage = 'delivery' and o.status not in ('picked_up', 'in_transit') then raise exception 'Record the pickup first'; end if;
  if v_odo is null or v_odo < 0 then raise exception 'Odometer reading is required'; end if;

  foreach v_slot in array array['odometer', 'front', 'right', 'left', 'rear'] loop
    if not exists (select 1 from storage.objects
                   where bucket_id = 'inspection-photos' and name = v_prefix || v_slot || '.jpg') then
      raise exception 'Photo missing: %', v_slot;
    end if;
  end loop;
  select array_agg(name order by name) into v_paths
    from storage.objects where bucket_id = 'inspection-photos' and name like v_prefix || '%';

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
          v_paths, coalesce(trim(p->>'person_name'), ''));

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

-- ===========================================================================
-- GPS during the trip
-- ===========================================================================
alter table public.orders add column if not exists last_position jsonb;

create table public.order_locations (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  driver_id uuid not null references public.profiles(id),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m >= 0),
  recorded_at timestamptz not null default now()
);
create index order_locations_order_idx on public.order_locations (order_id, recorded_at);
alter table public.order_locations enable row level security;
create policy "Order parties read the location log" on public.order_locations
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id
                 and (o.customer_id = (select auth.uid()) or o.assigned_driver_id = (select auth.uid()) or (select public.is_admin()))));
revoke insert, update, delete on public.order_locations from anon, authenticated;

-- The assigned driver reports the phone's position while the car is with them.
-- At most one log row per 15 seconds per order; the order always keeps the latest position.
create or replace function public.report_location(p_order uuid, p_lat double precision, p_lng double precision, p_accuracy real default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public._require_approved_driver();
  o public.orders;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid position';
  end if;
  select * into o from public.orders where id = p_order for update;
  if not found or o.assigned_driver_id is distinct from v_uid then raise exception 'Not your job'; end if;
  if o.status not in ('picked_up', 'in_transit') then raise exception 'The trip has not started'; end if;
  update public.orders
     set last_position = jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy, 'at', now())
   where id = p_order;
  if not exists (select 1 from public.order_locations
                 where order_id = p_order and recorded_at > now() - interval '15 seconds') then
    insert into public.order_locations (order_id, driver_id, lat, lng, accuracy_m)
    values (p_order, v_uid, p_lat, p_lng, p_accuracy);
  end if;
end;
$$;
revoke execute on function public.report_location(uuid, double precision, double precision, real) from public, anon;
grant execute on function public.report_location(uuid, double precision, double precision, real) to authenticated;

-- ===========================================================================
-- News and decisions for drivers
-- ===========================================================================
create table public.driver_news (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'news' check (kind in ('news', 'decision')),
  title text not null check (length(title) between 1 and 200),
  body text not null default '' check (length(body) <= 4000),
  published_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
alter table public.driver_news enable row level security;
create policy "Drivers and admins read news" on public.driver_news
  for select to authenticated
  using ((select public.is_admin())
         or exists (select 1 from public.driver_profiles d where d.user_id = (select auth.uid())));
revoke insert, update, delete on public.driver_news from anon, authenticated;

insert into public.driver_news (kind, title, body)
values ('news', 'Tervetuloa ZEMO-kuljettajaksi', 'Tältä kortilta löydät jatkossa uudet tiedotteet ja päätökset.');

-- Newest first.
create or replace function public.get_driver_news()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
                                               'publishedAt', n.published_at) order by n.published_at desc), '[]'::jsonb)
  from (select * from public.driver_news order by published_at desc limit 20) n;
$$;
revoke execute on function public.get_driver_news() from public, anon;
grant execute on function public.get_driver_news() to authenticated;
