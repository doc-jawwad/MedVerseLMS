-- Data Spine: subjects.product_key (Blocks / Final Year clinical),
-- prof_session_days chrome, global soft-delete + content bin, R2 purge queue,
-- get_academic_tree / search_academic_tree rewrite.
-- No exam state changes. No flashcards engine. No rank_test changes.
-- seed.sql still seeds departmental subjects; Block product rows come from here.

-- ###########################################################################
-- PART A — Block product_key mapping
-- ###########################################################################

alter table public.subjects
  add column if not exists product_key text;

alter table public.subjects
  drop constraint if exists subjects_product_key_check;

alter table public.subjects
  add constraint subjects_product_key_check
  check (
    product_key is null
    or product_key in (
      'block-1', 'block-2', 'block-3', 'block-4', 'block-5', 'block-6',
      'block-7', 'block-8', 'block-9', 'block-10', 'block-11', 'block-12',
      'medicine', 'surgery', 'gynecology', 'pediatrics'
    )
  );

comment on column public.subjects.product_key is
  'Student chrome Block / Final Year clinical key. NULL = departmental QB taxonomy only.';

create unique index if not exists subjects_year_product_key_uidx
  on public.subjects (year_id, product_key)
  where product_key is not null;

-- Display rename for year 5 (canonical Final Year MBBS).
update public.years
set name = 'Final Year MBBS',
    updated_at = now()
where year_number = 5
  and name is distinct from 'Final Year MBBS';

-- Year 5: map existing clinical subjects without destroying UUIDs.
update public.subjects s
set product_key = 'medicine',
    updated_at = now()
from public.years y
where s.year_id = y.id
  and y.year_number = 5
  and lower(btrim(s.name)) = 'medicine'
  and s.product_key is distinct from 'medicine';

update public.subjects s
set product_key = 'surgery',
    updated_at = now()
from public.years y
where s.year_id = y.id
  and y.year_number = 5
  and lower(btrim(s.name)) = 'surgery'
  and s.product_key is distinct from 'surgery';

update public.subjects s
set
  name = 'Gynecology',
  product_key = 'gynecology',
  updated_at = now()
from public.years y
where s.year_id = y.id
  and y.year_number = 5
  and lower(btrim(s.name)) in ('gynae & obs', 'gynae and obs', 'gynecology', 'gynaecology')
  and (
    s.product_key is distinct from 'gynecology'
    or s.name is distinct from 'Gynecology'
  )
  and not exists (
    select 1 from public.subjects other
    where other.year_id = s.year_id
      and other.id is distinct from s.id
      and other.name = 'Gynecology'
  );

update public.subjects s
set product_key = 'gynecology',
    updated_at = now()
from public.years y
where s.year_id = y.id
  and y.year_number = 5
  and s.name = 'Gynecology'
  and s.product_key is distinct from 'gynecology';

update public.subjects s
set
  name = 'Pediatrics',
  product_key = 'pediatrics',
  updated_at = now()
from public.years y
where s.year_id = y.id
  and y.year_number = 5
  and lower(btrim(s.name)) in ('paediatrics', 'pediatrics')
  and (
    s.product_key is distinct from 'pediatrics'
    or s.name is distinct from 'Pediatrics'
  )
  and not exists (
    select 1 from public.subjects other
    where other.year_id = s.year_id
      and other.id is distinct from s.id
      and other.name = 'Pediatrics'
  );

update public.subjects s
set product_key = 'pediatrics',
    updated_at = now()
from public.years y
where s.year_id = y.id
  and y.year_number = 5
  and s.name = 'Pediatrics'
  and s.product_key is distinct from 'pediatrics';

-- Years 1–4: insert Block product subjects (idempotent by product_key).
-- entitlement stays default 'free' (protect_resource_entitlement); chrome
-- navigation is open — item open remains RPC-gated.
insert into public.subjects (year_id, name, sort_order, product_key)
select y.id, v.name, v.sort_order, v.product_key
from public.years y
join (
  values
    (1, 'Block 1', 1, 'block-1'),
    (1, 'Block 2', 2, 'block-2'),
    (1, 'Block 3', 3, 'block-3'),
    (2, 'Block 4', 1, 'block-4'),
    (2, 'Block 5', 2, 'block-5'),
    (2, 'Block 6', 3, 'block-6'),
    (3, 'Block 7', 1, 'block-7'),
    (3, 'Block 8', 2, 'block-8'),
    (3, 'Block 9', 3, 'block-9'),
    (4, 'Block 10', 1, 'block-10'),
    (4, 'Block 11', 2, 'block-11'),
    (4, 'Block 12', 3, 'block-12')
) as v(year_number, name, sort_order, product_key)
  on v.year_number = y.year_number
where not exists (
  select 1
  from public.subjects s
  where s.year_id = y.id
    and s.product_key = v.product_key
);

-- ###########################################################################
-- PART B — Prof Session Days (chrome only; content engines link later)
-- ###########################################################################

create table if not exists public.prof_session_days (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  year_id uuid not null references public.years (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  deleted_at timestamptz null,
  purge_after timestamptz null,
  deleted_by uuid null references public.profiles (id),
  created_by uuid null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prof_session_days is
  'Prof. Session Day chrome under a year. Fixed slot keys; no fake student days.';
comment on column public.prof_session_days.status is
  'draft | published. Students only see published non-deleted days via tree when subscribed.';

create unique index if not exists prof_session_days_year_name_uidx
  on public.prof_session_days (year_id, lower(name))
  where deleted_at is null;

create index if not exists prof_session_days_year_idx
  on public.prof_session_days (year_id);

create index if not exists prof_session_days_deleted_at_idx
  on public.prof_session_days (deleted_at)
  where deleted_at is not null;

drop trigger if exists prof_session_days_updated_at on public.prof_session_days;
create trigger prof_session_days_updated_at
  before update on public.prof_session_days
  for each row execute function public.set_updated_at();

create table if not exists public.prof_session_day_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  day_id uuid not null references public.prof_session_days (id) on delete cascade,
  slot_key text not null
    check (slot_key in (
      'syllabus', 'guidelines', 'one_liners', 'practice_mcqs', 'test_mcq'
    )),
  created_at timestamptz not null default now(),
  unique (day_id, slot_key)
);

comment on table public.prof_session_day_slots is
  'Fixed Prof. Session slot chrome per day. Content engines attach later.';

create index if not exists prof_session_day_slots_day_idx
  on public.prof_session_day_slots (day_id);

alter table public.prof_session_days enable row level security;
alter table public.prof_session_day_slots enable row level security;

drop policy if exists prof_session_days_admin_select on public.prof_session_days;
create policy prof_session_days_admin_select on public.prof_session_days
  for select using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists prof_session_days_admin_insert on public.prof_session_days;
create policy prof_session_days_admin_insert on public.prof_session_days
  for insert with check (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists prof_session_days_admin_update on public.prof_session_days;
create policy prof_session_days_admin_update on public.prof_session_days
  for update using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  )
  with check (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists prof_session_days_admin_delete on public.prof_session_days;
create policy prof_session_days_admin_delete on public.prof_session_days
  for delete using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists prof_session_days_student_select on public.prof_session_days;
create policy prof_session_days_student_select on public.prof_session_days
  for select using (
    status = 'published'
    and deleted_at is null
    and public.has_active_enrollment(year_id)
  );

drop policy if exists prof_session_day_slots_admin_select on public.prof_session_day_slots;
create policy prof_session_day_slots_admin_select on public.prof_session_day_slots
  for select using (
    public.has_permission('manage_materials')
    and exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and public.admin_can_access_year(d.year_id)
    )
  );

drop policy if exists prof_session_day_slots_admin_insert on public.prof_session_day_slots;
create policy prof_session_day_slots_admin_insert on public.prof_session_day_slots
  for insert with check (
    public.has_permission('manage_materials')
    and exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and public.admin_can_access_year(d.year_id)
    )
  );

drop policy if exists prof_session_day_slots_admin_update on public.prof_session_day_slots;
create policy prof_session_day_slots_admin_update on public.prof_session_day_slots
  for update using (
    public.has_permission('manage_materials')
    and exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and public.admin_can_access_year(d.year_id)
    )
  )
  with check (
    public.has_permission('manage_materials')
    and exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and public.admin_can_access_year(d.year_id)
    )
  );

drop policy if exists prof_session_day_slots_admin_delete on public.prof_session_day_slots;
create policy prof_session_day_slots_admin_delete on public.prof_session_day_slots
  for delete using (
    public.has_permission('manage_materials')
    and exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and public.admin_can_access_year(d.year_id)
    )
  );

drop policy if exists prof_session_day_slots_student_select on public.prof_session_day_slots;
create policy prof_session_day_slots_student_select on public.prof_session_day_slots
  for select using (
    exists (
      select 1 from public.prof_session_days d
      where d.id = day_id
        and d.status = 'published'
        and d.deleted_at is null
        and public.has_active_enrollment(d.year_id)
    )
  );

-- ---- Prof Session Day admin RPCs ----

create or replace function public.admin_create_prof_session_day(
  p_year_id uuid,
  p_name text,
  p_sort_order int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_sort int;
  v_day_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;
  if not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'invalid_name';
  end if;

  if p_sort_order is null then
    select coalesce(max(sort_order), 0) + 1 into v_sort
    from public.prof_session_days
    where year_id = p_year_id and deleted_at is null;
  else
    v_sort := p_sort_order;
  end if;

  insert into public.prof_session_days (
    year_id, name, sort_order, status, created_by
  ) values (
    p_year_id, v_name, v_sort, 'draft', v_uid
  )
  returning id into v_day_id;

  insert into public.prof_session_day_slots (day_id, slot_key)
  values
    (v_day_id, 'syllabus'),
    (v_day_id, 'guidelines'),
    (v_day_id, 'one_liners'),
    (v_day_id, 'practice_mcqs'),
    (v_day_id, 'test_mcq');

  perform public.log_audit(
    'prof_session_day_created',
    'prof_session_day',
    v_day_id,
    jsonb_build_object('year_id', p_year_id, 'name', v_name, 'sort_order', v_sort)
  );

  return v_day_id;
end;
$$;

revoke execute on function public.admin_create_prof_session_day(uuid, text, int) from public, anon;
grant execute on function public.admin_create_prof_session_day(uuid, text, int) to authenticated, service_role;

create or replace function public.admin_update_prof_session_day(
  p_day_id uuid,
  p_name text default null,
  p_sort_order int default null,
  p_status text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prof_session_days%rowtype;
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.prof_session_days where id = p_day_id;
  if not found then
    raise exception 'day_not_found';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'day_deleted';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  if p_status is not null and p_status not in ('draft', 'published') then
    raise exception 'invalid_status';
  end if;

  v_name := case
    when p_name is null then null
    else nullif(btrim(p_name), '')
  end;
  if p_name is not null and v_name is null then
    raise exception 'invalid_name';
  end if;

  update public.prof_session_days
  set
    name = coalesce(v_name, name),
    sort_order = coalesce(p_sort_order, sort_order),
    status = coalesce(p_status, status),
    updated_at = now()
  where id = p_day_id;

  perform public.log_audit(
    'prof_session_day_updated',
    'prof_session_day',
    p_day_id,
    jsonb_build_object(
      'name', coalesce(v_name, v_row.name),
      'sort_order', coalesce(p_sort_order, v_row.sort_order),
      'status', coalesce(p_status, v_row.status)
    )
  );
end;
$$;

revoke execute on function public.admin_update_prof_session_day(uuid, text, int, text) from public, anon;
grant execute on function public.admin_update_prof_session_day(uuid, text, int, text) to authenticated, service_role;

create or replace function public.admin_reorder_prof_session_days(
  p_year_id uuid,
  p_day_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := coalesce(p_day_ids, '{}');
  v_id uuid;
  v_ord int := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;
  if not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  foreach v_id in array v_ids loop
    v_ord := v_ord + 1;
    update public.prof_session_days
    set sort_order = v_ord, updated_at = now()
    where id = v_id
      and year_id = p_year_id
      and deleted_at is null;
  end loop;

  perform public.log_audit(
    'prof_session_days_reordered',
    'year',
    p_year_id,
    jsonb_build_object('day_ids', to_jsonb(v_ids))
  );
end;
$$;

revoke execute on function public.admin_reorder_prof_session_days(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_prof_session_days(uuid, uuid[]) to authenticated, service_role;

create or replace function public.admin_soft_delete_prof_session_day(p_day_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prof_session_days%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.prof_session_days where id = p_day_id;
  if not found then
    raise exception 'day_not_found';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'already_deleted';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.prof_session_days
  set
    deleted_at = now(),
    purge_after = now() + interval '7 days',
    deleted_by = (select auth.uid()),
    updated_at = now()
  where id = p_day_id;

  perform public.log_audit(
    'prof_session_day_soft_deleted',
    'prof_session_day',
    p_day_id,
    jsonb_build_object('year_id', v_row.year_id, 'name', v_row.name)
  );
end;
$$;

revoke execute on function public.admin_soft_delete_prof_session_day(uuid) from public, anon;
grant execute on function public.admin_soft_delete_prof_session_day(uuid) to authenticated, service_role;

create or replace function public.admin_restore_prof_session_day(p_day_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.prof_session_days%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.prof_session_days where id = p_day_id;
  if not found then
    raise exception 'day_not_found';
  end if;
  if v_row.deleted_at is null then
    raise exception 'not_deleted';
  end if;
  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'year_scope_denied';
  end if;

  update public.prof_session_days
  set
    deleted_at = null,
    purge_after = null,
    deleted_by = null,
    updated_at = now()
  where id = p_day_id;

  perform public.log_audit(
    'prof_session_day_restored',
    'prof_session_day',
    p_day_id,
    jsonb_build_object('year_id', v_row.year_id, 'name', v_row.name)
  );
end;
$$;

revoke execute on function public.admin_restore_prof_session_day(uuid) from public, anon;
grant execute on function public.admin_restore_prof_session_day(uuid) to authenticated, service_role;

-- ###########################################################################
-- PART C — Global soft-delete columns + view helpers
-- ###########################################################################

alter table public.material_folders
  add column if not exists deleted_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id);

alter table public.materials
  add column if not exists deleted_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id);

alter table public.pearl_points
  add column if not exists deleted_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id);

alter table public.ospe_stations
  add column if not exists deleted_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id);

alter table public.questions
  add column if not exists deleted_at timestamptz,
  add column if not exists purge_after timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id);

comment on column public.material_folders.deleted_at is
  'Soft-delete timestamp. Student catalog excludes soft-deleted rows.';
comment on column public.materials.deleted_at is
  'Soft-delete timestamp. R2 objects purged after purge_after via queue.';
comment on column public.pearl_points.deleted_at is
  'Soft-delete timestamp. Student catalog excludes soft-deleted rows.';
comment on column public.ospe_stations.deleted_at is
  'Soft-delete timestamp. Student catalog excludes soft-deleted rows.';
comment on column public.questions.deleted_at is
  'Soft-delete timestamp. Permanent purge blocked while any test_questions reference exists.';

create index if not exists material_folders_deleted_at_idx
  on public.material_folders (deleted_at) where deleted_at is not null;
create index if not exists materials_deleted_at_idx
  on public.materials (deleted_at) where deleted_at is not null;
create index if not exists pearl_points_deleted_at_idx
  on public.pearl_points (deleted_at) where deleted_at is not null;
create index if not exists ospe_stations_deleted_at_idx
  on public.ospe_stations (deleted_at) where deleted_at is not null;
create index if not exists questions_deleted_at_idx
  on public.questions (deleted_at) where deleted_at is not null;

-- View helpers: exclude soft-deleted rows (and soft-deleted parent folders).
create or replace function public.can_view_material_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.material_folders f
      where f.id = p_folder_id
        and f.deleted_at is null
        and (
          public.has_active_enrollment(f.year_id)
          or public.has_resource_grant('materials_folder', null, null, f.id)
        )
    );
$$;

create or replace function public.can_access_material_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_material_folder(p_folder_id)
    and exists (
      select 1 from public.material_folders f
      where f.id = p_folder_id
        and f.deleted_at is null
        and public.resource_content_allowed(
          'materials_folder', null, null, f.id, f.entitlement, f.required_plan_id
        )
    );
$$;

create or replace function public.can_view_pearl(p_pearl_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.pearl_points p
      where p.id = p_pearl_id
        and p.status = 'published'
        and p.deleted_at is null
        and public.has_active_enrollment(p.year_id)
    );
$$;

create or replace function public.can_access_pearl(p_pearl_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_pearl(p_pearl_id)
    and exists (
      select 1 from public.pearl_points p
      where p.id = p_pearl_id
        and p.deleted_at is null
        and public.resource_content_allowed(
          'pearl_point', null, null, null, p.entitlement, p.required_plan_id
        )
    );
$$;

create or replace function public.can_view_ospe_station(p_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.ospe_stations s
      where s.id = p_station_id
        and s.status = 'published'
        and s.deleted_at is null
        and public.has_active_enrollment(s.year_id)
    );
$$;

create or replace function public.can_access_ospe_station(p_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_ospe_station(p_station_id)
    and exists (
      select 1 from public.ospe_stations s
      where s.id = p_station_id
        and s.deleted_at is null
        and public.resource_content_allowed(
          'ospe_station', null, null, null, s.entitlement, s.required_plan_id
        )
    );
$$;

-- Student materials: published + not soft-deleted + folder visible (folder not deleted).
drop policy if exists materials_student_select on public.materials;
create policy materials_student_select on public.materials
  for select using (
    status = 'published'
    and deleted_at is null
    and public.can_view_material_folder(folder_id)
  );

-- Re-grant catalog columns including soft-delete metadata for admin lists.
revoke select on public.materials from public;
revoke select on public.materials from anon;
revoke select on public.materials from authenticated;
grant select (
  id,
  tenant_id,
  folder_id,
  title,
  description,
  file_type,
  kind,
  status,
  chapter_id,
  topic_id,
  reference_text,
  sort_order,
  deleted_at,
  purge_after,
  deleted_by,
  created_at,
  updated_at
) on public.materials to authenticated;

revoke select on public.pearl_points from public;
revoke select on public.pearl_points from anon;
revoke select on public.pearl_points from authenticated;
grant select (
  id,
  tenant_id,
  prompt,
  year_id,
  subject_id,
  chapter_id,
  topic_id,
  status,
  entitlement,
  required_plan_id,
  sort_order,
  deleted_at,
  purge_after,
  deleted_by,
  created_at,
  updated_at
) on public.pearl_points to authenticated;

revoke select on public.ospe_stations from public;
revoke select on public.ospe_stations from anon;
revoke select on public.ospe_stations from authenticated;
grant select (
  id,
  tenant_id,
  title,
  year_id,
  subject_id,
  status,
  entitlement,
  required_plan_id,
  sort_order,
  deleted_at,
  purge_after,
  deleted_by,
  created_at,
  updated_at
) on public.ospe_stations to authenticated;

-- SECURITY DEFINER open paths: reject soft-deleted materials for students.
create or replace function public.open_material(p_material_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder_id uuid;
  v_url text;
  v_kind text;
  v_status text;
  v_deleted timestamptz;
  v_folder_deleted timestamptz;
begin
  select m.folder_id, m.drive_url, m.kind, m.status, m.deleted_at, f.deleted_at
    into v_folder_id, v_url, v_kind, v_status, v_deleted, v_folder_deleted
  from public.materials m
  join public.material_folders f on f.id = m.folder_id
  where m.id = p_material_id;

  if v_kind is distinct from 'drive' or v_url is null then
    raise exception 'material_access_denied';
  end if;

  if public.has_permission('manage_materials') then
    return v_url;
  end if;

  if v_deleted is not null or v_folder_deleted is not null then
    raise exception 'material_access_denied';
  end if;

  if v_status is distinct from 'published' then
    raise exception 'material_access_denied';
  end if;

  if not public.can_access_material_folder(v_folder_id) then
    raise exception 'material_access_denied';
  end if;

  return v_url;
end;
$$;

revoke execute on function public.open_material(uuid) from public, anon;
grant execute on function public.open_material(uuid) to authenticated, service_role;

create or replace function public.open_study_item(p_material_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.materials%rowtype;
  v_folder_deleted timestamptz;
  v_admin boolean;
begin
  select * into v_row from public.materials where id = p_material_id;
  if not found then
    raise exception 'material_access_denied';
  end if;

  select deleted_at into v_folder_deleted
  from public.material_folders
  where id = v_row.folder_id;

  v_admin := public.has_permission('manage_materials');
  if not v_admin then
    if v_row.deleted_at is not null or v_folder_deleted is not null then
      raise exception 'material_access_denied';
    end if;
    if v_row.status is distinct from 'published' then
      raise exception 'material_access_denied';
    end if;
    if not public.can_access_material_folder(v_row.folder_id) then
      raise exception 'material_access_denied';
    end if;
  end if;

  if v_row.kind = 'drive' then
    raise exception 'material_wrong_kind';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'title', v_row.title,
    'description', v_row.description,
    'reference_text', v_row.reference_text,
    'status', v_row.status,
    'body_text', case when v_row.kind = 'guideline' then v_row.body_text else null end,
    'has_pdf', v_row.kind = 'pdf' and v_row.r2_object_key is not null
  );
end;
$$;

revoke execute on function public.open_study_item(uuid) from public, anon;
grant execute on function public.open_study_item(uuid) to authenticated, service_role;

create or replace function public.authorize_study_object(p_material_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_folder_id uuid;
  v_key text;
  v_kind text;
  v_status text;
  v_deleted timestamptz;
  v_folder_deleted timestamptz;
begin
  select m.folder_id, m.r2_object_key, m.kind, m.status, m.deleted_at, f.deleted_at
    into v_folder_id, v_key, v_kind, v_status, v_deleted, v_folder_deleted
  from public.materials m
  join public.material_folders f on f.id = m.folder_id
  where m.id = p_material_id;

  if v_kind is distinct from 'pdf' or v_key is null then
    raise exception 'study_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    return v_key;
  end if;

  if v_deleted is not null or v_folder_deleted is not null then
    raise exception 'study_object_denied';
  end if;

  if v_status is distinct from 'published' then
    raise exception 'study_object_denied';
  end if;

  if not public.can_access_material_folder(v_folder_id) then
    raise exception 'study_object_denied';
  end if;

  return v_key;
end;
$$;

revoke execute on function public.authorize_study_object(uuid) from public, anon;
grant execute on function public.authorize_study_object(uuid) to authenticated, service_role;

-- ###########################################################################
-- PART D — Polymorphic content bin RPCs
-- ###########################################################################

create or replace function public.soft_delete_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_name text;
  v_already timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type = 'question' then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
  else
    if not public.has_permission('manage_materials') then
      raise exception 'permission_denied';
    end if;
  end if;

  case p_entity_type
    when 'material_folder' then
      select year_id, name, deleted_at into v_year_id, v_name, v_already
      from public.material_folders where id = p_entity_id;
    when 'material' then
      select f.year_id, m.title, m.deleted_at into v_year_id, v_name, v_already
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
    when 'pearl_point' then
      select year_id, left(prompt, 200), deleted_at into v_year_id, v_name, v_already
      from public.pearl_points where id = p_entity_id;
    when 'ospe_station' then
      select year_id, title, deleted_at into v_year_id, v_name, v_already
      from public.ospe_stations where id = p_entity_id;
    when 'question' then
      select year_id, coalesce(stem_normalized, id::text), deleted_at
        into v_year_id, v_name, v_already
      from public.questions where id = p_entity_id;
      -- Soft-delete allowed even when used_in_test (UI cache); purge blocked separately.
    when 'prof_session_day' then
      select year_id, name, deleted_at into v_year_id, v_name, v_already
      from public.prof_session_days where id = p_entity_id;
  end case;

  if v_year_id is null then
    raise exception 'entity_not_found';
  end if;
  if v_already is not null then
    raise exception 'already_deleted';
  end if;
  if not public.admin_can_access_year(v_year_id) then
    raise exception 'year_scope_denied';
  end if;

  case p_entity_type
    when 'material_folder' then
      update public.material_folders
      set deleted_at = now(), purge_after = now() + interval '7 days',
          deleted_by = (select auth.uid()), updated_at = now()
      where id = p_entity_id;
    when 'material' then
      update public.materials
      set deleted_at = now(), purge_after = now() + interval '7 days',
          deleted_by = (select auth.uid()), updated_at = now()
      where id = p_entity_id;
    when 'pearl_point' then
      update public.pearl_points
      set deleted_at = now(), purge_after = now() + interval '7 days',
          deleted_by = (select auth.uid()), updated_at = now()
      where id = p_entity_id;
    when 'ospe_station' then
      update public.ospe_stations
      set deleted_at = now(), purge_after = now() + interval '7 days',
          deleted_by = (select auth.uid()), updated_at = now()
      where id = p_entity_id;
    when 'question' then
      update public.questions
      set deleted_at = now(), purge_after = now() + interval '7 days',
          deleted_by = (select auth.uid()), updated_at = now()
      where id = p_entity_id;
    when 'prof_session_day' then
      update public.prof_session_days
      set deleted_at = now(), purge_after = now() + interval '7 days',
          deleted_by = (select auth.uid()), updated_at = now()
      where id = p_entity_id;
  end case;

  perform public.log_audit(
    'content_soft_deleted',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('year_id', v_year_id, 'name', v_name)
  );
end;
$$;

revoke execute on function public.soft_delete_content(text, uuid) from public, anon;
grant execute on function public.soft_delete_content(text, uuid) to authenticated, service_role;

create or replace function public.restore_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_name text;
  v_deleted timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type = 'question' then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
  else
    if not public.has_permission('manage_materials') then
      raise exception 'permission_denied';
    end if;
  end if;

  case p_entity_type
    when 'material_folder' then
      select year_id, name, deleted_at into v_year_id, v_name, v_deleted
      from public.material_folders where id = p_entity_id;
    when 'material' then
      select f.year_id, m.title, m.deleted_at into v_year_id, v_name, v_deleted
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
    when 'pearl_point' then
      select year_id, left(prompt, 200), deleted_at into v_year_id, v_name, v_deleted
      from public.pearl_points where id = p_entity_id;
    when 'ospe_station' then
      select year_id, title, deleted_at into v_year_id, v_name, v_deleted
      from public.ospe_stations where id = p_entity_id;
    when 'question' then
      select year_id, coalesce(stem_normalized, id::text), deleted_at
        into v_year_id, v_name, v_deleted
      from public.questions where id = p_entity_id;
    when 'prof_session_day' then
      select year_id, name, deleted_at into v_year_id, v_name, v_deleted
      from public.prof_session_days where id = p_entity_id;
  end case;

  if v_year_id is null then
    raise exception 'entity_not_found';
  end if;
  if v_deleted is null then
    raise exception 'not_deleted';
  end if;
  if not public.admin_can_access_year(v_year_id) then
    raise exception 'year_scope_denied';
  end if;

  case p_entity_type
    when 'material_folder' then
      update public.material_folders
      set deleted_at = null, purge_after = null, deleted_by = null, updated_at = now()
      where id = p_entity_id;
    when 'material' then
      update public.materials
      set deleted_at = null, purge_after = null, deleted_by = null, updated_at = now()
      where id = p_entity_id;
    when 'pearl_point' then
      update public.pearl_points
      set deleted_at = null, purge_after = null, deleted_by = null, updated_at = now()
      where id = p_entity_id;
    when 'ospe_station' then
      update public.ospe_stations
      set deleted_at = null, purge_after = null, deleted_by = null, updated_at = now()
      where id = p_entity_id;
    when 'question' then
      update public.questions
      set deleted_at = null, purge_after = null, deleted_by = null, updated_at = now()
      where id = p_entity_id;
    when 'prof_session_day' then
      update public.prof_session_days
      set deleted_at = null, purge_after = null, deleted_by = null, updated_at = now()
      where id = p_entity_id;
  end case;

  perform public.log_audit(
    'content_restored',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('year_id', v_year_id, 'name', v_name)
  );
end;
$$;

revoke execute on function public.restore_content(text, uuid) from public, anon;
grant execute on function public.restore_content(text, uuid) to authenticated, service_role;

create or replace function public.list_content_bin(p_year_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_items jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_admin() then
    raise exception 'admin_only';
  end if;
  if not (
    public.has_permission('manage_materials')
    or public.has_permission('edit_questions')
  ) then
    raise exception 'permission_denied';
  end if;

  if p_year_id is not null and not public.admin_can_access_year(p_year_id) then
    raise exception 'year_scope_denied';
  end if;

  -- material_folders
  if public.has_permission('manage_materials') then
    select coalesce(v_items || jsonb_agg(x order by (x->>'deleted_at') desc), v_items)
    into v_items
    from (
      select jsonb_build_object(
        'entity_type', 'material_folder',
        'entity_id', f.id,
        'name', f.name,
        'year_id', f.year_id,
        'deleted_at', f.deleted_at,
        'purge_after', f.purge_after,
        'deleted_by', f.deleted_by,
        'has_r2', false
      ) as x
      from public.material_folders f
      where f.deleted_at is not null
        and (p_year_id is null or f.year_id = p_year_id)
        and public.admin_can_access_year(f.year_id)
    ) t;

    select coalesce(v_items || jsonb_agg(x order by (x->>'deleted_at') desc), v_items)
    into v_items
    from (
      select jsonb_build_object(
        'entity_type', 'material',
        'entity_id', m.id,
        'name', m.title,
        'year_id', f.year_id,
        'deleted_at', m.deleted_at,
        'purge_after', m.purge_after,
        'deleted_by', m.deleted_by,
        'has_r2', (m.r2_object_key is not null or m.cover_object_key is not null)
      ) as x
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.deleted_at is not null
        and (p_year_id is null or f.year_id = p_year_id)
        and public.admin_can_access_year(f.year_id)
    ) t;

    select coalesce(v_items || jsonb_agg(x order by (x->>'deleted_at') desc), v_items)
    into v_items
    from (
      select jsonb_build_object(
        'entity_type', 'pearl_point',
        'entity_id', p.id,
        'name', left(p.prompt, 200),
        'year_id', p.year_id,
        'deleted_at', p.deleted_at,
        'purge_after', p.purge_after,
        'deleted_by', p.deleted_by,
        'has_r2', false
      ) as x
      from public.pearl_points p
      where p.deleted_at is not null
        and (p_year_id is null or p.year_id = p_year_id)
        and public.admin_can_access_year(p.year_id)
    ) t;

    select coalesce(v_items || jsonb_agg(x order by (x->>'deleted_at') desc), v_items)
    into v_items
    from (
      select jsonb_build_object(
        'entity_type', 'ospe_station',
        'entity_id', s.id,
        'name', s.title,
        'year_id', s.year_id,
        'deleted_at', s.deleted_at,
        'purge_after', s.purge_after,
        'deleted_by', s.deleted_by,
        'has_r2', (s.r2_object_key is not null)
      ) as x
      from public.ospe_stations s
      where s.deleted_at is not null
        and (p_year_id is null or s.year_id = p_year_id)
        and public.admin_can_access_year(s.year_id)
    ) t;

    select coalesce(v_items || jsonb_agg(x order by (x->>'deleted_at') desc), v_items)
    into v_items
    from (
      select jsonb_build_object(
        'entity_type', 'prof_session_day',
        'entity_id', d.id,
        'name', d.name,
        'year_id', d.year_id,
        'deleted_at', d.deleted_at,
        'purge_after', d.purge_after,
        'deleted_by', d.deleted_by,
        'has_r2', false
      ) as x
      from public.prof_session_days d
      where d.deleted_at is not null
        and (p_year_id is null or d.year_id = p_year_id)
        and public.admin_can_access_year(d.year_id)
    ) t;
  end if;

  if public.has_permission('edit_questions') then
    select coalesce(v_items || jsonb_agg(x order by (x->>'deleted_at') desc), v_items)
    into v_items
    from (
      select jsonb_build_object(
        'entity_type', 'question',
        'entity_id', q.id,
        'name', left(coalesce(q.stem_normalized, q.id::text), 200),
        'year_id', q.year_id,
        'deleted_at', q.deleted_at,
        'purge_after', q.purge_after,
        'deleted_by', q.deleted_by,
        'has_r2', false
      ) as x
      from public.questions q
      where q.deleted_at is not null
        and (p_year_id is null or q.year_id = p_year_id)
        and public.admin_can_access_year(q.year_id)
    ) t;
  end if;

  return coalesce(v_items, '[]'::jsonb);
end;
$$;

revoke execute on function public.list_content_bin(uuid) from public, anon;
grant execute on function public.list_content_bin(uuid) to authenticated, service_role;

comment on function public.list_content_bin(uuid) is
  'Admin content bin. Main admin all years; limited admin assigned years only. Students denied.';

-- ###########################################################################
-- PART E — R2 purge queue + automatic / explicit purge
-- ###########################################################################

create table if not exists public.r2_purge_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  object_key text not null
    check (object_key ~ '^study-content/' and object_key !~ '[[:space:]]'),
  entity_type text,
  entity_id uuid,
  enqueued_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  completed_at timestamptz null
);

comment on table public.r2_purge_queue is
  'Async R2 object deletion queue. Workers claim via claim_r2_purge_batch; no student access.';

create unique index if not exists r2_purge_queue_open_key_uidx
  on public.r2_purge_queue (object_key)
  where completed_at is null;

create index if not exists r2_purge_queue_pending_idx
  on public.r2_purge_queue (enqueued_at)
  where completed_at is null;

alter table public.r2_purge_queue enable row level security;
-- Deny-by-default for authenticated/anon: no policies. service_role bypasses RLS.

revoke all on public.r2_purge_queue from public, anon, authenticated;
grant all on public.r2_purge_queue to service_role;

create table if not exists public.purge_log (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  deleted_count int not null default 0,
  error_text text
);

comment on table public.purge_log is
  'Runs of purge_expired_bin_items. service_role / cron only.';

alter table public.purge_log enable row level security;
revoke all on public.purge_log from public, anon, authenticated;
grant all on public.purge_log to service_role;

create or replace function public.enqueue_r2_purge(
  p_object_key text,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_object_key is null
     or p_object_key !~ '^study-content/'
     or p_object_key ~ '[[:space:]]' then
    return;
  end if;

  insert into public.r2_purge_queue (object_key, entity_type, entity_id)
  values (p_object_key, p_entity_type, p_entity_id)
  on conflict (object_key) where completed_at is null
  do nothing;
exception
  when unique_violation then
    null;
end;
$$;

-- Internal helper: callable from SECURITY DEFINER purge paths (owner) + service_role.
revoke execute on function public.enqueue_r2_purge(text, text, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_r2_purge(text, text, uuid) to service_role;

create or replace function public.purge_content(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year_id uuid;
  v_name text;
  v_r2 text;
  v_cover text;
  v_key text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type = 'question' then
    if not public.has_permission('edit_questions') then
      raise exception 'permission_denied';
    end if;
  else
    if not public.has_permission('manage_materials') then
      raise exception 'permission_denied';
    end if;
  end if;

  case p_entity_type
    when 'material_folder' then
      select year_id, name into v_year_id, v_name
      from public.material_folders where id = p_entity_id;
      if v_year_id is null then
        raise exception 'entity_not_found';
      end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      -- Enqueue child material R2 keys before cascade hard-delete.
      for v_r2, v_cover in
        select m.r2_object_key, m.cover_object_key
        from public.materials m
        where m.folder_id = p_entity_id
      loop
        perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
        perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      end loop;
      delete from public.material_folders where id = p_entity_id;

    when 'material' then
      select f.year_id, m.title, m.r2_object_key, m.cover_object_key
        into v_year_id, v_name, v_r2, v_cover
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if v_year_id is null then
        raise exception 'entity_not_found';
      end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
      perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      delete from public.materials where id = p_entity_id;

    when 'pearl_point' then
      select year_id, left(prompt, 200) into v_year_id, v_name
      from public.pearl_points where id = p_entity_id;
      if v_year_id is null then
        raise exception 'entity_not_found';
      end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      delete from public.pearl_points where id = p_entity_id;

    when 'ospe_station' then
      select year_id, title, r2_object_key into v_year_id, v_name, v_r2
      from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then
        raise exception 'entity_not_found';
      end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      perform public.enqueue_r2_purge(v_r2, 'ospe_station', p_entity_id);
      delete from public.ospe_stations where id = p_entity_id;

    when 'question' then
      select year_id, coalesce(stem_normalized, id::text)
        into v_year_id, v_name
      from public.questions where id = p_entity_id;
      if v_year_id is null then
        raise exception 'entity_not_found';
      end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      if exists (
        select 1 from public.test_questions tq where tq.question_id = p_entity_id
      ) then
        raise exception 'question_referenced_by_test';
      end if;
      delete from public.questions where id = p_entity_id;

    when 'prof_session_day' then
      select year_id, name into v_year_id, v_name
      from public.prof_session_days where id = p_entity_id;
      if v_year_id is null then
        raise exception 'entity_not_found';
      end if;
      if not public.admin_can_access_year(v_year_id) then
        raise exception 'year_scope_denied';
      end if;
      delete from public.prof_session_days where id = p_entity_id;
  end case;

  perform public.log_audit(
    'content_purged',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('year_id', v_year_id, 'name', v_name)
  );
end;
$$;

revoke execute on function public.purge_content(text, uuid) from public, anon;
grant execute on function public.purge_content(text, uuid) to authenticated, service_role;

-- Cron / service_role hard-delete path (no auth.uid() — unlike purge_content).
create or replace function public.purge_expired_bin_items()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_err text;
  r record;
  v_r2 text;
  v_cover text;
begin
  for r in
    select f.id
    from public.material_folders f
    where f.deleted_at is not null
      and f.purge_after is not null
      and f.purge_after <= now()
  loop
    begin
      for v_r2, v_cover in
        select m.r2_object_key, m.cover_object_key
        from public.materials m where m.folder_id = r.id
      loop
        perform public.enqueue_r2_purge(v_r2, 'material_folder', r.id);
        perform public.enqueue_r2_purge(v_cover, 'material_folder', r.id);
      end loop;
      delete from public.material_folders where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired material_folder %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('material_folder %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select m.id, m.r2_object_key, m.cover_object_key
    from public.materials m
    where m.deleted_at is not null
      and m.purge_after is not null
      and m.purge_after <= now()
  loop
    begin
      perform public.enqueue_r2_purge(r.r2_object_key, 'material', r.id);
      perform public.enqueue_r2_purge(r.cover_object_key, 'material', r.id);
      delete from public.materials where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired material %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('material %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.pearl_points
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.pearl_points where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired pearl_point %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('pearl_point %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id, r2_object_key from public.ospe_stations
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      perform public.enqueue_r2_purge(r.r2_object_key, 'ospe_station', r.id);
      delete from public.ospe_stations where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired ospe_station %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('ospe_station %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.questions
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      if exists (
        select 1 from public.test_questions tq where tq.question_id = r.id
      ) then
        raise exception 'question_referenced_by_test';
      end if;
      delete from public.questions where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired question %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('question %s: %s', r.id, SQLERRM);
    end;
  end loop;

  for r in
    select id from public.prof_session_days
    where deleted_at is not null and purge_after is not null and purge_after <= now()
  loop
    begin
      delete from public.prof_session_days where id = r.id;
      v_count := v_count + 1;
    exception when others then
      raise notice 'purge_expired prof_session_day %: %', r.id, SQLERRM;
      v_err := coalesce(v_err || '; ', '') || format('prof_session_day %s: %s', r.id, SQLERRM);
    end;
  end loop;

  insert into public.purge_log (deleted_count, error_text)
  values (v_count, v_err);
end;
$$;

revoke execute on function public.purge_expired_bin_items() from public, anon, authenticated;
grant execute on function public.purge_expired_bin_items() to service_role;

create or replace function public.claim_r2_purge_batch(p_limit int default 50)
returns setof public.r2_purge_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  return query
  with picked as (
    select q.id
    from public.r2_purge_queue q
    where q.completed_at is null
    order by q.enqueued_at asc
    limit v_limit
    for update skip locked
  )
  update public.r2_purge_queue q
  set attempts = q.attempts + 1
  from picked
  where q.id = picked.id
  returning q.*;
end;
$$;

revoke execute on function public.claim_r2_purge_batch(int) from public, anon, authenticated;
grant execute on function public.claim_r2_purge_batch(int) to service_role;

create or replace function public.complete_r2_purge(
  p_id uuid,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_error is null or btrim(p_error) = '' then
    update public.r2_purge_queue
    set completed_at = now(), last_error = null
    where id = p_id;
  else
    update public.r2_purge_queue
    set last_error = left(p_error, 2000)
    where id = p_id;
  end if;
end;
$$;

revoke execute on function public.complete_r2_purge(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_r2_purge(uuid, text) to service_role;

do $$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.unschedule('medverse-purge-bin');
  exception when others then
    null;
  end;
  begin
    perform cron.schedule(
      'medverse-purge-bin',
      '20 3 * * *',
      'select public.purge_expired_bin_items()'
    );
  exception when others then
    raise notice 'pg_cron unavailable (%), relying on external purge cron', SQLERRM;
  end;
end $$;

-- ###########################################################################
-- PART F — Rewrite get_academic_tree + search_academic_tree
-- ###########################################################################

create or replace function public.get_academic_tree(p_surface text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year_id uuid;
  v_year_number int;
  v_year_name text;
  v_live boolean;
  v_subjects jsonb := '[]'::jsonb;
  v_subj record;
  v_cats jsonb;
  v_folders jsonb;
  v_prof jsonb;
  v_days jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_surface not in ('resources', 'library') then
    raise exception 'invalid_surface';
  end if;

  select e.year_id, y.year_number, y.name
  into v_year_id, v_year_number, v_year_name
  from public.enrollments e
  join public.years y on y.id = e.year_id
  where e.student_id = v_uid and e.status = 'active';

  if v_year_id is null then
    raise exception 'no_active_enrollment';
  end if;

  v_live := public.has_live_subscription();

  if v_year_number = 5 then
    v_year_name := 'Final Year MBBS';
  end if;

  -- Product subjects only (Blocks / Final Year clinical). Departmental rows stay for QB.
  for v_subj in
    select s.id, s.name, s.sort_order, s.product_key, s.entitlement, s.required_plan_id
    from public.subjects s
    where s.year_id = v_year_id
      and s.product_key is not null
    order by s.sort_order, s.name
  loop
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'folder_id', f.id,
        'name', f.name,
        'locked', not public.can_access_material_folder(f.id),
        'parent_id', f.parent_id,
        'library_type', f.library_type
      )
      order by f.sort_order, f.name
    ), '[]'::jsonb)
    into v_folders
    from public.material_folders f
    where f.year_id = v_year_id
      and f.subject_id = v_subj.id
      and f.deleted_at is null
      and public.can_view_material_folder(f.id);

    -- Eight product categories; mcq_bank / pearl_points carry empty folder arrays.
    -- Free students navigate chrome (locked=false); folder open still entitlement-gated.
    select jsonb_agg(cat order by ord) into v_cats
    from (
      select 1 as ord, jsonb_build_object(
        'library_type', 'mcq_bank',
        'name', 'MCQ Bank',
        'locked', false,
        'placeholder', false,
        'folders', '[]'::jsonb
      ) as cat
      union all
      select 2, jsonb_build_object(
        'library_type', 'pearl_points',
        'name', 'Pearl Points',
        'locked', false,
        'placeholder', false,
        'folders', '[]'::jsonb
      )
      union all
      select 3, jsonb_build_object(
        'library_type', 'guidelines',
        'name', 'Guidelines',
        'locked', false,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'guidelines'
        ), '[]'::jsonb)
      )
      union all
      select 4, jsonb_build_object(
        'library_type', 'ospe_material',
        'name', 'OSPE Material',
        'locked', false,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'ospe_material'
        ), '[]'::jsonb)
      )
      union all
      select 5, jsonb_build_object(
        'library_type', 'ospe_lectures',
        'name', 'OSPE Lectures',
        'locked', false,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'ospe_lectures'
        ), '[]'::jsonb)
      )
      union all
      select 6, jsonb_build_object(
        'library_type', 'books',
        'name', 'Books',
        'locked', false,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'books'
        ), '[]'::jsonb)
      )
      union all
      select 7, jsonb_build_object(
        'library_type', 'notes',
        'name', 'Notes',
        'locked', false,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'notes'
        ), '[]'::jsonb)
      )
      union all
      select 8, jsonb_build_object(
        'library_type', 'lectures',
        'name', 'Lectures',
        'locked', false,
        'placeholder', false,
        'folders', coalesce((
          select jsonb_agg(x)
          from jsonb_array_elements(v_folders) x
          where x->>'library_type' = 'lectures'
        ), '[]'::jsonb)
      )
    ) cats;

    v_subjects := v_subjects || jsonb_build_array(
      jsonb_build_object(
        'subject_id', v_subj.id,
        'name', v_subj.name,
        'product_key', v_subj.product_key,
        'locked', false,
        'categories', coalesce(v_cats, '[]'::jsonb)
      )
    );
  end loop;

  if not v_live then
    v_prof := jsonb_build_object('locked', true, 'days', '[]'::jsonb);
  else
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'day_id', d.id,
        'name', d.name,
        'sort_order', d.sort_order,
        'slots', (
          select coalesce(jsonb_agg(
            jsonb_build_object(
              'slot_key', sl.slot_key,
              'name', case sl.slot_key
                when 'syllabus' then 'Syllabus'
                when 'guidelines' then 'Guidelines'
                when 'one_liners' then 'One-liners'
                when 'practice_mcqs' then 'Practice MCQs'
                when 'test_mcq' then 'Test MCQ'
              end
            )
            order by case sl.slot_key
              when 'syllabus' then 1
              when 'guidelines' then 2
              when 'one_liners' then 3
              when 'practice_mcqs' then 4
              when 'test_mcq' then 5
            end
          ), '[]'::jsonb)
          from public.prof_session_day_slots sl
          where sl.day_id = d.id
        )
      )
      order by d.sort_order, d.name
    ), '[]'::jsonb)
    into v_days
    from public.prof_session_days d
    where d.year_id = v_year_id
      and d.status = 'published'
      and d.deleted_at is null;

    v_prof := jsonb_build_object('locked', false, 'days', coalesce(v_days, '[]'::jsonb));
  end if;

  return jsonb_build_object(
    'surface', p_surface,
    'year_id', v_year_id,
    'year_number', v_year_number,
    'year_name', v_year_name,
    'subjects', v_subjects,
    'prof_session', v_prof
  );
end;
$$;

revoke execute on function public.get_academic_tree(text) from public, anon;
grant execute on function public.get_academic_tree(text) to authenticated, service_role;

comment on function public.get_academic_tree(text) is
  'Product Blocks + eight categories + Prof. Session chrome. Soft-deleted excluded. Free: prof_session locked with empty days.';

create or replace function public.search_academic_tree(
  p_query text,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_year_id uuid;
  v_year_name text;
  v_live boolean;
  v_q text;
  v_limit int;
  v_hits jsonb := '[]'::jsonb;
  v_cat record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;

  v_q := lower(btrim(coalesce(p_query, '')));
  if v_q = '' then
    return '[]'::jsonb;
  end if;
  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_live := public.has_live_subscription();

  select e.year_id,
    case when y.year_number = 5 then 'Final Year MBBS' else y.name end
  into v_year_id, v_year_name
  from public.enrollments e
  join public.years y on y.id = e.year_id
  where e.student_id = v_uid and e.status = 'active';

  if v_year_id is null then
    raise exception 'no_active_enrollment';
  end if;

  if lower(v_year_name) like '%' || v_q || '%' then
    v_hits := v_hits || jsonb_build_array(jsonb_build_object(
      'kind', 'class',
      'id', v_year_id,
      'name', v_year_name,
      'path_labels', jsonb_build_array(v_year_name),
      'locked', false
    ));
  end if;

  -- Product block / clinical subjects only
  select coalesce(v_hits || jsonb_agg(
    jsonb_build_object(
      'kind', 'block',
      'id', s.id,
      'name', s.name,
      'product_key', s.product_key,
      'path_labels', jsonb_build_array(v_year_name, s.name),
      'locked', false
    )
  ), v_hits)
  into v_hits
  from (
    select s.id, s.name, s.product_key
    from public.subjects s
    where s.year_id = v_year_id
      and s.product_key is not null
      and lower(s.name) like '%' || v_q || '%'
    order by s.sort_order, s.name
    limit v_limit
  ) s;

  -- Category chrome names
  for v_cat in
    select *
    from (
      values
        ('mcq_bank', 'MCQ Bank'),
        ('pearl_points', 'Pearl Points'),
        ('guidelines', 'Guidelines'),
        ('ospe_material', 'OSPE Material'),
        ('ospe_lectures', 'OSPE Lectures'),
        ('books', 'Books'),
        ('notes', 'Notes'),
        ('lectures', 'Lectures')
    ) as c(library_type, name)
    where lower(c.name) like '%' || v_q || '%'
  loop
    v_hits := v_hits || jsonb_build_array(jsonb_build_object(
      'kind', 'category',
      'id', v_cat.library_type,
      'name', v_cat.name,
      'path_labels', jsonb_build_array(v_year_name, v_cat.name),
      'locked', false
    ));
  end loop;

  select coalesce(v_hits || jsonb_agg(
    jsonb_build_object(
      'kind', 'folder',
      'id', f.id,
      'name', f.name,
      'path_labels', jsonb_build_array(v_year_name, coalesce(subj.name, ''), f.name),
      'locked', not public.can_access_material_folder(f.id)
    )
  ), v_hits)
  into v_hits
  from (
    select f.id, f.name, f.subject_id
    from public.material_folders f
    where f.year_id = v_year_id
      and f.deleted_at is null
      and public.can_view_material_folder(f.id)
      and lower(f.name) like '%' || v_q || '%'
    order by f.sort_order, f.name
    limit v_limit
  ) f
  left join public.subjects subj on subj.id = f.subject_id;

  -- Prof. Session days only when live subscription
  if v_live then
    select coalesce(v_hits || jsonb_agg(
      jsonb_build_object(
        'kind', 'prof_session_day',
        'id', d.id,
        'name', d.name,
        'path_labels', jsonb_build_array(v_year_name, 'Prof. Session', d.name),
        'locked', false
      )
    ), v_hits)
    into v_hits
    from (
      select d.id, d.name
      from public.prof_session_days d
      where d.year_id = v_year_id
        and d.status = 'published'
        and d.deleted_at is null
        and lower(d.name) like '%' || v_q || '%'
      order by d.sort_order, d.name
      limit v_limit
    ) d;
  end if;

  return (
    select coalesce(jsonb_agg(x), '[]'::jsonb)
    from (
      select x
      from jsonb_array_elements(v_hits) x
      limit v_limit
    ) t
  );
end;
$$;

revoke execute on function public.search_academic_tree(text, int) from public, anon;
grant execute on function public.search_academic_tree(text, int) to authenticated, service_role;

comment on function public.search_academic_tree(text, int) is
  'Search product blocks, categories, non-deleted folders, and (when subscribed) prof session days.';

-- ###########################################################################
-- PART G — Idempotent Block ensure + seed note
-- ###########################################################################

-- Ensure Block / Final Year product subjects exist for all years (idempotent).
insert into public.subjects (year_id, name, sort_order, product_key)
select y.id, v.name, v.sort_order, v.product_key
from public.years y
join (
  values
    (1, 'Block 1', 1, 'block-1'),
    (1, 'Block 2', 2, 'block-2'),
    (1, 'Block 3', 3, 'block-3'),
    (2, 'Block 4', 1, 'block-4'),
    (2, 'Block 5', 2, 'block-5'),
    (2, 'Block 6', 3, 'block-6'),
    (3, 'Block 7', 1, 'block-7'),
    (3, 'Block 8', 2, 'block-8'),
    (3, 'Block 9', 3, 'block-9'),
    (4, 'Block 10', 1, 'block-10'),
    (4, 'Block 11', 2, 'block-11'),
    (4, 'Block 12', 3, 'block-12')
) as v(year_number, name, sort_order, product_key)
  on v.year_number = y.year_number
where not exists (
  select 1 from public.subjects s
  where s.year_id = y.id and s.product_key = v.product_key
);

-- Note: supabase/seed.sql (via 20260912000005_seed_reference.sql) still inserts
-- departmental subjects (Anatomy, Physiology, …). Product Block rows are created
-- by this migration. Departmental subjects keep product_key NULL for QB taxonomy.

comment on function public.soft_delete_content(text, uuid) is
  'Soft-delete content into bin (7-day purge_after). Does not delete R2 yet.';
comment on function public.restore_content(text, uuid) is
  'Clear soft-delete fields for a bin item.';
comment on function public.purge_content(text, uuid) is
  'Hard-delete content now; enqueue study-content/ R2 keys. Blocks question purge if any test_questions row exists.';
comment on function public.purge_expired_bin_items() is
  'Cron: hard-delete soft-deleted rows past purge_after; enqueue R2. service_role only.';
comment on function public.admin_create_prof_session_day(uuid, text, int) is
  'Create Prof. Session day + five fixed slots. Requires manage_materials + year scope.';
