-- LOCAL TESTING ONLY. Never run this against a real Supabase project.
-- Minimal stand-in for Supabase: roles, auth.uid(), and the existing base tables.
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table public.profiles (id uuid primary key, role text not null);
create table public.driver_profiles (user_id uuid primary key references public.profiles(id), review_status text not null, is_available boolean not null default true);
create table public.orders (id uuid primary key default gen_random_uuid(), status text not null default 'open', assigned_driver_id uuid, assigned_at timestamptz);
create table public.order_events (id bigserial primary key, order_id uuid, actor_id uuid, event_type text, created_at timestamptz);
-- Supabase grants table access to API roles by default; RLS is what protects rows.
alter default privileges in schema public grant all on tables to anon, authenticated;
grant usage on schema public to anon, authenticated;
insert into profiles values
 ('00000000-0000-0000-0000-00000000000a','admin'),
 ('00000000-0000-0000-0000-0000000000d1','driver'),
 ('00000000-0000-0000-0000-0000000000d2','driver'),
 ('00000000-0000-0000-0000-0000000000d3','driver');
insert into driver_profiles values
 ('00000000-0000-0000-0000-0000000000d1','approved',true),
 ('00000000-0000-0000-0000-0000000000d2','approved',true),
 ('00000000-0000-0000-0000-0000000000d3','pending',true);
insert into orders(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
