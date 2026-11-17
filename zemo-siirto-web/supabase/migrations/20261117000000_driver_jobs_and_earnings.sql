-- ZEMO SIIRTO – driver job assignment, earnings, payouts and expenses.
--
-- Requires these existing tables:
--   public.profiles        (id uuid = auth.users.id, role text: 'customer' | 'driver' | 'admin')
--   public.driver_profiles (user_id uuid -> profiles.id, review_status text, is_available boolean)
--   public.orders          (id uuid, status text, assigned_driver_id uuid, assigned_at timestamptz)
--   public.order_events    (order_id uuid, actor_id uuid, event_type text, created_at timestamptz)

-- ---------------------------------------------------------------------------
-- Helper: is the current user an admin? (security definer so RLS policies can call it)
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
-- Assignments: which driver has (or had) which order
-- ---------------------------------------------------------------------------
create table public.order_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  driver_id uuid not null references public.profiles(id),
  status text not null default 'accepted'
    check (status in ('accepted', 'in_progress', 'completed', 'cancelled')),
  accepted_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancellation_reason text,
  check ((status = 'cancelled') = (cancelled_at is not null))
);

-- Only one active (or completed) driver per order.
create unique index one_active_driver_per_order
  on public.order_assignments (order_id)
  where status in ('accepted', 'in_progress', 'completed');

-- A driver can claim a given order only once (even after cancelling).
create unique index one_claim_per_driver_per_order
  on public.order_assignments (order_id, driver_id);

create index order_assignments_driver_idx on public.order_assignments (driver_id);

-- ---------------------------------------------------------------------------
-- Payouts (defined before earnings so earnings.payout_id can reference it)
-- ---------------------------------------------------------------------------
create table public.driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id),
  period_start date not null,
  period_end date not null,
  total_earnings_cents bigint not null default 0 check (total_earnings_cents >= 0),
  expense_reimbursements_cents bigint not null default 0 check (expense_reimbursements_cents >= 0),
  adjustments_cents bigint not null default 0,
  payout_amount_cents bigint not null default 0 check (payout_amount_cents >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  provider_transfer_id text,
  requested_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (driver_id, period_start, period_end),
  check (period_end >= period_start),
  check (payout_amount_cents = total_earnings_cents + expense_reimbursements_cents + adjustments_cents),
  check ((status = 'paid') = (paid_at is not null))
);

create index driver_payouts_driver_idx on public.driver_payouts (driver_id);

-- ---------------------------------------------------------------------------
-- Earnings: one row per completed order
-- ---------------------------------------------------------------------------
create table public.driver_earnings (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id),
  gross_amount_cents bigint not null check (gross_amount_cents >= 0),
  commission_cents bigint not null check (commission_cents >= 0),
  net_amount_cents bigint not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  status text not null default 'pending'
    check (status in ('pending', 'in_payout', 'paid', 'cancelled')),
  completed_at timestamptz not null default now(),
  payout_id uuid references public.driver_payouts(id),
  created_at timestamptz not null default now(),
  unique (order_id),
  check (net_amount_cents = gross_amount_cents - commission_cents),
  check (status not in ('in_payout', 'paid') or payout_id is not null)
);

create index driver_earnings_driver_idx on public.driver_earnings (driver_id);
create index driver_earnings_payout_idx on public.driver_earnings (payout_id);

-- ---------------------------------------------------------------------------
-- Expenses: e.g. train ticket back home, fuel, charging, parking
-- ---------------------------------------------------------------------------
create table public.driver_expenses (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id),
  order_id uuid not null references public.orders(id),
  expense_type text not null
    check (expense_type in ('fuel', 'charging', 'train', 'bus', 'taxi', 'parking', 'toll', 'other')),
  amount_cents bigint not null check (amount_cents > 0),
  receipt_path text,
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  payout_id uuid references public.driver_payouts(id),
  created_at timestamptz not null default now()
);

create index driver_expenses_driver_idx on public.driver_expenses (driver_id);
create index driver_expenses_order_idx on public.driver_expenses (order_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- Writes to assignments, earnings and payouts go through security-definer
-- functions or the service role only; clients can only read their own rows.
-- ---------------------------------------------------------------------------
alter table public.order_assignments enable row level security;
alter table public.driver_payouts    enable row level security;
alter table public.driver_earnings   enable row level security;
alter table public.driver_expenses   enable row level security;

create policy "Drivers read own assignments, admins read all"
  on public.order_assignments for select to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_admin()));

create policy "Drivers read own payouts, admins read all"
  on public.driver_payouts for select to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_admin()));

create policy "Drivers read own earnings, admins read all"
  on public.driver_earnings for select to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_admin()));

create policy "Drivers read own expenses, admins read all"
  on public.driver_expenses for select to authenticated
  using (driver_id = (select auth.uid()) or (select public.is_admin()));

-- Drivers may submit expenses only for orders they are (or were) actively assigned to,
-- and only as unreviewed, unpaid claims.
create policy "Drivers submit expenses for their own orders"
  on public.driver_expenses for insert to authenticated
  with check (
    driver_id = (select auth.uid())
    and approval_status = 'pending'
    and reviewed_by is null and reviewed_at is null and payout_id is null
    and exists (
      select 1 from public.order_assignments a
      where a.order_id = driver_expenses.order_id
        and a.driver_id = (select auth.uid())
        and a.status in ('accepted', 'in_progress', 'completed')
    )
  );

create policy "Admins review expenses"
  on public.driver_expenses for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- accept_transfer: a driver claims an open job.
-- Only one driver can win an order, and a driver can claim an order only once.
-- ---------------------------------------------------------------------------
create or replace function public.accept_transfer(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver_id uuid;
  v_status text;
begin
  -- Identify the authenticated, approved and available driver
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

  -- Lock the order row so two drivers cannot claim it at the same time
  select o.status
  into v_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found or v_status <> 'open' then
    return jsonb_build_object('success', false, 'message', 'Job is no longer available');
  end if;

  if exists (
    select 1 from public.order_assignments a
    where a.order_id = p_order_id and a.driver_id = v_driver_id
  ) then
    return jsonb_build_object('success', false, 'message', 'You have already claimed this job once');
  end if;

  insert into public.order_assignments (order_id, driver_id, status)
  values (p_order_id, v_driver_id, 'accepted');

  update public.orders
  set status = 'assigned',
      assigned_driver_id = v_driver_id,
      assigned_at = now()
  where id = p_order_id;

  insert into public.order_events (order_id, actor_id, event_type, created_at)
  values (p_order_id, v_driver_id, 'driver_accepted', now());

  return jsonb_build_object('success', true, 'message', 'Job successfully assigned');

exception
  -- Safety net: the unique indexes reject a second active driver or a second claim
  when unique_violation then
    return jsonb_build_object('success', false, 'message', 'Job was already accepted');
end;
$$;

revoke all on function public.accept_transfer(uuid) from public, anon;
grant execute on function public.accept_transfer(uuid) to authenticated;
