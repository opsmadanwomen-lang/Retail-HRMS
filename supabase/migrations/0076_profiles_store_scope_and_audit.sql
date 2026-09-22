-- ============================================================================
-- Retail HRMS — User & Role Management: profiles.store_id (Store Scope) +
-- reuse the EXISTING generic audit trigger for profiles
-- Migration 0076
--
-- STORE SCOPE: profiles.store_id (nullable) is the "All Stores" (null) /
-- "Specific Store" store scope from the Create/Edit User form. Reuses the
-- existing public.stores table directly — no duplicate store table. Meaning
-- by role: store_manager / department_manager / operations_manager (staff
-- login) treat it as their assigned store; super_admin / company_admin /
-- super_manager are inherently company-wide regardless of this column
-- (super_manager's real scope, as established, comes from
-- attendance_super_managers, not from this column at all).
--
-- AUDIT: reuses the EXISTING generic public.write_audit_log() trigger
-- (migration 0004, already attached to companies/stores/employees) instead
-- of building a second audit mechanism. Attaching it to `profiles` captures
-- every User Management action required by this task's audit requirement
-- as a plain insert/update row in the existing public.audit_logs table,
-- with a full before/after JSON diff:
--   Created User        -> insert row
--   Updated User / Role Changed / Store Scope Changed / Activated /
--   Deactivated          -> update row (changed_data.old vs .new shows
--                            exactly which column changed)
--   Password Reset Requested -> also an update row, since resetting a
--                            password always flips must_change_password
--                            true as part of the same action (see the new
--                            user-account Edge Function) — no separate
--                            tracking needed.
-- No new audit table, no new trigger function.
-- ============================================================================

alter table public.profiles
  add column if not exists store_id uuid references public.stores (id) on delete set null;

create index if not exists idx_profiles_store_id on public.profiles (store_id);

comment on column public.profiles.store_id is
  'Store Scope for User Management: null = All Stores, set = Specific Store. Reuses public.stores. Not consulted for super_admin/company_admin (company-wide) or Super Manager (whose real scope is attendance_super_managers, company-wide by table design).';

drop trigger if exists trg_profiles_audit on public.profiles;
create trigger trg_profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.write_audit_log();
