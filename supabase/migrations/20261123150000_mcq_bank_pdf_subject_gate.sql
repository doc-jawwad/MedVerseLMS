-- Issue #11 / Batch 2 (R2): MCQ Bank PDFs follow subject-level authorization.
--
-- Founder decision D1(a): MCQ Bank access is subject-level only. The shadow
-- material_folders row (library_type = 'mcq_bank') is always inserted with
-- entitlement 'free' (ensure_mcq_bank_material_folder), so the old
--   mcq_bank-subject-gate OR resource_entitlement_allows(entitlement)
-- predicate let any eligible enrolled non-subscriber open PDFs of PAID
-- subjects. This migration removes the folder-entitlement path for mcq_bank
-- only. Non-mcq_bank predicates are unchanged.
--
-- mcq_bank folder content is allowed iff ALL hold:
--   * visible (can_view_material_folder / enrollment or grant) and LMS account ok
--   * no active folder-level restriction
--   * no active practice_subject restriction on the folder's subject
--     (so a restriction also beats an explicit folder grant)
--   * has_practice_access(subject) OR an explicit non-revoked folder grant
--
-- Also: set_resource_entitlement rejects materials_folder on mcq_bank shadow
-- folders (mcq_bank_access_is_subject_level) and enforces the class/year check
-- (admin_can_access_year) for materials_folder and pearl_point for admins that
-- hold manage_materials without grant_resource_access (as ospe_station already
-- does). No data rewrite of existing shadow rows (they become inert).
-- Rollback: docs/validation/mcq-bank-subject-gate-rollback-20261123.sql

-- ---------------------------------------------------------------------------
-- 1. can_access_material_folder (scalar)
-- ---------------------------------------------------------------------------
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
        and (
          (
            f.library_type = 'mcq_bank'
            and public.account_allows_lms()
            and not public.has_resource_restriction(
              'materials_folder', null, null, f.id
            )
            and (
              f.subject_id is null
              or not public.has_resource_restriction(
                'practice_subject', f.subject_id, null, null
              )
            )
            and (
              (f.subject_id is not null and public.has_practice_access(f.subject_id))
              or public.has_resource_grant('materials_folder', null, null, f.id)
            )
          )
          or (
            f.library_type is distinct from 'mcq_bank'
            and public.resource_content_allowed(
              'materials_folder', null, null, f.id, f.entitlement, f.required_plan_id
            )
          )
        )
    );
$$;

comment on function public.can_access_material_folder(uuid) is
  'Content open. mcq_bank follows subject-level has_practice_access (or explicit folder grant) and honours folder and subject restrictions; folder entitlement is NOT a boundary for mcq_bank (D1a). Other folders use resource_content_allowed.';

-- ---------------------------------------------------------------------------
-- 2. accessible_folder_ids (set-based, same predicate)
-- ---------------------------------------------------------------------------
create or replace function public.accessible_folder_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      (select auth.uid()) as uid,
      public.account_allows_lms() as ok
  ),
  enrolled_years as (
    select e.year_id
    from public.enrollments e
    cross join me
    where me.uid is not null
      and e.student_id = me.uid
      and e.status = 'active'
  ),
  folder_grants as (
    select g.folder_id
    from public.access_grants g
    cross join me
    where me.uid is not null
      and g.student_id = me.uid
      and g.grant_type = 'materials_folder'
      and g.revoked_at is null
      and g.folder_id is not null
  ),
  folder_restrictions as (
    select r.folder_id
    from public.access_restrictions r
    cross join me
    where me.uid is not null
      and r.student_id = me.uid
      and r.resource_kind = 'materials_folder'
      and r.revoked_at is null
      and r.folder_id is not null
  ),
  subject_restrictions as (
    select r.subject_id
    from public.access_restrictions r
    cross join me
    where me.uid is not null
      and r.student_id = me.uid
      and r.resource_kind = 'practice_subject'
      and r.revoked_at is null
      and r.subject_id is not null
  )
  select f.id
  from public.material_folders f
  cross join me
  where me.ok
    and f.deleted_at is null
    -- can_view_material_folder (inlined, set joins)
    and (
      f.library_type = 'career_counseling_series'
      or f.year_id in (select year_id from enrolled_years)
      or f.id in (select folder_id from folder_grants)
    )
    -- can_access_material_folder content half
    and f.id not in (select folder_id from folder_restrictions)
    and (
      (
        f.library_type = 'mcq_bank'
        and (
          f.subject_id is null
          or f.subject_id not in (select subject_id from subject_restrictions)
        )
        and (
          (f.subject_id is not null and public.has_practice_access(f.subject_id))
          or f.id in (select folder_id from folder_grants)
        )
      )
      or (
        f.library_type is distinct from 'mcq_bank'
        and (
          f.id in (select folder_id from folder_grants)
          or public.resource_entitlement_allows(f.entitlement, f.required_plan_id)
        )
      )
    );
$$;

comment on function public.accessible_folder_ids() is
  'Set-based folder content access ids. Semantically identical to filtering material_folders with can_access_material_folder(id).';

revoke all on function public.accessible_folder_ids() from public;
grant execute on function public.accessible_folder_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. accessible_folder_ids_among (scoped, same predicate)
-- ---------------------------------------------------------------------------
create or replace function public.accessible_folder_ids_among(p_folder_ids uuid[])
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select
      (select auth.uid()) as uid,
      public.account_allows_lms() as ok
  ),
  enrolled_years as (
    select e.year_id
    from public.enrollments e
    cross join me
    where me.uid is not null
      and e.student_id = me.uid
      and e.status = 'active'
  ),
  folder_grants as (
    select g.folder_id
    from public.access_grants g
    cross join me
    where me.uid is not null
      and g.student_id = me.uid
      and g.grant_type = 'materials_folder'
      and g.revoked_at is null
      and g.folder_id is not null
  ),
  folder_restrictions as (
    select r.folder_id
    from public.access_restrictions r
    cross join me
    where me.uid is not null
      and r.student_id = me.uid
      and r.resource_kind = 'materials_folder'
      and r.revoked_at is null
      and r.folder_id is not null
  ),
  subject_restrictions as (
    select r.subject_id
    from public.access_restrictions r
    cross join me
    where me.uid is not null
      and r.student_id = me.uid
      and r.resource_kind = 'practice_subject'
      and r.revoked_at is null
      and r.subject_id is not null
  )
  select f.id
  from public.material_folders f
  cross join me
  where me.ok
    and p_folder_ids is not null
    and f.id = any (p_folder_ids)
    and f.deleted_at is null
    and (
      f.library_type = 'career_counseling_series'
      or f.year_id in (select year_id from enrolled_years)
      or f.id in (select folder_id from folder_grants)
    )
    and f.id not in (select folder_id from folder_restrictions)
    and (
      (
        f.library_type = 'mcq_bank'
        and (
          f.subject_id is null
          or f.subject_id not in (select subject_id from subject_restrictions)
        )
        and (
          (f.subject_id is not null and public.has_practice_access(f.subject_id))
          or f.id in (select folder_id from folder_grants)
        )
      )
      or (
        f.library_type is distinct from 'mcq_bank'
        and (
          f.id in (select folder_id from folder_grants)
          or public.resource_entitlement_allows(f.entitlement, f.required_plan_id)
        )
      )
    );
$$;

comment on function public.accessible_folder_ids_among(uuid[]) is
  'Subset of accessible folders for a caller-supplied id list. Same predicate as accessible_folder_ids, evaluated only on those ids (Notes / Prof. Session day Guidelines/LoS).';

revoke all on function public.accessible_folder_ids_among(uuid[]) from public;
grant execute on function public.accessible_folder_ids_among(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. set_resource_entitlement: subject-level MCQ Bank + class/year scoping
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
  v_library_type text;
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
  elsif p_kind = 'materials_folder' then
    select year_id, library_type into v_year, v_library_type
    from public.material_folders where id = p_id;
  elsif p_kind = 'pearl_point' then
    select year_id into v_year from public.pearl_points where id = p_id;
  end if;

  if p_kind in ('ospe_station', 'materials_folder', 'pearl_point') then
    if v_year is null then
      raise exception 'resource not found';
    end if;
    if public.has_permission('manage_materials')
       and not public.has_permission('grant_resource_access')
       and not public.admin_can_access_year(v_year) then
      raise exception 'permission_denied';
    end if;
  end if;

  -- D1(a): MCQ Bank access is decided by the subject (practice_subject).
  if p_kind = 'materials_folder' and v_library_type = 'mcq_bank' then
    raise exception 'mcq_bank_access_is_subject_level';
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
