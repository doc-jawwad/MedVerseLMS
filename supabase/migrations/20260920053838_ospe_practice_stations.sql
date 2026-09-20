-- OSPE Practice stations (image + hidden answer).
-- Mirrors pearl_points for catalog vs reveal and materials PDF for private R2.
-- No materials.kind change, no flashcards, no exam/test_attempts integration.
-- Canonical: docs/database.md, docs/permissions.md, OSPE Data Spine handoff.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table public.ospe_stations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  title text not null,
  answer text not null,
  year_id uuid not null references public.years (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  entitlement text not null default 'free'
    check (entitlement in ('free', 'any_subscription', 'plan')),
  required_plan_id uuid references public.subscription_plans (id),
  r2_object_key text not null,
  r2_content_type text not null,
  r2_byte_size int not null,
  sort_order int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (entitlement = 'plan' and required_plan_id is not null)
    or (entitlement <> 'plan' and required_plan_id is null)
  ),
  check (length(btrim(title)) > 0 and length(btrim(answer)) > 0),
  check (
    r2_object_key ~ '^study-content/'
    and r2_object_key !~ '[[:space:]]'
  ),
  check (r2_content_type in ('image/jpeg', 'image/png', 'image/webp')),
  check (r2_byte_size > 0)
);

create index ospe_stations_year_status_idx on public.ospe_stations (year_id, status);
create index ospe_stations_subject_sort_idx on public.ospe_stations (subject_id, sort_order);

create trigger ospe_stations_updated_at
  before update on public.ospe_stations
  for each row execute function public.set_updated_at();

drop trigger if exists ospe_stations_protect_entitlement on public.ospe_stations;
create trigger ospe_stations_protect_entitlement
  before insert or update on public.ospe_stations
  for each row execute function public.protect_resource_entitlement();

comment on table public.ospe_stations is
  'OSPE Practice stations: private R2 station image + reveal answer. Not materials library packs, not MCQs, not exam attempts.';
comment on column public.ospe_stations.answer is
  'Reveal payload only. Hidden from student SELECT; open_ospe_station is the only student path.';
comment on column public.ospe_stations.r2_object_key is
  'Private R2 study-content/ key. Hidden from student SELECT; authorize_ospe_station_object + Next.js private stream.';

alter table public.ospe_stations enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers: catalog vs content (do NOT use has_practice_access)
-- ---------------------------------------------------------------------------
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
        and public.resource_content_allowed(
          'ospe_station', null, null, null, s.entitlement, s.required_plan_id
        )
    );
$$;

create or replace function public.accessible_ospe_station_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select s.id from public.ospe_stations s where public.can_access_ospe_station(s.id);
$$;

revoke execute on function public.can_view_ospe_station(uuid) from public, anon;
grant execute on function public.can_view_ospe_station(uuid) to authenticated, service_role;
revoke execute on function public.can_access_ospe_station(uuid) from public, anon;
grant execute on function public.can_access_ospe_station(uuid) to authenticated, service_role;
revoke execute on function public.accessible_ospe_station_ids() from public, anon;
grant execute on function public.accessible_ospe_station_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS: deny-by-default; student metadata only; admin year-scoped
-- ---------------------------------------------------------------------------
drop policy if exists ospe_stations_student_select on public.ospe_stations;
create policy ospe_stations_student_select on public.ospe_stations
  for select using (public.can_view_ospe_station(id));

drop policy if exists ospe_stations_admin_select on public.ospe_stations;
create policy ospe_stations_admin_select on public.ospe_stations
  for select using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists ospe_stations_admin_insert on public.ospe_stations;
create policy ospe_stations_admin_insert on public.ospe_stations
  for insert with check (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists ospe_stations_admin_update on public.ospe_stations;
create policy ospe_stations_admin_update on public.ospe_stations
  for update using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  )
  with check (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

drop policy if exists ospe_stations_admin_delete on public.ospe_stations;
create policy ospe_stations_admin_delete on public.ospe_stations
  for delete using (
    public.has_permission('manage_materials')
    and public.admin_can_access_year(year_id)
  );

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
  created_at,
  updated_at
) on public.ospe_stations to authenticated;

-- ---------------------------------------------------------------------------
-- Image authorize (key only; never answer)
-- ---------------------------------------------------------------------------
create or replace function public.authorize_ospe_station_object(p_station_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.ospe_stations%rowtype;
begin
  select * into v_row from public.ospe_stations where id = p_station_id;
  if not found or v_row.r2_object_key is null then
    raise exception 'ospe_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_can_access_year(v_row.year_id) then
      raise exception 'ospe_object_denied';
    end if;
    return v_row.r2_object_key;
  end if;

  if v_row.status is distinct from 'published' then
    raise exception 'ospe_object_denied';
  end if;

  if not public.can_access_ospe_station(p_station_id) then
    raise exception 'ospe_object_denied';
  end if;

  return v_row.r2_object_key;
end;
$$;

revoke execute on function public.authorize_ospe_station_object(uuid) from public, anon;
grant execute on function public.authorize_ospe_station_object(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reveal (answer only; no R2 key / image payload)
-- ---------------------------------------------------------------------------
create or replace function public.open_ospe_station(p_station_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.ospe_stations%rowtype;
begin
  select * into v_row from public.ospe_stations where id = p_station_id;
  if not found then
    raise exception 'ospe_access_denied';
  end if;

  if public.has_permission('manage_materials') then
    if not public.admin_can_access_year(v_row.year_id) then
      raise exception 'ospe_access_denied';
    end if;
    return jsonb_build_object(
      'id', v_row.id,
      'title', v_row.title,
      'answer', v_row.answer
    );
  end if;

  if not public.can_access_ospe_station(p_station_id) then
    raise exception 'ospe_access_denied';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'answer', v_row.answer
  );
end;
$$;

revoke execute on function public.open_ospe_station(uuid) from public, anon;
grant execute on function public.open_ospe_station(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin edit payload
-- ---------------------------------------------------------------------------
create or replace function public.get_ospe_station_for_admin(p_station_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.ospe_stations%rowtype;
begin
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;

  select * into v_row from public.ospe_stations where id = p_station_id;
  if not found then
    raise exception 'ospe_not_found';
  end if;

  if not public.admin_can_access_year(v_row.year_id) then
    raise exception 'permission_denied';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'answer', v_row.answer,
    'year_id', v_row.year_id,
    'subject_id', v_row.subject_id,
    'status', v_row.status,
    'entitlement', v_row.entitlement,
    'required_plan_id', v_row.required_plan_id,
    'r2_object_key', v_row.r2_object_key,
    'r2_content_type', v_row.r2_content_type,
    'r2_byte_size', v_row.r2_byte_size,
    'sort_order', v_row.sort_order,
    'created_by', v_row.created_by,
    'created_at', v_row.created_at,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke execute on function public.get_ospe_station_for_admin(uuid) from public, anon;
grant execute on function public.get_ospe_station_for_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_resource_entitlement: add ospe_station
-- ---------------------------------------------------------------------------
create or replace function public.set_resource_entitlement(
  p_kind text,
  p_id uuid,
  p_entitlement text,
  p_required_plan_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_found boolean := false;
  v_year uuid;
begin
  if p_kind not in (
    'practice_subject', 'test', 'materials_folder', 'pearl_point', 'ospe_station'
  ) then
    raise exception 'invalid resource kind';
  end if;
  if p_entitlement not in ('free', 'any_subscription', 'plan') then
    raise exception 'invalid entitlement';
  end if;

  if p_kind = 'test' then
    if not (
      public.has_permission('grant_resource_access')
      or public.has_permission('publish_tests')
    ) then
      raise exception 'permission_denied';
    end if;
  elsif p_kind in ('materials_folder', 'pearl_point', 'ospe_station') then
    if not (
      public.has_permission('grant_resource_access')
      or public.has_permission('manage_materials')
    ) then
      raise exception 'permission_denied';
    end if;
  else
    perform public.require_permission('grant_resource_access');
  end if;

  if p_kind = 'ospe_station' then
    select year_id into v_year from public.ospe_stations where id = p_id;
    if v_year is null then
      raise exception 'resource not found';
    end if;
    if public.has_permission('manage_materials')
       and not public.has_permission('grant_resource_access')
       and not public.admin_can_access_year(v_year) then
      raise exception 'permission_denied';
    end if;
  end if;

  perform set_config('medverse.set_resource_entitlement', '1', true);
  begin
    if p_kind = 'test' then
      update public.tests
      set entitlement = p_entitlement, required_plan_id = p_required_plan_id
      where id = p_id;
      v_found := found;
    elsif p_kind = 'practice_subject' then
      update public.subjects
      set entitlement = p_entitlement, required_plan_id = p_required_plan_id
      where id = p_id;
      v_found := found;
    elsif p_kind = 'pearl_point' then
      update public.pearl_points
      set entitlement = p_entitlement, required_plan_id = p_required_plan_id
      where id = p_id;
      v_found := found;
    elsif p_kind = 'ospe_station' then
      update public.ospe_stations
      set entitlement = p_entitlement, required_plan_id = p_required_plan_id
      where id = p_id;
      v_found := found;
    else
      update public.material_folders
      set entitlement = p_entitlement, required_plan_id = p_required_plan_id
      where id = p_id;
      v_found := found;
    end if;
    perform set_config('medverse.set_resource_entitlement', '', true);
  exception when others then
    perform set_config('medverse.set_resource_entitlement', '', true);
    raise;
  end;

  if not v_found then
    raise exception 'resource not found';
  end if;

  perform public.log_audit(
    'resource_entitlement_changed',
    p_kind,
    p_id,
    jsonb_build_object(
      'entitlement', p_entitlement,
      'required_plan_id', p_required_plan_id
    )
  );
end;
$$;

revoke execute on function public.set_resource_entitlement(text, uuid, text, uuid) from public, anon;
grant execute on function public.set_resource_entitlement(text, uuid, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- practice_progress: add item_kind = ospe; authorize via can_access_ospe_station
-- ---------------------------------------------------------------------------
alter table public.practice_progress
  drop constraint if exists practice_progress_item_kind_check;
alter table public.practice_progress
  add constraint practice_progress_item_kind_check
  check (item_kind in ('question', 'pearl', 'ospe'));

create or replace function public.set_practice_item_state(
  p_item_kind text,
  p_item_id uuid,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_item_kind not in ('question', 'pearl', 'ospe') then
    raise exception 'invalid_item_kind';
  end if;
  if p_state not in ('remaining', 'done') then
    raise exception 'invalid_state';
  end if;

  if p_item_kind = 'question' then
    select q.subject_id into v_subject
    from public.questions q
    where q.id = p_item_id and q.status = 'approved';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.has_practice_access(v_subject) then
      raise exception 'practice_access_denied';
    end if;
  elsif p_item_kind = 'pearl' then
    select pp.subject_id into v_subject
    from public.pearl_points pp
    where pp.id = p_item_id and pp.status = 'published';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.has_practice_access(v_subject) then
      raise exception 'practice_access_denied';
    end if;
  else
    select s.subject_id into v_subject
    from public.ospe_stations s
    where s.id = p_item_id and s.status = 'published';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.can_access_ospe_station(p_item_id) then
      raise exception 'practice_access_denied';
    end if;
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  insert into public.practice_progress (
    student_id, item_kind, item_id, state, marked, subject_id
  ) values (
    v_uid, p_item_kind, p_item_id, p_state, false, v_subject
  )
  on conflict (student_id, item_kind, item_id) do update
  set state = excluded.state,
      subject_id = excluded.subject_id,
      updated_at = now();
  perform set_config('medverse.practice_progress_rpc', '', true);
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.set_practice_item_state(text, uuid, text) from public, anon;
grant execute on function public.set_practice_item_state(text, uuid, text) to authenticated, service_role;

create or replace function public.set_practice_item_marked(
  p_item_kind text,
  p_item_id uuid,
  p_marked boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.account_allows_lms() then
    raise exception 'account_not_eligible';
  end if;
  if p_item_kind not in ('question', 'pearl', 'ospe') then
    raise exception 'invalid_item_kind';
  end if;

  if p_item_kind = 'question' then
    select q.subject_id into v_subject
    from public.questions q
    where q.id = p_item_id and q.status = 'approved';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.has_practice_access(v_subject) then
      raise exception 'practice_access_denied';
    end if;
  elsif p_item_kind = 'pearl' then
    select pp.subject_id into v_subject
    from public.pearl_points pp
    where pp.id = p_item_id and pp.status = 'published';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.has_practice_access(v_subject) then
      raise exception 'practice_access_denied';
    end if;
  else
    select s.subject_id into v_subject
    from public.ospe_stations s
    where s.id = p_item_id and s.status = 'published';
    if v_subject is null then
      raise exception 'item_not_found';
    end if;
    if not public.can_access_ospe_station(p_item_id) then
      raise exception 'practice_access_denied';
    end if;
  end if;

  perform set_config('medverse.practice_progress_rpc', '1', true);
  insert into public.practice_progress (
    student_id, item_kind, item_id, state, marked, subject_id
  ) values (
    v_uid, p_item_kind, p_item_id, 'remaining', coalesce(p_marked, false), v_subject
  )
  on conflict (student_id, item_kind, item_id) do update
  set marked = excluded.marked,
      subject_id = excluded.subject_id,
      updated_at = now();
  perform set_config('medverse.practice_progress_rpc', '', true);
exception
  when others then
    perform set_config('medverse.practice_progress_rpc', '', true);
    raise;
end;
$$;

revoke execute on function public.set_practice_item_marked(text, uuid, boolean) from public, anon;
grant execute on function public.set_practice_item_marked(text, uuid, boolean) to authenticated, service_role;
