-- Run against a scratch Postgres after local_supabase_stub.sql and the migration:
--   psql -f local_supabase_stub.sql && psql -f ../migrations/20261117000000_driver_jobs_and_earnings.sql && psql -f driver_jobs_test.sql
\set ON_ERROR_STOP 0
\pset tuples_only on
\set o1 '''00000000-0000-0000-0000-000000000001'''
\set o2 '''00000000-0000-0000-0000-000000000002'''
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;

\echo '--- 1. approved driver d1 accepts o1'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select public.accept_transfer(:o1);
\echo '--- 2. driver d2 tries o1'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2'); select public.accept_transfer(:o1);
\echo '--- 3. unapproved d3 tries o2'
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d3'); select public.accept_transfer(:o2);
\echo '--- 4. anon cannot execute'
reset role; set role anon; select public.accept_transfer(:o2);
reset role;
\echo '--- 5. d1 cancels o1, order reopened; d1 re-claims (should fail), d2 claims (should succeed)'
update order_assignments set status='cancelled', cancelled_at=now() where order_id=:o1;
update orders set status='open', assigned_driver_id=null where id=:o1;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1'); select public.accept_transfer(:o1);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2'); select public.accept_transfer(:o1);
reset role;
select 'orders.o1 driver = d2? ' || (assigned_driver_id::text like '%d2') from orders where id=:o1;
select 'events: ' || count(*) from order_events;
\echo '--- 6. constraints'
insert into driver_earnings(driver_id,order_id,gross_amount_cents,commission_cents,net_amount_cents) values ('00000000-0000-0000-0000-0000000000d2',:o1,10000,3500,9000);
insert into driver_earnings(driver_id,order_id,gross_amount_cents,commission_cents,net_amount_cents) values ('00000000-0000-0000-0000-0000000000d2',:o1,10000,3500,6500);
insert into order_assignments(order_id,driver_id,status) values (:o2,'00000000-0000-0000-0000-0000000000d1','Accepted');
\echo '--- 7. RLS: d1 sees no earnings of d2; cannot insert earnings; expense on unassigned order rejected; on own order ok'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select 'd1 sees earnings rows: ' || count(*) from driver_earnings;
insert into driver_earnings(driver_id,order_id,gross_amount_cents,commission_cents,net_amount_cents) values ('00000000-0000-0000-0000-0000000000d1',:o2,1,0,1);
insert into driver_expenses(driver_id,order_id,expense_type,amount_cents) values ('00000000-0000-0000-0000-0000000000d1',:o2,'train',4500);
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select 'd2 sees earnings rows: ' || count(*) from driver_earnings;
insert into driver_expenses(driver_id,order_id,expense_type,amount_cents) values ('00000000-0000-0000-0000-0000000000d2',:o1,'train',4500);
insert into driver_expenses(driver_id,order_id,expense_type,amount_cents,approval_status) values ('00000000-0000-0000-0000-0000000000d2',:o1,'fuel',100,'approved');
update driver_expenses set approval_status='approved';
select 'd2 expense status after own update attempt: ' || approval_status from driver_expenses;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update driver_expenses set approval_status='approved', reviewed_by=auth.uid(), reviewed_at=now();
select 'admin sees assignments: ' || count(*) || ', expense now ' || max(e.approval_status) from order_assignments, driver_expenses e;
