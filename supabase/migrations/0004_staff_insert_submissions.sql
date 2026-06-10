-- 0004_staff_insert_submissions.sql
-- Allow MIG staff to INSERT submissions on a customer's behalf, used by the
-- admin "Manual intake" tool (/admin/intake/) which scrapes a manually-filled
-- proposal form / emailed financial statements with the Claude API and records
-- the result as a submission "as if filled in online".
--
-- Staff are trusted; they may set any customer_id (or leave it NULL for an
-- unassigned intake). Customers keep their own narrow INSERT policy
-- ("Customers insert own submissions").

drop policy if exists "MIG staff can insert submissions" on public.submissions;
create policy "MIG staff can insert submissions"
  on public.submissions
  for insert
  to authenticated
  with check (is_mig_staff());
