-- ============================================================================
-- Retail HRMS — Advance Management (operational, staff-wise Advance Ledger)
-- Migration 0154
--
-- WHY: the existing "Advance Management" page (src/modules/advance/pages/
-- AdvanceManagementPage.tsx, route /settings/advance-management) is CONFIGURATION
-- only — Advance Types, Policies, Assignment, Final Approver, HR/Finance
-- Processors, Payment Modes, Notifications (already correctly labelled
-- "Advance Settings" in the breadcrumb/Settings-Center — Breadcrumbs.tsx,
-- SettingsPage.tsx). This migration adds the READ-ONLY, OPERATIONAL,
-- staff-wise Advance Ledger requested for the MAIN sidebar. It does not
-- touch a single existing table, RPC, trigger, or RLS policy from migrations
-- 0132-0136 (Advance Types/Policies/Approval/HR/Finance/Recovery) — it only
-- ADDS new, additive, read-only aggregation RPCs that re-present the exact
-- same authoritative numbers those phases already compute and cache
-- (advance_requests.boss_approved_amount, advance_finance_payments.
-- payment_amount, advance_recovery_plans.total_recovered/total_settled/
-- outstanding_amount). No new Advance table. No parallel recovery engine.
--
-- SCOPE / SECURITY MODEL:
--   - Every advance_ledger_* function is SECURITY DEFINER, `stable`, company-
--     scoped via the existing current_user_company_id(), and rejects
--     current_user_role() = 'staff' outright (this is an HR/Admin
--     operational page — a Staff account's own advances remain served by
--     the existing advance_list_my_requests()/advance_list_my_recoveries()
--     RPCs, entirely unaffected by this migration).
--   - Store-scope enforcement reuses the EXISTING public.profiles.store_id
--     column (migration 0076 — "Store Scope: null = All Stores, set =
--     Specific Store", already present for store_manager/department_manager/
--     operations_manager logins but not yet enforced by any RPC/RLS
--     anywhere in the codebase — confirmed by inspection of migration 0075's
--     own notes). This migration is the first to give that column real
--     server-side teeth, for exactly this feature's requirement ("HR store
--     access must be enforced server-side, never client-side only"). It is
--     additive: no other page's behavior changes, since no other RPC reads
--     current_user_store_id().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. current_user_store_id() — mirrors current_user_company_id()/
--    current_user_role() exactly (migration 0005). null = "All Stores".
-- ---------------------------------------------------------------------------
create or replace function public.current_user_store_id()
returns uuid as $$
  select store_id from public.profiles where id = auth.uid();
$$ language sql stable security definer;

comment on function public.current_user_store_id() is
  'Store Scope of the calling profile (public.profiles.store_id, migration 0076). NULL = All Stores. Consulted by advance_ledger_* (migration 0154) to restrict the Store filter server-side; not consulted anywhere else.';

-- Helpful composite index for the employee-wise aggregation below (existing
-- idx_advance_requests_employee is (employee_id, status); this adds the
-- company+employee pairing used by the ledger's per-employee EXISTS checks).
create index if not exists idx_advance_requests_company_employee
  on public.advance_requests (company_id, employee_id);

-- ---------------------------------------------------------------------------
-- 1. advance_ledger_stores() — the Store dropdown. Company-scoped, and
--    restricted to the caller's single assigned store when profiles.store_id
--    is set (real enforcement — see header note above).
-- ---------------------------------------------------------------------------
create or replace function public.advance_ledger_stores()
returns table (id uuid, name text)
language sql
stable
security definer
as $$
  select s.id, s.name
  from public.stores s
  where public.current_user_role() <> 'staff'
    and s.company_id = public.current_user_company_id()
    and (public.current_user_store_id() is null or s.id = public.current_user_store_id())
  order by s.name;
$$;

grant execute on function public.advance_ledger_stores() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. advance_ledger_rows(...) — internal, unpaginated row set. The single
--    source of truth both advance_ledger_list() and advance_ledger_summary()
--    build on, so the table and the summary cards can never disagree.
--
--    Amount definitions (per spec, never derived from requested_amount):
--      total_approved   = sum(advance_requests.boss_approved_amount)
--      total_paid       = sum(advance_finance_payments.payment_amount) where status = 'paid'
--      total_recovered  = sum(advance_recovery_plans.total_recovered + total_settled)
--      total_outstanding = sum(
--          recovery plan's own outstanding_amount when a plan exists (the
--          authoritative, backend-recomputed cache from advance_recovery_
--          recompute_plan — migration 0136), else the paid amount itself
--          when paid but no recovery plan/schedule has been generated yet
--          (nothing recovered = fully outstanding), else 0.
--        )
--    This never recomputes recovery math — it only reads the existing caches.
-- ---------------------------------------------------------------------------
create or replace function public.advance_ledger_rows(
  p_store_id uuid default null,
  p_department_id uuid default null,
  p_designation_id uuid default null,
  p_employee_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_show_all boolean default false
)
returns table (
  employee_id uuid,
  employee_code text,
  full_name text,
  mobile text,
  email text,
  store_id uuid,
  store_name text,
  department_name text,
  designation_title text,
  advance_count int,
  total_approved numeric,
  total_paid numeric,
  total_recovered numeric,
  total_outstanding numeric,
  derived_status text
)
language plpgsql
stable
security definer
as $$
declare
  v_company_id uuid := public.current_user_company_id();
  v_store_scope uuid := public.current_user_store_id();
  v_effective_store uuid;
begin
  if public.current_user_role() = 'staff' then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  if v_store_scope is not null then
    if p_store_id is not null and p_store_id <> v_store_scope then
      raise exception 'Not authorized for the selected store.' using errcode = '42501';
    end if;
    v_effective_store := v_store_scope;
  else
    v_effective_store := p_store_id;
  end if;

  return query
  with agg as (
    select
      ar.employee_id as emp_id,
      count(*)::int as advance_count,
      sum(coalesce(ar.boss_approved_amount, 0)) as total_approved,
      sum(coalesce(fp.payment_amount, 0)) filter (where fp.status = 'paid') as total_paid,
      sum(coalesce(rp.total_recovered, 0) + coalesce(rp.total_settled, 0)) as total_recovered,
      sum(
        case
          when rp.id is not null then rp.outstanding_amount
          when fp.status = 'paid' then coalesce(fp.payment_amount, 0)
          else 0
        end
      ) as total_outstanding,
      bool_or(ar.status in (
        'manager_pending', 'boss_pending', 'hr_pending', 'hr_on_hold', 'hr_sent_back',
        'finance_pending', 'finance_processing', 'finance_on_hold'
      )) as has_pending,
      bool_and(ar.status = 'closed') as all_closed
    from public.advance_requests ar
    left join public.advance_finance_payments fp on fp.advance_request_id = ar.id
    left join public.advance_recovery_plans rp on rp.advance_request_id = ar.id
    where ar.company_id = v_company_id
    group by ar.employee_id
  )
  select
    e.id,
    e.employee_code,
    e.full_name,
    e.mobile,
    e.email,
    e.store_id,
    st.name,
    sd.name,
    sdz.title,
    coalesce(a.advance_count, 0),
    coalesce(a.total_approved, 0),
    coalesce(a.total_paid, 0),
    coalesce(a.total_recovered, 0),
    coalesce(a.total_outstanding, 0),
    case
      when a.emp_id is null then 'no_advance'
      when a.has_pending then 'pending'
      -- Nothing was ever actually paid (every advance ended rejected / cancelled / sent-back, or
      -- approved but never disbursed) — the lifecycle ended without money changing hands, which is
      -- "closed", never "fully_recovered" (that label implies money was paid back).
      when coalesce(a.total_paid, 0) = 0 then 'closed'
      when coalesce(a.total_outstanding, 0) = 0 then (case when a.all_closed then 'closed' else 'fully_recovered' end)
      when coalesce(a.total_recovered, 0) = 0 then 'active'
      else 'partially_recovered'
    end
  from public.employees e
  left join agg a on a.emp_id = e.id
  left join public.stores st on st.id = e.store_id
  left join public.store_departments sd on sd.id = e.store_department_id
  left join public.store_designations sdz on sdz.id = e.store_designation_id
  where e.company_id = v_company_id
    and (v_effective_store is null or e.store_id = v_effective_store)
    and (p_department_id is null or e.store_department_id = p_department_id)
    and (p_designation_id is null or e.store_designation_id = p_designation_id)
    and (p_employee_id is null or e.id = p_employee_id)
    and (p_show_all or a.emp_id is not null)
    and (
      p_search is null or p_search = '' or
      e.full_name ilike '%' || p_search || '%' or
      e.employee_code ilike '%' || p_search || '%' or
      e.mobile ilike '%' || p_search || '%' or
      e.email ilike '%' || p_search || '%'
    )
    and (
      p_status is null or exists (
        select 1 from public.advance_requests ar2
        where ar2.employee_id = e.id and ar2.company_id = v_company_id and ar2.status = p_status
      )
    )
    and (
      (p_date_from is null and p_date_to is null) or exists (
        select 1 from public.advance_requests ar3
        where ar3.employee_id = e.id and ar3.company_id = v_company_id
          and (p_date_from is null or ar3.requested_at::date >= p_date_from)
          and (p_date_to is null or ar3.requested_at::date <= p_date_to)
      )
    );
end;
$$;

comment on function public.advance_ledger_rows is
  'Internal — the single unpaginated row set advance_ledger_list()/advance_ledger_summary() both build on, so the table and its summary cards can never disagree. Status/date filters select WHICH employees appear (does the employee have a matching advance); they never change the summed totals, which always reflect ALL of that employee''s advances (per spec: never combine unrelated employees, never corrupt a multi-advance employee''s combined totals).';

-- Internal only (same convention as advance_recovery_recompute_plan, migration 0136) — its own
-- staff/company/store checks make direct calls harmless, but it is not part of the public API.
revoke execute on function public.advance_ledger_rows(uuid, uuid, uuid, uuid, text, text, date, date, boolean) from public, authenticated;

-- ---------------------------------------------------------------------------
-- 3. advance_ledger_list(...) — paginated wrapper, `total_count` window
--    column for the UI's Previous/Next controls.
-- ---------------------------------------------------------------------------
create or replace function public.advance_ledger_list(
  p_store_id uuid default null,
  p_department_id uuid default null,
  p_designation_id uuid default null,
  p_employee_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_show_all boolean default false,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  employee_id uuid,
  employee_code text,
  full_name text,
  mobile text,
  email text,
  store_id uuid,
  store_name text,
  department_name text,
  designation_title text,
  advance_count int,
  total_approved numeric,
  total_paid numeric,
  total_recovered numeric,
  total_outstanding numeric,
  derived_status text,
  total_count bigint
)
language sql
stable
security definer
as $$
  select r.*, count(*) over ()::bigint as total_count
  from public.advance_ledger_rows(
    p_store_id, p_department_id, p_designation_id, p_employee_id,
    p_status, p_search, p_date_from, p_date_to, p_show_all
  ) r
  order by r.full_name
  limit greatest(coalesce(p_limit, 50), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.advance_ledger_list(uuid, uuid, uuid, uuid, text, text, date, date, boolean, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. advance_ledger_summary(...) — the 5 summary cards, same filters (minus
--    pagination), same underlying rows as the table so the numbers can never
--    disagree with it.
-- ---------------------------------------------------------------------------
create or replace function public.advance_ledger_summary(
  p_store_id uuid default null,
  p_department_id uuid default null,
  p_designation_id uuid default null,
  p_employee_id uuid default null,
  p_status text default null,
  p_search text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_show_all boolean default false
)
returns table (
  total_staff bigint,
  total_approved numeric,
  total_paid numeric,
  total_recovered numeric,
  total_outstanding numeric
)
language sql
stable
security definer
as $$
  select
    count(*)::bigint,
    coalesce(sum(r.total_approved), 0),
    coalesce(sum(r.total_paid), 0),
    coalesce(sum(r.total_recovered), 0),
    coalesce(sum(r.total_outstanding), 0)
  from public.advance_ledger_rows(
    p_store_id, p_department_id, p_designation_id, p_employee_id,
    p_status, p_search, p_date_from, p_date_to, p_show_all
  ) r;
$$;

grant execute on function public.advance_ledger_summary(uuid, uuid, uuid, uuid, text, text, date, date, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. advance_ledger_employee_advances(p_employee_id) — the per-advance
--    breakdown for the "View Details" drawer (spec item 8). Recovery history
--    itself is NOT duplicated here — the existing advance_list_recovery_
--    transactions()/advance_list_recovery_installments()/advance_get_recovery_
--    detail() RPCs (migration 0136) already serve it, called per advance_
--    request_id exactly like AdvanceRecoveryPage.tsx's RecoveryDetailDialog
--    already does.
-- ---------------------------------------------------------------------------
create or replace function public.advance_ledger_employee_advances(p_employee_id uuid)
returns table (
  advance_request_id uuid,
  advance_type_name text,
  request_date timestamptz,
  requested_amount numeric,
  manager_recommended_amount numeric,
  boss_approved_amount numeric,
  actual_paid_amount numeric,
  payment_date date,
  recovery_start_date date,
  total_recovered numeric,
  outstanding_amount numeric,
  status text
)
language plpgsql
stable
security definer
as $$
declare
  v_company_id uuid := public.current_user_company_id();
  v_store_scope uuid := public.current_user_store_id();
  v_emp record;
begin
  if public.current_user_role() = 'staff' then
    raise exception 'Not authorized.' using errcode = '42501';
  end if;

  select id, company_id, store_id into v_emp from public.employees where id = p_employee_id;
  if v_emp.id is null or v_emp.company_id <> v_company_id then
    raise exception 'Employee not found.';
  end if;
  -- NULL-safe: a company-wide employee (employee_scope='company_wide', store_id NULL — migration
  -- 0061) must NOT slip past a store-restricted caller just because `<>` against NULL is neither
  -- true nor false. Explicitly treat "no store on the employee" as "not this caller's store".
  if v_store_scope is not null and (v_emp.store_id is null or v_emp.store_id <> v_store_scope) then
    raise exception 'Not authorized for this employee''s store.' using errcode = '42501';
  end if;

  return query
  select
    ar.id,
    att.name,
    ar.requested_at,
    ar.requested_amount,
    ar.manager_recommended_amount,
    ar.boss_approved_amount,
    fp.payment_amount,
    fp.payment_date,
    rp.recovery_start_date,
    coalesce(rp.total_recovered, 0) + coalesce(rp.total_settled, 0),
    case
      when rp.id is not null then rp.outstanding_amount
      when fp.status = 'paid' then coalesce(fp.payment_amount, 0)
      else 0
    end,
    ar.status
  from public.advance_requests ar
  join public.advance_types att on att.id = ar.advance_type_id
  left join public.advance_finance_payments fp on fp.advance_request_id = ar.id
  left join public.advance_recovery_plans rp on rp.advance_request_id = ar.id
  where ar.employee_id = p_employee_id and ar.company_id = v_company_id
  order by ar.requested_at desc;
end;
$$;

grant execute on function public.advance_ledger_employee_advances(uuid) to authenticated;
