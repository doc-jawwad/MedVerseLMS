-- Step 8D: resource entitlement, access_restrictions, catalog vs content.
-- Does NOT create subscription tables, payment, books/videos delivery, or Realtime.
-- required_plan_id has no FK until subscription_plans exists (docs/database.md).

-- ---------------------------------------------------------------------------
-- Entitlement columns (existing rows default/backfill to free)
-- ---------------------------------------------------------------------------
alter table public.tests
  add column if not exists entitlement text not null default 'free';
alter table public.tests
  add column if not exists required_plan_id uuid;

alter table public.subjects
  add column if not exists entitlement text not null default 'free';
alter table public.subjects
  add column if not exists required_plan_id uuid;

alter table public.material_folders
  add column if not exists entitlement text not null default 'free';
alter table public.material_folders
  add column if not exists required_plan_id uuid;

alter table public.tests
  drop constraint if exists tests_entitlement_check;
alter table public.tests
  add constraint tests_entitlement_check
  check (entitlement in ('free', 'any_subscription', 'plan'));
alter table public.tests
  drop constraint if exists tests_required_plan_id_check;
alter table public.tests
  add constraint tests_required_plan_id_check
  check (
    (entitlement = 'plan' and required_plan_id is not null)
    or (entitlement <> 'plan' and required_plan_id is null)
  );

alter table public.subjects
  drop constraint if exists subjects_entitlement_check;
alter table public.subjects
  add constraint subjects_entitlement_check
  check (entitlement in ('free', 'any_subscription', 'plan'));
alter table public.subjects
  drop constraint if exists subjects_required_plan_id_check;
alter table public.subjects
  add constraint subjects_required_plan_id_check
  check (
    (entitlement = 'plan' and required_plan_id is not null)
    or (entitlement <> 'plan' and required_plan_id is null)
  );

alter table public.material_folders
  drop constraint if exists material_folders_entitlement_check;
alter table public.material_folders
  add constraint material_folders_entitlement_check
  check (entitlement in ('free', 'any_subscription', 'plan'));
alter table public.material_folders
  drop constraint if exists material_folders_required_plan_id_check;
alter table public.material_folders
  add constraint material_folders_required_plan_id_check
  check (
    (entitlement = 'plan' and required_plan_id is not null)
    or (entitlement <> 'plan' and required_plan_id is null)
  );

update public.tests set entitlement = 'free' where entitlement is distinct from 'free';
update public.subjects set entitlement = 'free' where entitlement is distinct from 'free';
update public.material_folders set entitlement = 'free' where entitlement is distinct from 'free';

comment on column public.tests.required_plan_id is
  'Required iff entitlement=plan. No FK until subscription_plans exists.';
comment on column public.subjects.required_plan_id is
  'Required iff entitlement=plan. No FK until subscription_plans exists.';
comment on column public.material_folders.required_plan_id is
  'Required iff entitlement=plan. No FK until subscription_plans exists.';

-- ---------------------------------------------------------------------------
-- access_restrictions (deny overlay). Same target shape as access_grants.
-- ---------------------------------------------------------------------------
create table public.access_restrictions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.default_tenant(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  resource_kind text not null check (resource_kind in ('practice_subject', 'test', 'materials_folder')),
  subject_id uuid references public.subjects (id) on delete cascade,
  test_id uuid references public.tests (id) on delete cascade,
  folder_id uuid references public.material_folders (id) on delete cascade,
  set_by uuid references public.profiles (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (resource_kind = 'practice_subject' and subject_id is not null and test_id is null and folder_id is null) or
    (resource_kind = 'test'             and test_id is not null and subject_id is null and folder_id is null) or
    (resource_kind = 'materials_folder' and folder_id is not null and subject_id is null and test_id is null)
  )
);

create unique index access_restrictions_unique_target
  on public.access_restrictions (student_id, resource_kind, coalesce(subject_id, test_id, folder_id))
  where revoked_at is null;

create index access_restrictions_student_idx
  on public.access_restrictions (student_id)
  where revoked_at is null;

create trigger access_restrictions_updated_at before update on public.access_restrictions
  for each row execute function public.set_updated_at();

alter table public.access_restrictions enable row level security;

create policy access_restrictions_select on public.access_restrictions
  for select using (student_id = (select auth.uid()) or public.is_admin());
-- writes: restrict_access / unrestrict_access only (SECURITY DEFINER)

-- ---------------------------------------------------------------------------
-- Subscription stubs (no subscription tables in this step)
-- ---------------------------------------------------------------------------
create or replace function public.has_live_subscription()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Returns false until subscriptions exist. Do not treat this as complimentary access.
  select false;
$$;

create or replace function public.has_live_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select false and p_plan_id is not null;
$$;

-- ---------------------------------------------------------------------------
-- Central evaluator
-- Precedence for an already-visible catalog item (docs/permissions.md):
--   account not active → deny
--   live restriction   → deny
--   live grant         → allow
--   free               → allow
--   any_subscription   → allow only if has_live_subscription()
--   plan               → allow only if has_live_plan(required_plan_id)
-- ---------------------------------------------------------------------------
create or replace function public.has_resource_grant(
  p_kind text,
  p_subject_id uuid default null,
  p_test_id uuid default null,
  p_folder_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.access_grants g
    where g.student_id = (select auth.uid())
      and g.grant_type = p_kind
      and g.revoked_at is null
      and (
        (p_kind = 'practice_subject' and g.subject_id is not distinct from p_subject_id) or
        (p_kind = 'test' and g.test_id is not distinct from p_test_id) or
        (p_kind = 'materials_folder' and g.folder_id is not distinct from p_folder_id)
      )
  );
$$;

create or replace function public.has_resource_restriction(
  p_kind text,
  p_subject_id uuid default null,
  p_test_id uuid default null,
  p_folder_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.access_restrictions r
    where r.student_id = (select auth.uid())
      and r.resource_kind = p_kind
      and r.revoked_at is null
      and (
        (p_kind = 'practice_subject' and r.subject_id is not distinct from p_subject_id) or
        (p_kind = 'test' and r.test_id is not distinct from p_test_id) or
        (p_kind = 'materials_folder' and r.folder_id is not distinct from p_folder_id)
      )
  );
$$;

create or replace function public.resource_entitlement_allows(
  p_entitlement text,
  p_required_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_entitlement
    when 'free' then true
    when 'any_subscription' then public.has_live_subscription()
    when 'plan' then p_required_plan_id is not null and public.has_live_plan(p_required_plan_id)
    else false
  end;
$$;

create or replace function public.resource_content_allowed(
  p_kind text,
  p_subject_id uuid,
  p_test_id uuid,
  p_folder_id uuid,
  p_entitlement text,
  p_required_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and not public.has_resource_restriction(p_kind, p_subject_id, p_test_id, p_folder_id)
    and (
      public.has_resource_grant(p_kind, p_subject_id, p_test_id, p_folder_id)
      or public.resource_entitlement_allows(p_entitlement, p_required_plan_id)
    );
$$;

-- ---------------------------------------------------------------------------
-- Tests: catalog (can_view_test) vs content (can_access_test)
-- ---------------------------------------------------------------------------
create or replace function public.can_view_test(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.tests t
      where t.id = p_test_id
        and t.status in ('published', 'closed')
        and (
          exists (
            select 1 from public.test_audiences a
            join public.enrollments e
              on e.year_id = a.year_id
             and e.student_id = (select auth.uid())
             and e.status = 'active'
            where a.test_id = t.id
          )
          or public.has_resource_grant('test', null, t.id, null)
        )
    );
$$;

create or replace function public.can_access_test(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_test(p_test_id)
    and exists (
      select 1 from public.tests t
      where t.id = p_test_id
        and public.resource_content_allowed(
          'test', null, t.id, null, t.entitlement, t.required_plan_id
        )
    );
$$;

drop policy if exists tests_student_select on public.tests;
create policy tests_student_select on public.tests
  for select using (public.can_view_test(id));

create or replace function public.accessible_test_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select t.id from public.tests t where public.can_access_test(t.id);
$$;

-- ---------------------------------------------------------------------------
-- Practice: catalog vs content. granted column remains the content flag.
-- ---------------------------------------------------------------------------
create or replace function public.can_view_practice_subject(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.account_allows_lms()
    and exists (
      select 1 from public.subjects s
      where s.id = p_subject_id
        and (
          public.has_active_enrollment(s.year_id)
          or public.has_resource_grant('practice_subject', s.id, null, null)
        )
    );
$$;

create or replace function public.has_practice_access(p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_practice_subject(p_subject_id)
    and exists (
      select 1 from public.subjects s
      where s.id = p_subject_id
        and public.resource_content_allowed(
          'practice_subject', s.id, null, null, s.entitlement, s.required_plan_id
        )
    );
$$;

create or replace function public.practice_subjects()
returns table (
  subject_id uuid,
  subject_name text,
  approved_questions bigint,
  granted boolean,
  answered bigint,
  correct bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    (select count(*) from public.questions q
      where q.subject_id = s.id and q.status = 'approved') as approved_questions,
    public.has_practice_access(s.id) as granted,
    (select count(*) from public.practice_answers pa
      where pa.student_id = (select auth.uid()) and pa.subject_id = s.id) as answered,
    (select count(*) from public.practice_answers pa
      where pa.student_id = (select auth.uid()) and pa.subject_id = s.id and pa.is_correct) as correct
  from public.subjects s
  where public.can_view_practice_subject(s.id)
  order by s.sort_order, s.name;
$$;

-- ---------------------------------------------------------------------------
-- Materials: catalog vs content; drive_url is not a student SELECT column
-- ---------------------------------------------------------------------------
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
        and public.resource_content_allowed(
          'materials_folder', null, null, f.id, f.entitlement, f.required_plan_id
        )
    );
$$;

create or replace function public.accessible_folder_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select f.id from public.material_folders f where public.can_access_material_folder(f.id);
$$;

drop policy if exists material_folders_student_select on public.material_folders;
create policy material_folders_student_select on public.material_folders
  for select using (public.can_view_material_folder(id));

drop policy if exists materials_student_select on public.materials;
create policy materials_student_select on public.materials
  for select using (public.can_view_material_folder(folder_id));

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
  sort_order,
  created_at,
  updated_at
) on public.materials to authenticated;

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
begin
  select folder_id, drive_url into v_folder_id, v_url
  from public.materials
  where id = p_material_id;

  if v_url is null then
    raise exception 'material_access_denied';
  end if;

  if public.is_admin() then
    return v_url;
  end if;

  if not public.can_access_material_folder(v_folder_id) then
    raise exception 'material_access_denied';
  end if;

  return v_url;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entitlement mutations are RPC-only (audit + grant_resource_access)
-- ---------------------------------------------------------------------------
create or replace function public.protect_resource_entitlement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.entitlement is not distinct from 'free' and new.required_plan_id is null then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.entitlement is not distinct from old.entitlement
       and new.required_plan_id is not distinct from old.required_plan_id then
      return new;
    end if;
  end if;

  if current_setting('medverse.set_resource_entitlement', true) is distinct from '1' then
    raise exception 'entitlement changes require set_resource_entitlement()';
  end if;
  return new;
end;
$$;

drop trigger if exists tests_protect_entitlement on public.tests;
create trigger tests_protect_entitlement
  before insert or update on public.tests
  for each row execute function public.protect_resource_entitlement();

drop trigger if exists subjects_protect_entitlement on public.subjects;
create trigger subjects_protect_entitlement
  before insert or update on public.subjects
  for each row execute function public.protect_resource_entitlement();

drop trigger if exists material_folders_protect_entitlement on public.material_folders;
create trigger material_folders_protect_entitlement
  before insert or update on public.material_folders
  for each row execute function public.protect_resource_entitlement();

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
  perform public.require_permission('grant_resource_access');
  if p_kind not in ('practice_subject', 'test', 'materials_folder') then
    raise exception 'invalid resource kind';
  end if;
  if p_entitlement not in ('free', 'any_subscription', 'plan') then
    raise exception 'invalid entitlement';
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

create or replace function public.restrict_access(
  p_student_id uuid,
  p_resource_kind text,
  p_subject_id uuid default null,
  p_test_id uuid default null,
  p_folder_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_permission('grant_resource_access');
  insert into public.access_restrictions (
    student_id, resource_kind, subject_id, test_id, folder_id, set_by
  ) values (
    p_student_id, p_resource_kind, p_subject_id, p_test_id, p_folder_id, (select auth.uid())
  )
  returning id into v_id;
  perform public.log_audit(
    'access_restricted',
    'access_restriction',
    v_id,
    jsonb_build_object(
      'student_id', p_student_id,
      'resource_kind', p_resource_kind,
      'subject_id', p_subject_id,
      'test_id', p_test_id,
      'folder_id', p_folder_id
    )
  );
  return v_id;
end;
$$;

create or replace function public.unrestrict_access(p_restriction_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_restrictions%rowtype;
begin
  perform public.require_permission('grant_resource_access');
  update public.access_restrictions
  set revoked_at = now()
  where id = p_restriction_id and revoked_at is null
  returning * into v_row;
  if not found then
    raise exception 'restriction not found or already revoked';
  end if;
  perform public.log_audit(
    'access_unrestricted',
    'access_restriction',
    p_restriction_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'resource_kind', v_row.resource_kind
    )
  );
end;
$$;

revoke execute on function public.set_resource_entitlement(text, uuid, text, uuid) from public, anon;
grant execute on function public.set_resource_entitlement(text, uuid, text, uuid) to authenticated, service_role;
revoke execute on function public.restrict_access(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.restrict_access(uuid, text, uuid, uuid, uuid) to authenticated, service_role;
revoke execute on function public.unrestrict_access(uuid) from public, anon;
grant execute on function public.unrestrict_access(uuid) to authenticated, service_role;
revoke execute on function public.open_material(uuid) from public, anon;
grant execute on function public.open_material(uuid) to authenticated, service_role;
