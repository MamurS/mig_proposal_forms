-- ============================================================
-- INN (taxpayer identification number) on every record
-- Applied to project iyazmdzqyogyrvexpasf via Supabase migration
-- "inn_codes". Kept here for source control.
-- ============================================================
-- Customers carry a company INN (entered on the account form). It then flows
-- onto every proposal, quotation and policy so each document is tied to the
-- customer by both company name and INN. All columns are nullable text — the
-- existing RLS policies on each table already cover the new columns.

alter table public.customers      add column if not exists inn text;
alter table public.submissions    add column if not exists proposer_inn text;
alter table public.quotations     add column if not exists inn text;
alter table public.cyber_policies add column if not exists inn text;
alter table public.crime_policies add column if not exists inn text;
