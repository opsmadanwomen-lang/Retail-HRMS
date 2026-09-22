-- ============================================================================
-- Retail HRMS — permission_audit_history() gains role_module_scope
-- Migration 0165
--
-- FOUND while wiring the Users tab's Audit History filters (this session):
-- 0164 added `role_module_scope` (with the same write_audit_log() trigger
-- every other permission table already uses) but never added it to
-- permission_audit_history()'s table_name allow-list, so scope changes were
-- being audited into audit_logs correctly but never surfaced in the UI.
-- CREATE OR REPLACE, same signature, only the IN-list is widened.
-- ============================================================================
create or replace function public.permission_audit_history(p_limit int default 100)
returns table (id uuid, table_name text, record_id uuid, action public.audit_action, changed_data jsonb, performed_by_name text, performed_at timestamptz)
language sql stable security definer as $$
  select l.id, l.table_name, l.record_id, l.action, l.changed_data, e.full_name, l.performed_at
  from public.audit_logs l
  left join public.employees e on e.auth_user_id = l.performed_by
  where l.table_name in ('permission_modules','dynamic_roles','role_permissions','user_permission_overrides',
                          'role_field_permissions','user_field_permission_overrides','user_dynamic_roles',
                          'role_module_scope')
    and public.is_super_admin()
  order by l.performed_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;
grant execute on function public.permission_audit_history(int) to authenticated;
