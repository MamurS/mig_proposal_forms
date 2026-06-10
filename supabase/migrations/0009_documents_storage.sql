-- ============================================================
-- Documents Storage bucket + RLS (ADDITIVE).
-- New policy/quotation .docx files are uploaded to Storage and referenced by
-- doc_path, instead of being stored base64 in the row (which bloats the DB and
-- every read). Documents created before this change keep their doc_base64 and
-- are served from it as a fallback — no bulk data migration required.
-- Object path scheme: <kind>/<customer_id>/<id>.docx  (kind = policies|quotations)
-- ============================================================
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
  on conflict (id) do nothing;

alter table public.cyber_policies add column if not exists doc_path text;
alter table public.crime_policies add column if not exists doc_path text;
alter table public.quotations     add column if not exists doc_path text;

-- Staff manage all documents.
drop policy if exists "Staff manage documents" on storage.objects;
create policy "Staff manage documents" on storage.objects for all to authenticated
  using (bucket_id = 'documents' and public.is_mig_staff())
  with check (bucket_id = 'documents' and public.is_mig_staff());

-- Customers may read their own documents (folder[2] is their auth uid).
drop policy if exists "Customers read own documents" on storage.objects;
create policy "Customers read own documents" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[2] = auth.uid()::text);
