-- ============================================================
-- Linking, integrity, audit & security hardening (ADDITIVE — safe to apply
-- before the matching app code ships). Applied to project iyazmdzqyogyrvexpasf.
-- ============================================================

-- 1) Direct customer linkage on rater quotes & policies (quotations already has it)
alter table public.cyber_quotes   add column if not exists customer_id uuid references auth.users(id);
alter table public.crime_quotes   add column if not exists customer_id uuid references auth.users(id);
alter table public.cyber_policies add column if not exists customer_id uuid references auth.users(id);
alter table public.crime_policies add column if not exists customer_id uuid references auth.users(id);
create index if not exists submissions_customer_idx    on public.submissions(customer_id);
create index if not exists cyber_quotes_customer_idx   on public.cyber_quotes(customer_id);
create index if not exists crime_quotes_customer_idx   on public.crime_quotes(customer_id);
create index if not exists cyber_policies_customer_idx on public.cyber_policies(customer_id);
create index if not exists crime_policies_customer_idx on public.crime_policies(customer_id);

-- 2) Backfill: every record must be linked to its customer.
--    a) submissions: match proposer_inn -> customers.inn (general, always correct)
update public.submissions s set customer_id = c.user_id
from public.customers c
where s.customer_id is null and s.proposer_inn is not null and nullif(s.proposer_inn,'') = c.inn;

--    b) Single-customer environment: link every remaining customer-less record to the
--       sole customer + submission (there has only ever been one). Idempotent.
do $$
declare v_cust uuid; v_sub uuid; v_inn text; n_cust int; n_sub int;
begin
  select count(*) into n_cust from public.customers;
  select count(*) into n_sub  from public.submissions;
  if n_cust = 1 and n_sub = 1 then
    select user_id, inn into v_cust, v_inn from public.customers;
    select id into v_sub from public.submissions;
    update public.submissions  set customer_id = coalesce(customer_id, v_cust);
    update public.quotations    set customer_id = coalesce(customer_id, v_cust), submission_id = coalesce(submission_id, v_sub), inn = coalesce(nullif(inn,''), v_inn);
    update public.cyber_quotes  set customer_id = coalesce(customer_id, v_cust), submission_id = coalesce(submission_id, v_sub);
    update public.crime_quotes  set customer_id = coalesce(customer_id, v_cust), submission_id = coalesce(submission_id, v_sub);
    update public.cyber_policies set customer_id = coalesce(customer_id, v_cust), submission_id = coalesce(submission_id, v_sub), inn = coalesce(nullif(inn,''), v_inn);
    update public.crime_policies set customer_id = coalesce(customer_id, v_cust), submission_id = coalesce(submission_id, v_sub), inn = coalesce(nullif(inn,''), v_inn);
  end if;
end $$;

-- 3) Concurrency / freshness: updated_at + trigger on the doc tables (submissions already had one)
alter table public.customers      add column if not exists updated_at timestamptz not null default now();
alter table public.quotations     add column if not exists updated_at timestamptz not null default now();
alter table public.cyber_quotes   add column if not exists updated_at timestamptz not null default now();
alter table public.crime_quotes   add column if not exists updated_at timestamptz not null default now();
alter table public.cyber_policies add column if not exists updated_at timestamptz not null default now();
alter table public.crime_policies add column if not exists updated_at timestamptz not null default now();
do $$
declare t text;
begin
  foreach t in array array['customers','quotations','cyber_quotes','crime_quotes','cyber_policies','crime_policies'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- 4) Soft-delete for customers (insurance records must be retained — never hard-delete a
--    customer who has linked documents).
alter table public.customers add column if not exists disabled boolean not null default false;

-- 5) Integrity constraints
alter table public.submissions drop constraint if exists submissions_products_valid;
alter table public.submissions add constraint submissions_products_valid
  check (products is null or products <@ array['auto','property','cgl','car','dno','pi','crime','cyber']::text[]);
-- policy numbers must be unique when set (prevents duplicate-numbered policies)
create unique index if not exists cyber_policies_polnum_uniq on public.cyber_policies (policy_number) where policy_number <> '';
create unique index if not exists crime_policies_polnum_uniq on public.crime_policies (policy_number) where policy_number <> '';

-- 6) Audit log (compliance — who changed what). Heavy/blob columns are stripped to keep it lean.
create table if not exists public.audit_log (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  actor   uuid default auth.uid(),
  tbl     text not null,
  op      text not null,
  row_id  text,
  changed jsonb
);
alter table public.audit_log enable row level security;
drop policy if exists "Staff read audit" on public.audit_log;
create policy "Staff read audit" on public.audit_log for select to authenticated using (public.is_mig_staff());

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare j jsonb; k text;
        heavy text[] := array['payload','doc_base64','pdfBase64','inputs','breakdown','fields','tables','lines','ai_analysis','attachments'];
begin
  j := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  foreach k in array heavy loop j := j - k; end loop;
  insert into public.audit_log(actor, tbl, op, row_id, changed)
  values (auth.uid(), tg_table_name, tg_op, coalesce(j->>'id', j->>'user_id', j->>'submission_id'), j);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['submissions','customers','quotations','cyber_policies','crime_policies'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t, t);
  end loop;
end $$;

-- 7) Security hardening (advisors): pin search_path; stop exposing the privileged
--    event-trigger helper as a callable RPC.
alter function public.set_updated_at()        set search_path = public, pg_temp;
alter function public.is_mig_staff()           set search_path = public, pg_temp;
alter function public.is_mig_staff(uuid)       set search_path = public, pg_temp;
alter function public.is_mig_admin(uuid)       set search_path = public, pg_temp;
alter function public.is_customer()            set search_path = public, pg_temp;
alter function public.rls_auto_enable()        set search_path = public, pg_temp;
revoke execute on function public.rls_auto_enable() from anon, authenticated, public;
revoke execute on function public.audit_trigger()  from anon, authenticated, public;
