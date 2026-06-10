-- ============================================================
-- Confidentiality phase 1 (ADDITIVE — safe to apply before code ships).
-- Underwriter-only data moves to a staff-only table so customers can't read it
-- via the API on their own submissions. The legacy columns are KEPT here; they
-- are dropped in 0008 AFTER the new code is live (see that file).
-- ============================================================
create table if not exists public.submission_private (
  submission_id  uuid primary key references public.submissions(id) on delete cascade,
  internal_notes text,
  ai_analysis    jsonb,
  ai_analyzed_at timestamptz,
  assigned_to    uuid,
  updated_at     timestamptz not null default now()
);
alter table public.submission_private enable row level security;

drop policy if exists "Staff manage submission_private" on public.submission_private;
create policy "Staff manage submission_private" on public.submission_private
  for all to authenticated using (public.is_mig_staff()) with check (public.is_mig_staff());

-- migrate existing underwriter-only data
insert into public.submission_private (submission_id, internal_notes, ai_analysis, ai_analyzed_at, assigned_to)
  select id, internal_notes, ai_analysis, ai_analyzed_at, assigned_to from public.submissions
  on conflict (submission_id) do update set
    internal_notes = excluded.internal_notes,
    ai_analysis    = excluded.ai_analysis,
    ai_analyzed_at = excluded.ai_analyzed_at,
    assigned_to    = excluded.assigned_to;

drop trigger if exists submission_private_updated_at on public.submission_private;
create trigger submission_private_updated_at before update on public.submission_private
  for each row execute function public.set_updated_at();
