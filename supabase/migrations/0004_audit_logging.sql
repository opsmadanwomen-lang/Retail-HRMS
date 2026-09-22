-- ============================================================================
-- Retail HRMS — Phase 1 Part 1
-- Migration 0004: Generic audit logging
-- ============================================================================

create or replace function public.write_audit_log()
returns trigger as $$
declare
  v_actor uuid;
begin
  begin
    v_actor := auth.uid();
  exception when others then
    v_actor := null;
  end;

  if (tg_op = 'DELETE') then
    insert into public.audit_logs (table_name, record_id, action, changed_data, performed_by)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), v_actor);
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into public.audit_logs (table_name, record_id, action, changed_data, performed_by)
    values (tg_table_name, new.id, 'update', jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)), v_actor);
    return new;
  else
    insert into public.audit_logs (table_name, record_id, action, changed_data, performed_by)
    values (tg_table_name, new.id, 'insert', to_jsonb(new), v_actor);
    return new;
  end if;
end;
$$ language plpgsql security definer;

do $$
declare
  t text;
begin
  for t in
    select unnest(array['companies', 'stores', 'employees'])
  loop
    execute format(
      'create trigger trg_%I_audit
       after insert or update or delete on public.%I
       for each row execute function public.write_audit_log();', t, t
    );
  end loop;
end $$;
