-- ============================================================
-- Financial-statements Storage bucket (private) + RLS policies
-- Applied to project iyazmdzqyogyrvexpasf via Supabase migration
-- "financial_statements_storage_bucket". Kept here for source control.
--
-- Model: the proposal form is account-only, so uploads come from an
-- authenticated CUSTOMER, scoped to their own auth.uid()/ folder. No public
-- (anon) write/listing. Staff may read all for underwriting review.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'financial-statements', 'financial-statements', false, 10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png', 'image/jpeg'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "FS customers upload own" on storage.objects;
create policy "FS customers upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'financial-statements'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_customer()
  );

drop policy if exists "FS customers read own" on storage.objects;
create policy "FS customers read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'financial-statements' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "FS customers update own" on storage.objects;
create policy "FS customers update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'financial-statements' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'financial-statements' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "FS staff read all" on storage.objects;
create policy "FS staff read all" on storage.objects
  for select to authenticated
  using (bucket_id = 'financial-statements' and public.is_mig_staff());
