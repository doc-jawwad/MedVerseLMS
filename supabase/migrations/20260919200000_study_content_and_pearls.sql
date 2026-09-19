-- Study content: PDF + text guidelines on materials, test prep notes, pearl points.
-- Reuses folder/test/subject entitlement. No second access model.
-- Canonical: docs/database.md, docs/permissions.md, docs/architecture.md, docs/test-rules.md.

-- ---------------------------------------------------------------------------
-- materials: kind + payload (preserve existing Drive rows)
-- ---------------------------------------------------------------------------
alter table public.materials
  add column if not exists kind text not null default 'drive';
alter table public.materials
  add column if not exists status text not null default 'published';
alter table public.materials
  add column if not exists body_text text;
alter table public.materials
  add column if not exists r2_object_key text;
alter table public.materials
  add column if not exists r2_content_type text;
alter table public.materials
  add column if not exists r2_byte_size int;
alter table public.materials
  add column if not exists cover_object_key text;
alter table public.materials
  add column if not exists chapter_id uuid references public.chapters (id) on delete set null;
alter table public.materials
  add column if not exists topic_id uuid references public.topics (id) on delete set null;
alter table public.materials
  add column if not exists reference_text text not null default '';

alter table public.materials
  alter column drive_url drop not null;

alter table public.materials
  drop constraint if exists materials_drive_url_https;
alter table public.materials
  drop constraint if exists materials_kind_check;
alter table public.materials
  drop constraint if exists materials_status_check;
alter table public.materials
  drop constraint if exists materials_kind_payload_check;

alter table public.materials
  add constraint materials_kind_check
  check (kind in ('drive', 'pdf', 'guideline'));
alter table public.materials
  add constraint materials_status_check
  check (status in ('draft', 'published'));
alter table public.materials
  add constraint materials_kind_payload_check
  check (
    (
      kind = 'drive'
      and drive_url ~ '^https://[^[:space:]]+$'
      and body_text is null
      and r2_object_key is null
      and cover_object_key is null
    )
    or (
      kind = 'pdf'
      and drive_url is null
      and body_text is null
      and r2_object_key ~ '^study-content/'
      and r2_object_key !~ '[[:space:]]'
      and (cover_object_key is null or (
        cover_object_key ~ '^study-content/'
        and cover_object_key !~ '[[:space:]]'
      ))
    )
    or (
      kind = 'guideline'
      and drive_url is null
      and r2_object_key is null
      and body_text is not null
      and length(btrim(body_text)) > 0
      and (cover_object_key is null or (
        cover_object_key ~ '^study-content/'
        and cover_object_key !~ '[[:space:]]'
      ))
    )
  );

comment on column public.materials.kind is
  'drive = Google Drive URL; pdf = private R2 study-content/; guideline = body_text. Folder entitlement still applies.';
comment on column public.materials.drive_url is
  'Drive URL for kind=drive only. Hidden from student SELECT; open_material is the only student path.';
comment on column public.materials.body_text is
  'Guideline markdown/plain text. Hidden from student SELECT; open_study_item is the only student path.';
comment on column public.materials.r2_object_key is
  'Private R2 object key under study-content/. Hidden from student SELECT; authorize_study_object + Next.js signed GET.';

update public.materials
set kind = 'drive', status = 'published'
where kind is distinct from 'drive' or status is distinct from 'published';

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
  created_at,
  updated_at
) on public.materials to authenticated;

drop policy if exists materials_student_select on public.materials;
create policy materials_student_select on public.materials
  for select using (
    status = 'published'
    and public.can_view_material_folder(folder_id)
  );

-- ---------------------------------------------------------------------------
-- open_material: Drive only
-- ---------------------------------------------------------------------------
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
begin
  select folder_id, drive_url, kind, status
    into v_folder_id, v_url, v_kind, v_status
  from public.materials
  where id = p_material_id;

  if v_kind is distinct from 'drive' or v_url is null then
    raise exception 'material_access_denied';
  end if;

  if public.has_permission('manage_materials') then
    return v_url;
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

-- ---------------------------------------------------------------------------
-- Study item open (guidelines + PDF metadata; never returns R2 keys)
-- ---------------------------------------------------------------------------
create or replace function public.open_study_item(p_material_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.materials%rowtype;
  v_admin boolean;
begin
  select * into v_row from public.materials where id = p_material_id;
  if not found then
    raise exception 'material_access_denied';
  end if;

  v_admin := public.has_permission('manage_materials');
  if not v_admin then
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

create or replace function public.get_material_for_admin(p_material_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.materials%rowtype;
begin
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;
  select * into v_row from public.materials where id = p_material_id;
  if not found then
    raise exception 'material_not_found';
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'folder_id', v_row.folder_id,
    'title', v_row.title,
    'description', v_row.description,
    'file_type', v_row.file_type,
    'kind', v_row.kind,
    'status', v_row.status,
    'drive_url', v_row.drive_url,
    'body_text', v_row.body_text,
    'r2_object_key', v_row.r2_object_key,
    'cover_object_key', v_row.cover_object_key,
    'chapter_id', v_row.chapter_id,
    'topic_id', v_row.topic_id,
    'reference_text', v_row.reference_text
  );
end;
$$;

revoke execute on function public.get_material_for_admin(uuid) from public, anon;
grant execute on function public.get_material_for_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private R2 study-content/ keys (same bucket as payment proofs)
-- ---------------------------------------------------------------------------
create or replace function public.allocate_study_object_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  perform public.require_permission('manage_materials');
  return format(
    'study-content/%s/%s/%s',
    public.default_tenant()::text,
    v_uid::text,
    gen_random_uuid()::text
  );
end;
$$;

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
begin
  select folder_id, r2_object_key, kind, status
    into v_folder_id, v_key, v_kind, v_status
  from public.materials
  where id = p_material_id;

  if v_kind is distinct from 'pdf' or v_key is null then
    raise exception 'study_object_denied';
  end if;

  if public.has_permission('manage_materials') then
    return v_key;
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

create or replace function public.authorize_study_object_discard(p_object_key text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.require_permission('manage_materials');
  if p_object_key is null
     or p_object_key !~ '^study-content/'
     or p_object_key ~ '[[:space:]]' then
    raise exception 'study_object_denied';
  end if;
  return p_object_key;
end;
$$;

revoke execute on function public.allocate_study_object_key() from public, anon;
grant execute on function public.allocate_study_object_key() to authenticated, service_role;
revoke execute on function public.authorize_study_object(uuid) from public, anon;
grant execute on function public.authorize_study_object(uuid) to authenticated, service_role;
revoke execute on function public.authorize_study_object_discard(text) from public, anon;
grant execute on function public.authorize_study_object_discard(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Test preparation guidelines (side table so tests student SELECT cannot leak)
-- ---------------------------------------------------------------------------
create table if not exists public.test_prep_guidelines (
  test_id uuid primary key references public.tests (id) on delete cascade,
  tenant_id uuid not null default public.default_tenant(),
  body_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger test_prep_guidelines_updated_at
  before update on public.test_prep_guidelines
  for each row execute function public.set_updated_at();

alter table public.test_prep_guidelines enable row level security;

drop policy if exists test_prep_guidelines_admin_select on public.test_prep_guidelines;
create policy test_prep_guidelines_admin_select on public.test_prep_guidelines
  for select using (public.can_admin_select_tests());

drop policy if exists test_prep_guidelines_admin_insert on public.test_prep_guidelines;
create policy test_prep_guidelines_admin_insert on public.test_prep_guidelines
  for insert with check (public.has_permission('publish_tests'));

drop policy if exists test_prep_guidelines_admin_update on public.test_prep_guidelines;
create policy test_prep_guidelines_admin_update on public.test_prep_guidelines
  for update using (public.has_permission('publish_tests'))
  with check (public.has_permission('publish_tests'));

drop policy if exists test_prep_guidelines_admin_delete on public.test_prep_guidelines;
create policy test_prep_guidelines_admin_delete on public.test_prep_guidelines
  for delete using (public.has_permission('publish_tests'));

create or replace function public.protect_test_prep_guidelines()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.tests
  where id = coalesce(new.test_id, old.test_id);

  -- DELETE is allowed so ON DELETE CASCADE from tests still works.
  if tg_op in ('INSERT', 'UPDATE') and v_status is distinct from 'draft' then
    raise exception 'published test config is frozen (docs/test-rules.md)';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists test_prep_guidelines_protect on public.test_prep_guidelines;
create trigger test_prep_guidelines_protect
  before insert or update or delete on public.test_prep_guidelines
  for each row execute function public.protect_test_prep_guidelines();

create or replace function public.upsert_test_prep_guidelines(
  p_test_id uuid,
  p_body_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_permission('publish_tests');
  insert into public.test_prep_guidelines (test_id, body_text)
  values (p_test_id, coalesce(p_body_text, ''))
  on conflict (test_id) do update
    set body_text = excluded.body_text;
end;
$$;

create or replace function public.get_test_prep_guidelines(p_test_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_body text;
begin
  if public.can_admin_select_tests() or public.has_permission('view_analytics') then
    select body_text into v_body
    from public.test_prep_guidelines
    where test_id = p_test_id;
    return coalesce(v_body, '');
  end if;

  if not public.can_access_test(p_test_id) then
    raise exception 'test_prep_denied';
  end if;

  select body_text into v_body
  from public.test_prep_guidelines
  where test_id = p_test_id;
  return coalesce(v_body, '');
end;
$$;

create or replace function public.accessible_test_prep()
returns table (test_id uuid, body_text text)
language sql
stable
security definer
set search_path = public
as $$
  select g.test_id, g.body_text
  from public.test_prep_guidelines g
  where length(btrim(g.body_text)) > 0
    and public.can_access_test(g.test_id);
$$;

revoke execute on function public.upsert_test_prep_guidelines(uuid, text) from public, anon;
grant execute on function public.upsert_test_prep_guidelines(uuid, text) to authenticated, service_role;
revoke execute on function public.get_test_prep_guidelines(uuid) from public, anon;
grant execute on function public.get_test_prep_guidelines(uuid) to authenticated, service_role;
revoke execute on function public.accessible_test_prep() from public, anon;
grant execute on function public.accessible_test_prep() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pearl points (not question bank)
-- ---------------------------------------------------------------------------
create table if not exists public.pearl_points (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  prompt text not null,
  answer text not null,
  explanation text not null default '',
  year_id uuid not null references public.years (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  chapter_id uuid references public.chapters (id) on delete set null,
  topic_id uuid references public.topics (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'published')),
  entitlement text not null default 'free'
    check (entitlement in ('free', 'any_subscription', 'plan')),
  required_plan_id uuid references public.subscription_plans (id),
  sort_order int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (entitlement = 'plan' and required_plan_id is not null)
    or (entitlement <> 'plan' and required_plan_id is null)
  ),
  check (length(btrim(prompt)) > 0 and length(btrim(answer)) > 0)
);

create index pearl_points_year_status_idx on public.pearl_points (year_id, status);
create index pearl_points_subject_idx on public.pearl_points (subject_id);

create trigger pearl_points_updated_at
  before update on public.pearl_points
  for each row execute function public.set_updated_at();

drop trigger if exists pearl_points_protect_entitlement on public.pearl_points;
create trigger pearl_points_protect_entitlement
  before insert or update on public.pearl_points
  for each row execute function public.protect_resource_entitlement();

alter table public.pearl_points enable row level security;

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
        and public.resource_content_allowed(
          'pearl_point', null, null, null, p.entitlement, p.required_plan_id
        )
    );
$$;

create or replace function public.accessible_pearl_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.pearl_points p where public.can_access_pearl(p.id);
$$;

revoke execute on function public.can_view_pearl(uuid) from public, anon;
grant execute on function public.can_view_pearl(uuid) to authenticated, service_role;
revoke execute on function public.can_access_pearl(uuid) from public, anon;
grant execute on function public.can_access_pearl(uuid) to authenticated, service_role;
revoke execute on function public.accessible_pearl_ids() from public, anon;
grant execute on function public.accessible_pearl_ids() to authenticated, service_role;

drop policy if exists pearl_points_student_select on public.pearl_points;
create policy pearl_points_student_select on public.pearl_points
  for select using (public.can_view_pearl(id));

drop policy if exists pearl_points_admin_select on public.pearl_points;
create policy pearl_points_admin_select on public.pearl_points
  for select using (public.can_admin_select_materials());

drop policy if exists pearl_points_admin_insert on public.pearl_points;
create policy pearl_points_admin_insert on public.pearl_points
  for insert with check (public.has_permission('manage_materials'));

drop policy if exists pearl_points_admin_update on public.pearl_points;
create policy pearl_points_admin_update on public.pearl_points
  for update using (public.has_permission('manage_materials'))
  with check (public.has_permission('manage_materials'));

drop policy if exists pearl_points_admin_delete on public.pearl_points;
create policy pearl_points_admin_delete on public.pearl_points
  for delete using (public.has_permission('manage_materials'));

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
  created_at,
  updated_at
) on public.pearl_points to authenticated;

create or replace function public.open_pearl(p_pearl_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.pearl_points%rowtype;
begin
  select * into v_row from public.pearl_points where id = p_pearl_id;
  if not found then
    raise exception 'pearl_access_denied';
  end if;

  if public.has_permission('manage_materials') then
    return jsonb_build_object(
      'id', v_row.id,
      'prompt', v_row.prompt,
      'answer', v_row.answer,
      'explanation', v_row.explanation,
      'year_id', v_row.year_id,
      'subject_id', v_row.subject_id,
      'chapter_id', v_row.chapter_id,
      'topic_id', v_row.topic_id,
      'status', v_row.status,
      'entitlement', v_row.entitlement
    );
  end if;

  if not public.can_access_pearl(p_pearl_id) then
    raise exception 'pearl_access_denied';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'prompt', v_row.prompt,
    'answer', v_row.answer,
    'explanation', v_row.explanation,
    'year_id', v_row.year_id,
    'subject_id', v_row.subject_id,
    'chapter_id', v_row.chapter_id,
    'topic_id', v_row.topic_id
  );
end;
$$;

create or replace function public.get_pearl_for_admin(p_pearl_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission('manage_materials') then
    raise exception 'permission_denied';
  end if;
  return public.open_pearl(p_pearl_id);
end;
$$;

revoke execute on function public.open_pearl(uuid) from public, anon;
grant execute on function public.open_pearl(uuid) to authenticated, service_role;
revoke execute on function public.get_pearl_for_admin(uuid) from public, anon;
grant execute on function public.get_pearl_for_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- set_resource_entitlement: add pearl_point; allow academic publishers/materials
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
begin
  if p_kind not in ('practice_subject', 'test', 'materials_folder', 'pearl_point') then
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
  elsif p_kind in ('materials_folder', 'pearl_point') then
    if not (
      public.has_permission('grant_resource_access')
      or public.has_permission('manage_materials')
    ) then
      raise exception 'permission_denied';
    end if;
  else
    perform public.require_permission('grant_resource_access');
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
