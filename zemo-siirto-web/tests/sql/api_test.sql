-- Self-checking tests. Run on a scratch database after local_supabase_stub.sql and all migrations:
--   psql -f local_supabase_stub.sql && for f in ../../supabase/migrations/*.sql; do psql -f $f; done && psql -f api_test.sql
-- Every check prints PASS or FAIL.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create schema test;
grant usage on schema test to anon, authenticated, service_role;
create function test.ok(cond boolean, name text) returns text language sql as
$$ select case when coalesce(cond, false) then 'PASS ' else 'FAIL ' end || name $$;
create function test.err(q text, pat text, name text) returns text language plpgsql as $$
begin
  execute q;
  return 'FAIL ' || name || ' (no error)';
exception when others then
  return case when sqlerrm ilike '%' || pat || '%' then 'PASS ' || name else 'FAIL ' || name || ' (' || sqlerrm || ')' end;
end $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- Users (sign-up trigger creates the profiles)
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000aa', 'boss@x.fi', '{"full_name":"Boss","role":"admin"}'),
 ('00000000-0000-0000-0000-0000000000c1', 'cust@x.fi', '{"full_name":"Cust One","phone":"+358401","role":"customer"}'),
 ('00000000-0000-0000-0000-0000000000d1', 'd1@x.fi', '{"full_name":"Driver One","role":"driver","home_city":"Helsinki","date_of_birth":"1990-01-01","license_number":"L1","license_expiry":"2031-01-01","iban":"FI21 1234 5600 0007 85"}'),
 ('00000000-0000-0000-0000-0000000000d2', 'd2@x.fi', '{"full_name":"Driver Two","role":"driver","home_city":"Tampere","date_of_birth":"1988-05-05","license_number":"L2","license_expiry":"2030-01-01","iban":"FI2112345600000785"}'),
 ('00000000-0000-0000-0000-0000000000d3', 'd3@x.fi', '{"full_name":"Expired","role":"driver","home_city":"Nowhere","date_of_birth":"bad","license_expiry":"2020-01-01"}');
select test.ok((select role from profiles where id='00000000-0000-0000-0000-0000000000aa') = 'customer', 'sign-up cannot self-assign admin');
update profiles set role='admin' where email='boss@x.fi';
select test.ok((select count(*) from driver_profiles where review_status='pending') = 3, 'drivers start pending');
select test.ok((select raw_user_meta_data ? 'iban' from auth.users where email='d1@x.fi') = false, 'IBAN stripped from auth metadata');
select test.ok((select home_city is null and date_of_birth is null from driver_profiles where user_id='00000000-0000-0000-0000-0000000000d3'), 'bad sign-up metadata does not break sign-up');

\set c1 '00000000-0000-0000-0000-0000000000c1'
\set d1 '00000000-0000-0000-0000-0000000000d1'
\set d2 '00000000-0000-0000-0000-0000000000d2'
\set d3 '00000000-0000-0000-0000-0000000000d3'
\set admin '00000000-0000-0000-0000-0000000000aa'

-- ---- customer
reset role; select set_config('request.jwt.claim.sub', :'c1', false) \g /dev/null
set role authenticated;
select public.create_order(format('{"pickup_city":"Helsinki","pickup_address":"Mannerheimintie 1","pickup_date":"%s","pickup_time":"09:00","dropoff_city":"Oulu","dropoff_address":"Kauppurienkatu 2","car_model":"Volvo V60","car_plate":"abc-123"}', (now() at time zone 'Europe/Helsinki')::date + 1)::jsonb)->>'uuid' as o1 \gset
select public.create_order(format('{"pickup_city":"Turku","pickup_address":"A 1","pickup_date":"%s","dropoff_city":"Turku","dropoff_address":"B 2","car_model":"Golf","car_plate":"X-1","pickup_contact":"Secret Person 040"}', (now() at time zone 'Europe/Helsinki')::date)::jsonb)->>'uuid' as o2 \gset
select public.create_order(format('{"pickup_city":"Espoo","pickup_address":"A","pickup_date":"%s","dropoff_city":"Lahti","dropoff_address":"B","car_model":"Golf","car_plate":"Y-1"}', (now() at time zone 'Europe/Helsinki')::date)::jsonb)->>'uuid' as o3 \gset
select test.ok((select distance_km = 620 and price_net_cents = 4900 + 95*620 and price_total_cents = price_net_cents + round(price_net_cents*0.255) from orders where id = :'o1'), 'server price Helsinki-Oulu 620 km matches website formula');
select test.ok((select distance_km = 15 and price_net_cents = 7900 from orders where id = :'o2'), 'same-city uses minimum price');
select test.err(format('select public.create_order(%L)', format('{"pickup_city":"Helsinki","pickup_address":"A","pickup_date":"%s","dropoff_city":"Oulu","dropoff_address":"B","car_model":"x","car_plate":"y"}', (now() at time zone 'Europe/Helsinki')::date - 1)), 'today or later', 'past pickup date rejected');
select test.err($q$select public.create_order('{"pickup_city":"Paris","pickup_address":"A","pickup_date":"2099-01-01","dropoff_city":"Oulu","dropoff_address":"B","car_model":"x","car_plate":"y"}')$q$, 'unknown pickup city', 'unknown city rejected');
select public.demo_pay_order(:'o1', 'card', '4242') \g /dev/null
select public.demo_pay_order(:'o2', 'mobilepay') \g /dev/null
select test.err(format('select public.demo_pay_order(%L, ''card'', ''4242'')', :'o1'), 'already paid', 'cannot pay twice');
with x as (update orders set status='delivered' where id = :'o3' returning 1) select test.ok((select count(*) = 0 from x), 'customer cannot update orders directly (RLS)');
select test.err('select public.admin_update_settings(''{"baseFee":0}'')', 'not allowed', 'customer cannot change pricing');
select test.ok((select count(*) = 0 from driver_earnings), 'customer sees no earnings');

-- ---- unapproved driver
reset role; select set_config('request.jwt.claim.sub', :'d1', false) \g /dev/null
set role authenticated;
select test.ok((public.accept_transfer(:'o1')->>'success')::boolean = false, 'pending driver cannot accept');
select test.ok(jsonb_array_length(public.get_app_state()->'orders') = 0, 'pending driver sees no open jobs');

-- ---- admin approves
reset role; select set_config('request.jwt.claim.sub', :'admin', false) \g /dev/null
set role authenticated;
select public.admin_set_driver_status(:'d1', 'approved') \g /dev/null
select public.admin_set_driver_status(:'d2', 'approved') \g /dev/null
select test.err(format('select public.admin_set_driver_status(%L, ''approved'')', :'d3'), 'expired', 'expired licence cannot be approved');

-- ---- drivers race / claim once
reset role; select set_config('request.jwt.claim.sub', :'d1', false) \g /dev/null
set role authenticated;
select test.ok((select o->'customer'->>'name' = '' and o->'pickup'->>'contact' = '' from jsonb_array_elements(public.get_app_state()->'orders') o where o->>'uuid' = :'o2'), 'open job hides customer details from drivers');
select test.ok((select count(*) = 2 from jsonb_array_elements(public.get_app_state()->'orders')), 'approved driver sees the 2 paid open jobs only');
select test.ok((public.accept_transfer(:'o1')->>'success')::boolean, 'd1 accepts o1');
select test.ok((select o->'customer'->>'name' = 'Cust One' from jsonb_array_elements(public.get_app_state()->'orders') o where o->>'uuid' = :'o1'), 'assigned driver sees customer details');
reset role; select set_config('request.jwt.claim.sub', :'d2', false) \g /dev/null
set role authenticated;
select test.ok(public.accept_transfer(:'o1')->>'message' = 'Job is no longer available', 'd2 cannot take o1');
select test.err(format('select public.release_transfer(%L)', :'o1'), 'not your job', 'd2 cannot release d1''s job');
reset role; select set_config('request.jwt.claim.sub', :'d1', false) \g /dev/null
set role authenticated;
select public.release_transfer(:'o1') \g /dev/null
select test.ok(public.accept_transfer(:'o1')->>'message' = 'You have already claimed this job once', 'd1 cannot re-claim released job');
reset role; select set_config('request.jwt.claim.sub', :'d2', false) \g /dev/null
set role authenticated;
select test.ok((public.accept_transfer(:'o1')->>'success')::boolean, 'd2 accepts o1 after release');

-- ---- inspections + completion
select test.err(format('select public.start_transfer(%L)', :'o1'), 'pickup inspection first', 'cannot start before pickup');
select test.err(format('select public.record_inspection(%L, ''delivery'', %L)', :'o1', '{"odometer_km":1,"fuel_level":"Full","person_name":"x"}'), 'pickup first', 'cannot deliver before pickup');
-- photos (storage): only the assigned driver may upload, and the five required photos must exist
reset role; select set_config('request.jwt.claim.sub', :'d1', false) \g /dev/null
set role authenticated;
select test.err(format('insert into storage.objects (bucket_id, name) values (''inspection-photos'', %L)', :'o1' || '/pickup/front.jpg'), 'row-level security', 'other driver cannot upload photos to the job');
reset role; select set_config('request.jwt.claim.sub', :'d2', false) \g /dev/null
set role authenticated;
insert into storage.objects (bucket_id, name) select 'inspection-photos', :'o1' || '/pickup/' || x || '.jpg' from unnest(array['odometer','front','right','left']) x;
select test.err(format('select public.record_inspection(%L, ''pickup'', %L)', :'o1', '{"odometer_km":50000,"fuel_level":"Full"}'), 'photo missing: rear', 'pickup needs all five photos');
insert into storage.objects (bucket_id, name) values ('inspection-photos', :'o1' || '/pickup/rear.jpg'), ('inspection-photos', :'o1' || '/pickup/extra1.jpg');
select test.err(format('select public.report_location(%L, 60.17, 24.94)', :'o1'), 'not started', 'no GPS log before the pickup');
select public.record_inspection(:'o1', 'pickup', '{"odometer_km":50000,"fuel_level":"Full","keys_count":2,"documents_present":true,"areas":{"Front":"OK","Left side":"Scratch"}}') \g /dev/null
select test.ok((select person_name = '' and array_length(photo_paths, 1) = 6 from inspections where order_id = :'o1' and stage = 'pickup'), 'pickup without a name, six photo paths recorded');
-- GPS during the trip
select public.report_location(:'o1', 60.1699, 24.9384, 12) \g /dev/null
select public.report_location(:'o1', 60.2, 24.9) \g /dev/null
select test.ok((select (last_position->>'lat')::float = 60.2 from orders where id = :'o1') and (select count(*) = 1 from order_locations where order_id = :'o1'), 'latest position on the order, log max one row per 15 s');
select test.err(format('select public.report_location(%L, 95, 24)', :'o1'), 'invalid position', 'position is validated');
select test.err(format('insert into public.order_locations (order_id, driver_id, lat, lng) values (%L, %L, 1, 1)', :'o1', :'d2'), 'permission denied', 'location log is written only by report_location');
select public.start_transfer(:'o1') \g /dev/null
reset role; select set_config('request.jwt.claim.sub', :'d1', false) \g /dev/null
set role authenticated;
select test.err(format('select public.report_location(%L, 60, 24)', :'o1'), 'not your job', 'other driver cannot report the position');
select test.ok((select count(*) = 0 from storage.objects where name like :'o1' || '/%'), 'other driver cannot see the photos');
reset role; select set_config('request.jwt.claim.sub', :'c1', false) \g /dev/null
set role authenticated;
select test.ok((select count(*) = 1 from order_locations where order_id = :'o1') and (select count(*) = 6 from storage.objects where name like :'o1' || '/%'), 'customer sees the location log and photos');
select test.ok((select jsonb_array_length(public.get_driver_news()) = 0), 'customers do not get driver news');
reset role; select set_config('request.jwt.claim.sub', :'d2', false) \g /dev/null
set role authenticated;
select test.ok((select public.get_driver_news()->0->>'title' = 'Tervetuloa ZEMO-kuljettajaksi'), 'drivers get news');
insert into storage.objects (bucket_id, name) select 'inspection-photos', :'o1' || '/delivery/' || x || '.jpg' from unnest(array['odometer','front','right','left','rear']) x;
select test.err(format('select public.record_inspection(%L, ''delivery'', %L)', :'o1', '{"odometer_km":49000,"fuel_level":"1/2","person_name":"Sara"}'), 'lower than at pickup', 'odometer cannot go backwards');
select public.record_inspection(:'o1', 'delivery', '{"odometer_km":50620,"fuel_level":"1/2","areas":{"Front":"Dent"},"person_name":"Sara"}') \g /dev/null
select test.ok((select status = 'delivered' from orders where id = :'o1'), 'order delivered');
select test.ok((select status = 'completed' from order_assignments where order_id = :'o1' and driver_id = :'d2'), 'assignment completed');
select test.ok((select gross_amount_cents = o.price_net_cents and net_amount_cents = round(o.price_net_cents * 0.65) and commission_cents + net_amount_cents = gross_amount_cents
  from driver_earnings e join orders o on o.id = e.order_id where e.order_id = :'o1'), 'earnings booked: 65% driver share');
select test.ok((select jsonb_array_length(o->'inspection'->'pickup'->'photos') = 6 and o->'inspection'->'delivery'->'areas'->>'Front' = 'Dent'
  from jsonb_array_elements(public.get_app_state()->'orders') o where o->>'uuid' = :'o1'), 'inspection report in app state');
select test.ok((select string_agg(h->>'status', ',') = 'pending_payment,open,assigned,open,assigned,picked_up,in_transit,delivered'
  from jsonb_array_elements(public.get_app_state()->'orders') o, jsonb_array_elements(o->'history') h where o->>'uuid' = :'o1'), 'full status history');

-- ---- expenses
select test.err(format('insert into driver_expenses(driver_id, order_id, expense_type, amount_cents) values (%L, %L, ''train'', 4500)', :'d2', :'o2'), 'row-level security', 'no expense on another order');
insert into driver_expenses(driver_id, order_id, expense_type, amount_cents) values (:'d2', :'o1', 'train', 4500);

-- ---- customer view
reset role; select set_config('request.jwt.claim.sub', :'c1', false) \g /dev/null
set role authenticated;
select test.ok((select s->'drivers'->0->>'name' = 'Driver Two' and s->'drivers'->0->>'iban' is null and jsonb_array_length(s->'drivers') = 1 from public.get_app_state() s), 'customer sees only own driver, no IBAN');
select test.err(format('select public.cancel_order(%L)', :'o1'), 'contact us', 'customer cannot cancel delivered order');
select public.cancel_order(:'o2') \g /dev/null
select test.ok((select status = 'cancelled' from orders where id = :'o2'), 'customer cancels paid open order');

-- ---- admin: refunds, expenses, payouts
reset role; select set_config('request.jwt.claim.sub', :'admin', false) \g /dev/null
set role authenticated;
select public.admin_mark_refunded(:'o2') \g /dev/null
select test.err(format('select public.admin_mark_refunded(%L)', :'o2'), 'nothing to refund', 'cannot refund twice');
update driver_expenses set approval_status = 'approved', reviewed_by = :'admin', reviewed_at = now();
select test.ok(public.create_driver_payout(:'d2', null, true) is not null, 'admin pays out d2');
select test.ok((select p.status = 'paid' and p.payout_amount_cents = e.net_amount_cents + 4500 and e.status = 'paid'
  from driver_payouts p join driver_earnings e on e.payout_id = p.id where p.driver_id = :'d2'), 'payout = earnings + approved expense, marked paid');
select test.ok((select o->>'driverPaidAt' is not null from jsonb_array_elements(public.get_app_state()->'orders') o where o->>'uuid' = :'o1'), 'driverPaidAt shown in app state');
select test.err(format('select public.create_driver_payout(%L, null, true)', :'d2'), 'nothing to pay out', 'no double payout');
select test.ok((select jsonb_array_length(s->'orders') = 3 and jsonb_array_length(s->'drivers') = 3 and jsonb_array_length(s->'customers') = 1 and (s->'session'->>'admin')::boolean from public.get_app_state() s), 'admin sees everything');
select public.admin_update_settings('{"baseFee":59,"perKm":1.05,"minPrice":89,"vatRate":25.5,"driverShare":70,"roadFactor":1.15,"sameCityKm":15}') \g /dev/null
select test.ok((select base_fee_cents = 5900 and per_km_cents = 105 and driver_share = 70 from app_settings), 'admin updates pricing');
select test.ok((select price_net_cents = 4900 + 95*620 from orders where id = :'o1'), 'existing order price unchanged');
reset role; select set_config('request.jwt.claim.sub', :'c1', false) \g /dev/null
set role authenticated;
select public.demo_pay_order(:'o3', 'invoice') \g /dev/null
reset role; select set_config('request.jwt.claim.sub', :'admin', false) \g /dev/null
set role authenticated;
select public.admin_assign_driver(:'o3', :'d1') \g /dev/null
select test.err(format('select public.admin_assign_driver(%L, %L)', :'o3', :'d2'), 'no longer waiting', 'cannot assign twice');

-- ---- online payments (Trustly)
reset role; select set_config('request.jwt.claim.sub', :'c1', false) \g /dev/null
set role authenticated;
select (public.create_order(format('{"pickup_city":"Helsinki","pickup_address":"A 1","pickup_date":"%s","dropoff_city":"Lahti","dropoff_address":"B 2","car_model":"Golf","car_plate":"P-1"}', (now() at time zone 'Europe/Helsinki')::date)::jsonb))->>'uuid' as o4 \gset
select public.start_payment(:'o4', 'trustly')->>'payment_id' as pay1 \gset
select test.ok((select status = 'initiated' and amount_cents = (select price_total_cents from orders where id = :'o4') from payments where id = :'pay1'), 'customer starts a payment for the order total');
select test.err(format('select public.attach_provider_order(%L, ''T1'', ''https://x'')', :'pay1'), 'permission denied', 'customer cannot attach provider order');
select test.err(format('select public.record_payment_event(''trustly'', ''n0'', ''credit'', %L, null, 999999, ''EUR'', ''{}'')', :'pay1'), 'permission denied', 'customer cannot fake a payment notification');
reset role; set role service_role;
select public.attach_provider_order(:'pay1', 'T-1001', 'https://pay.example/1') \g /dev/null
select test.ok(public.record_payment_event('trustly', 'n1', 'pending', :'pay1', 'T-1001', null, 'EUR', '{}') = 'pending', 'pending notification');
select test.ok(public.record_payment_event('trustly', 'n2', 'credit', :'pay1', 'T-1001', 100, 'EUR', '{}') = 'amount_mismatch', 'too small credit is not accepted');
select test.ok(public.record_payment_event('trustly', 'n3', 'credit', :'pay1', 'T-9999', (select price_total_cents from orders where id = :'o4'), 'EUR', '{}') = 'order_id_mismatch', 'credit for another Trustly order is not accepted');
select test.ok((select status = 'pending_payment' from orders where id = :'o4'), 'order still unpaid after bad notifications');
select test.ok(public.record_payment_event('trustly', 'n4', 'credit', :'pay1', 'T-1001', (select price_total_cents from orders where id = :'o4'), 'EUR', '{}') = 'paid', 'valid credit marks the payment paid');
select test.ok((select status = 'open' and payment_method = 'trustly' and paid_at is not null from orders where id = :'o4'), 'order is paid and open for drivers');
select test.ok(public.record_payment_event('trustly', 'n4', 'credit', :'pay1', 'T-1001', (select price_total_cents from orders where id = :'o4'), 'EUR', '{}') = 'duplicate', 'repeated notification is ignored');
select test.ok((select count(*) = 1 from order_events where order_id = :'o4' and event_type = 'payment_received'), 'order marked paid exactly once');
reset role; select set_config('request.jwt.claim.sub', :'c1', false) \g /dev/null
set role authenticated;
select test.err(format('select public.start_payment(%L)', :'o4'), 'already paid', 'cannot start a second payment for a paid order');
select test.ok((select o->>'paymentStatus' = 'paid' from jsonb_array_elements(public.get_app_state()->'orders') o where o->>'uuid' = :'o4'), 'payment status visible to the customer');
select test.ok((select count(*) = 0 from payment_events), 'customer cannot read the payment log');
select public.cancel_order(:'o4') \g /dev/null
reset role; select set_config('request.jwt.claim.sub', :'d1', false) \g /dev/null
set role authenticated;
select test.err(format('select public.admin_refund_info(%L)', :'o4'), 'not allowed', 'driver cannot request refund details');
reset role; select set_config('request.jwt.claim.sub', :'admin', false) \g /dev/null
set role authenticated;
select test.ok((select public.admin_refund_info(:'o4')->>'provider_order_id') = 'T-1001', 'admin gets the Trustly order to refund');
reset role; set role service_role;
select public.complete_refund(:'pay1') \g /dev/null
select test.ok((select o.refunded_at is not null and p.status = 'refunded' from orders o join payments p on p.order_id = o.id where o.id = :'o4'), 'refund recorded on order and payment');
select test.err(format('select public.complete_refund(%L)', :'pay1'), 'not refundable', 'cannot refund twice');
select test.ok(public.record_payment_event('trustly', 'n9', 'credit', 'no-such-payment', 'T-0', 100, 'EUR', '{}') = 'unknown_payment', 'notification for unknown payment is logged, not applied');

-- ---- anon
reset role; select set_config('request.jwt.claim.sub', '', false) \g /dev/null
set role anon;
select test.ok((select jsonb_array_length(s->'orders') = 0 and (s->'settings'->>'baseFee')::numeric = 59 from public.get_app_state() s), 'visitor gets pricing only');
select test.err('select public.create_order(''{}'')', 'permission denied', 'visitor cannot create orders');
select test.ok((select count(*) = 0 from orders), 'visitor reads no orders');
reset role;
