-- ============================================================
-- Quotations persistence + customer access to quotations & policies
-- Applied to project iyazmdzqyogyrvexpasf via Supabase migration
-- "quotations_and_customer_document_access". Kept here for source control.
-- ============================================================
create table if not exists public.quotations (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  submission_id uuid references public.submissions(id) on delete set null,
  customer_id   uuid references auth.users(id),
  reference     text,
  currency      text,
  total_premium numeric,
  lines         jsonb,
  doc_base64    text,
  doc_filename  text,
  status        text not null default 'sent'
);
create index if not exists quotations_customer_idx on public.quotations(customer_id);
create index if not exists quotations_submission_idx on public.quotations(submission_id);
alter table public.quotations enable row level security;

drop policy if exists "Staff manage quotations" on public.quotations;
create policy "Staff manage quotations" on public.quotations
  for all to authenticated using (public.is_mig_staff()) with check (public.is_mig_staff());

drop policy if exists "Customers read own quotations" on public.quotations;
create policy "Customers read own quotations" on public.quotations
  for select to authenticated using (customer_id = auth.uid());

-- Store the issued policy document so customers can download the wording.
alter table public.cyber_policies add column if not exists doc_base64 text;
alter table public.cyber_policies add column if not exists doc_filename text;
alter table public.crime_policies add column if not exists doc_base64 text;
alter table public.crime_policies add column if not exists doc_filename text;

-- Customers may read policies issued against their own submissions.
drop policy if exists "Customers read own cyber policies" on public.cyber_policies;
create policy "Customers read own cyber policies" on public.cyber_policies
  for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = cyber_policies.submission_id and s.customer_id = auth.uid()));

drop policy if exists "Customers read own crime policies" on public.crime_policies;
create policy "Customers read own crime policies" on public.crime_policies
  for select to authenticated
  using (exists (select 1 from public.submissions s where s.id = crime_policies.submission_id and s.customer_id = auth.uid()));
