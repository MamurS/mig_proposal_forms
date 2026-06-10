-- ============================================================
-- Customer portal: ownership + RLS
-- Applied to project iyazmdzqyogyrvexpasf via Supabase migration
-- "customer_portal_ownership_and_rls". Kept here for source control.
-- ============================================================

-- 1. Ownership column on submissions
alter table public.submissions
  add column if not exists customer_id uuid references auth.users(id);
create index if not exists submissions_customer_id_idx
  on public.submissions (customer_id);

-- 2. Customers profile table
create table if not exists public.customers (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  company    text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.customers enable row level security;

-- Helper: is the current user a provisioned customer?
create or replace function public.is_customer()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.customers where user_id = auth.uid())
$$;

-- customers policies
drop policy if exists "Customers read own profile" on public.customers;
create policy "Customers read own profile" on public.customers
  for select using (user_id = auth.uid());

drop policy if exists "Staff read all customers" on public.customers;
create policy "Staff read all customers" on public.customers
  for select using (public.is_mig_staff());

drop policy if exists "Admins manage customers" on public.customers;
create policy "Admins manage customers" on public.customers
  for all using (public.is_mig_admin(auth.uid()))
  with check (public.is_mig_admin(auth.uid()));

-- 3. submissions RLS rework — account-only
drop policy if exists "Anyone can submit a proposal" on public.submissions;

drop policy if exists "Customers insert own submissions" on public.submissions;
create policy "Customers insert own submissions" on public.submissions
  for insert to authenticated
  with check (customer_id = auth.uid() and public.is_customer());

drop policy if exists "Customers read own submissions" on public.submissions;
create policy "Customers read own submissions" on public.submissions
  for select to authenticated
  using (customer_id = auth.uid());

drop policy if exists "Customers update own new submissions" on public.submissions;
create policy "Customers update own new submissions" on public.submissions
  for update to authenticated
  using (customer_id = auth.uid() and status = 'new')
  with check (customer_id = auth.uid() and status = 'new');

drop policy if exists "Customers delete own new submissions" on public.submissions;
create policy "Customers delete own new submissions" on public.submissions
  for delete to authenticated
  using (customer_id = auth.uid() and status = 'new');
