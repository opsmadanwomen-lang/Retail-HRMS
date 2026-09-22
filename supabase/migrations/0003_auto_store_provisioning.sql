-- ============================================================================
-- Retail HRMS — Phase 1 Part 1
-- Migration 0003: Automatic Store Structure Provisioning
--
-- When a Store is created, this trigger copies the entire Master
-- Organization Template (Teams -> Departments -> Designations) into
-- store-scoped tables. No manual setup is ever required.
-- ============================================================================

create or replace function public.provision_store_organization()
returns trigger as $$
declare
  mt record;
  md record;
  mdz record;
  v_store_team_id uuid;
  v_store_department_id uuid;
begin
  for mt in
    select * from public.master_teams
    where is_active = true
    order by display_order
  loop
    insert into public.store_teams (store_id, master_team_id, name, category, display_order)
    values (new.id, mt.id, mt.name, mt.category, mt.display_order)
    returning id into v_store_team_id;

    for md in
      select * from public.master_departments
      where master_team_id = mt.id and is_active = true
      order by display_order
    loop
      insert into public.store_departments (store_id, store_team_id, master_department_id, name, display_order)
      values (new.id, v_store_team_id, md.id, md.name, md.display_order)
      returning id into v_store_department_id;

      for mdz in
        select * from public.master_designations
        where master_department_id = md.id and is_active = true
        order by display_order
      loop
        insert into public.store_designations
          (store_id, store_department_id, master_designation_id, title, display_order)
        values
          (new.id, v_store_department_id, mdz.id, mdz.title, mdz.display_order);
      end loop;
    end loop;
  end loop;

  update public.stores
  set status = case when new.status = 'onboarding' then 'active' else new.status end,
      provisioned_at = now()
  where id = new.id;

  return new;
end;
$$ language plpgsql security definer;

create trigger trg_stores_auto_provision
after insert on public.stores
for each row execute function public.provision_store_organization();

-- ---------------------------------------------------------------------------
-- Convenience RPC: fetch a full organization tree for a store in one call
-- (store -> teams -> departments -> designations -> employee counts)
-- ---------------------------------------------------------------------------
create or replace function public.get_store_organization_tree(p_store_id uuid)
returns jsonb as $$
  select coalesce(jsonb_agg(team_node order by st.display_order), '[]'::jsonb)
  from public.store_teams st
  cross join lateral (
    select jsonb_build_object(
      'id', st.id,
      'name', st.name,
      'category', st.category,
      'departments', coalesce((
        select jsonb_agg(dept_node order by sd.display_order)
        from public.store_departments sd
        cross join lateral (
          select jsonb_build_object(
            'id', sd.id,
            'name', sd.name,
            'designations', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sdz.id,
                'title', sdz.title,
                'employee_count', (
                  select count(*) from public.employees e
                  where e.store_designation_id = sdz.id and e.is_active = true
                )
              ) order by sdz.display_order)
              from public.store_designations sdz
              where sdz.store_department_id = sd.id and sdz.is_active = true
            ), '[]'::jsonb)
          ) as dept_node
        ) x
        where sd.store_team_id = st.id and sd.is_active = true
      ), '[]'::jsonb)
    ) as team_node
  ) y
  where st.store_id = p_store_id and st.is_active = true;
$$ language sql stable;
