-- Issue 11: admin-defined open-list groups for Dashboard Incoming tests.
-- Presentation only — does not change can_view_test / can_access_test,
-- attempt history, answer keys, or entitlements. See docs/database.md.

create table public.test_open_list_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  year_id uuid not null references public.years (id),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_open_list_groups_name_nonempty check (char_length(trim(name)) > 0)
);

create unique index test_open_list_groups_year_name_uidx
  on public.test_open_list_groups (year_id, lower(trim(name)));

create index test_open_list_groups_year_sort_idx
  on public.test_open_list_groups (year_id, sort_order, name);

create trigger test_open_list_groups_set_updated_at
  before update on public.test_open_list_groups
  for each row execute function public.set_updated_at();

create table public.test_open_list_placements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  test_id uuid not null references public.tests (id) on delete cascade,
  year_id uuid not null references public.years (id),
  group_id uuid references public.test_open_list_groups (id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_open_list_placements_test_uidx unique (test_id)
);

create index test_open_list_placements_year_group_sort_idx
  on public.test_open_list_placements (year_id, group_id, sort_order);

create trigger test_open_list_placements_set_updated_at
  before update on public.test_open_list_placements
  for each row execute function public.set_updated_at();

-- Keep year_id coherent with the test (and with the group when set).
create or replace function public.enforce_test_open_list_placement_year()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_test_year uuid;
  v_group_year uuid;
begin
  select year_id into v_test_year from public.tests where id = new.test_id;
  if v_test_year is null then
    raise exception 'test_not_found';
  end if;
  new.year_id := v_test_year;

  if new.group_id is not null then
    select year_id into v_group_year
    from public.test_open_list_groups
    where id = new.group_id;
    if v_group_year is null then
      raise exception 'open_list_group_not_found';
    end if;
    if v_group_year is distinct from v_test_year then
      raise exception 'open_list_year_mismatch';
    end if;
  end if;

  return new;
end;
$$;

create trigger test_open_list_placements_enforce_year
  before insert or update of test_id, group_id, year_id
  on public.test_open_list_placements
  for each row execute function public.enforce_test_open_list_placement_year();

alter table public.test_open_list_groups enable row level security;
alter table public.test_open_list_placements enable row level security;

-- Deny-by-default: no policies for INSERT/UPDATE/DELETE (RPC-only writes).

create policy test_open_list_groups_student_select on public.test_open_list_groups
  for select to authenticated
  using (
    public.account_allows_lms()
    and public.has_active_enrollment(year_id)
  );

create policy test_open_list_groups_admin_select on public.test_open_list_groups
  for select to authenticated
  using (
    public.is_admin()
    and (
      public.has_permission('publish_tests')
      or public.has_permission('edit_questions')
    )
    and public.admin_can_access_year(year_id)
  );

create policy test_open_list_placements_student_select on public.test_open_list_placements
  for select to authenticated
  using (public.can_view_test(test_id));

create policy test_open_list_placements_admin_select on public.test_open_list_placements
  for select to authenticated
  using (
    public.is_admin()
    and (
      public.has_permission('publish_tests')
      or public.has_permission('edit_questions')
    )
    and public.admin_can_access_year(year_id)
  );

------------------------------------------------------------------
-- Admin RPCs
------------------------------------------------------------------

create or replace function public.admin_create_test_open_list_group(
  p_year_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
  v_sort int;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('publish_tests') then
    raise exception 'permission_denied';
  end if;
  if p_year_id is null or not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) = 0 then
    raise exception 'open_list_group_name_required';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.test_open_list_groups
  where year_id = p_year_id;

  insert into public.test_open_list_groups (year_id, name, sort_order)
  values (p_year_id, v_name, v_sort)
  returning id into v_id;

  perform public.log_audit(
    'test_open_list_group_created',
    'test_open_list_group',
    v_id,
    jsonb_build_object('year_id', p_year_id, 'name', v_name, 'sort_order', v_sort)
  );

  return v_id;
end;
$$;

create or replace function public.admin_rename_test_open_list_group(
  p_group_id uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.test_open_list_groups%rowtype;
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('publish_tests') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.test_open_list_groups where id = p_group_id;
  if not found then
    raise exception 'open_list_group_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  v_name := trim(coalesce(p_name, ''));
  if char_length(v_name) = 0 then
    raise exception 'open_list_group_name_required';
  end if;

  update public.test_open_list_groups
  set name = v_name
  where id = p_group_id;

  perform public.log_audit(
    'test_open_list_group_renamed',
    'test_open_list_group',
    p_group_id,
    jsonb_build_object('old_name', v_row.name, 'name', v_name)
  );
end;
$$;

create or replace function public.admin_delete_test_open_list_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.test_open_list_groups%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('publish_tests') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.test_open_list_groups where id = p_group_id;
  if not found then
    raise exception 'open_list_group_not_found';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  -- ON DELETE SET NULL moves placements into the ungrouped bucket.
  delete from public.test_open_list_groups where id = p_group_id;

  perform public.log_audit(
    'test_open_list_group_deleted',
    'test_open_list_group',
    p_group_id,
    jsonb_build_object('year_id', v_row.year_id, 'name', v_row.name)
  );
end;
$$;

create or replace function public.admin_reorder_test_open_list_groups(
  p_year_id uuid,
  p_ordered_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_i int;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('publish_tests') then
    raise exception 'permission_denied';
  end if;
  if p_year_id is null or not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  if p_ordered_ids is null or cardinality(p_ordered_ids) = 0 then
    return;
  end if;

  v_i := 0;
  foreach v_id in array p_ordered_ids
  loop
    update public.test_open_list_groups
    set sort_order = v_i
    where id = v_id
      and year_id = p_year_id;
    v_i := v_i + 1;
  end loop;

  perform public.log_audit(
    'test_open_list_groups_reordered',
    'year',
    p_year_id,
    jsonb_build_object('ordered_ids', to_jsonb(p_ordered_ids))
  );
end;
$$;

create or replace function public.admin_assign_test_open_list_placement(
  p_test_id uuid,
  p_group_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test public.tests%rowtype;
  v_group_year uuid;
  v_sort int;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('publish_tests') then
    raise exception 'permission_denied';
  end if;

  select * into v_test from public.tests where id = p_test_id;
  if not found then
    raise exception 'test_not_found';
  end if;
  if not public.admin_can_access_year(v_test.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if p_group_id is not null then
    select year_id into v_group_year
    from public.test_open_list_groups
    where id = p_group_id;
    if v_group_year is null then
      raise exception 'open_list_group_not_found';
    end if;
    if v_group_year is distinct from v_test.year_id then
      raise exception 'open_list_year_mismatch';
    end if;
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_sort
  from public.test_open_list_placements
  where year_id = v_test.year_id
    and group_id is not distinct from p_group_id;

  insert into public.test_open_list_placements (test_id, year_id, group_id, sort_order)
  values (p_test_id, v_test.year_id, p_group_id, v_sort)
  on conflict (test_id) do update
  set
    group_id = excluded.group_id,
    year_id = excluded.year_id,
    sort_order = excluded.sort_order;

  perform public.log_audit(
    'test_open_list_placement_assigned',
    'test',
    p_test_id,
    jsonb_build_object(
      'group_id', p_group_id,
      'year_id', v_test.year_id,
      'sort_order', v_sort
    )
  );
end;
$$;

create or replace function public.admin_reorder_test_open_list_placements(
  p_year_id uuid,
  p_group_id uuid,
  p_ordered_test_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test_id uuid;
  v_i int;
  v_test_year uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('publish_tests') then
    raise exception 'permission_denied';
  end if;
  if p_year_id is null or not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  if p_group_id is not null then
    if not exists (
      select 1 from public.test_open_list_groups
      where id = p_group_id and year_id = p_year_id
    ) then
      raise exception 'open_list_group_not_found';
    end if;
  end if;

  if p_ordered_test_ids is null or cardinality(p_ordered_test_ids) = 0 then
    return;
  end if;

  v_i := 0;
  foreach v_test_id in array p_ordered_test_ids
  loop
    select year_id into v_test_year from public.tests where id = v_test_id;
    if v_test_year is null then
      raise exception 'test_not_found';
    end if;
    if v_test_year is distinct from p_year_id then
      raise exception 'open_list_year_mismatch';
    end if;

    insert into public.test_open_list_placements (test_id, year_id, group_id, sort_order)
    values (v_test_id, p_year_id, p_group_id, v_i)
    on conflict (test_id) do update
    set
      group_id = excluded.group_id,
      year_id = excluded.year_id,
      sort_order = excluded.sort_order;

    v_i := v_i + 1;
  end loop;

  perform public.log_audit(
    'test_open_list_placements_reordered',
    'year',
    p_year_id,
    jsonb_build_object(
      'group_id', p_group_id,
      'ordered_test_ids', to_jsonb(p_ordered_test_ids)
    )
  );
end;
$$;

revoke all on function public.admin_create_test_open_list_group(uuid, text) from public, anon;
revoke all on function public.admin_rename_test_open_list_group(uuid, text) from public, anon;
revoke all on function public.admin_delete_test_open_list_group(uuid) from public, anon;
revoke all on function public.admin_reorder_test_open_list_groups(uuid, uuid[]) from public, anon;
revoke all on function public.admin_assign_test_open_list_placement(uuid, uuid) from public, anon;
revoke all on function public.admin_reorder_test_open_list_placements(uuid, uuid, uuid[]) from public, anon;

grant execute on function public.admin_create_test_open_list_group(uuid, text) to authenticated, service_role;
grant execute on function public.admin_rename_test_open_list_group(uuid, text) to authenticated, service_role;
grant execute on function public.admin_delete_test_open_list_group(uuid) to authenticated, service_role;
grant execute on function public.admin_reorder_test_open_list_groups(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.admin_assign_test_open_list_placement(uuid, uuid) to authenticated, service_role;
grant execute on function public.admin_reorder_test_open_list_placements(uuid, uuid, uuid[]) to authenticated, service_role;
