-- ROLLBACK for 20261123150000_mcq_bank_pdf_subject_gate.sql (forward-only: apply as a new migration).
-- Restores the verbatim previous bodies from the production-lineage (dabebd4) migrations.
-- WARNING: restoring re-opens the MCQ Bank paid-subject PDF bypass (R2). Use only if the gate itself breaks.

-- can_access_material_folder: 20260926150000_mcq_bank_folder_content.sql
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
            and f.subject_id is not null
            and public.has_practice_access(f.subject_id)
          )
          or public.resource_content_allowed(
            'materials_folder', null, null, f.id, f.entitlement, f.required_plan_id
          )
        )
    );
$$;

comment on function public.can_access_material_folder(uuid) is
  'Content open. mcq_bank PDFs use has_practice_access(product subject); other folders use resource_content_allowed.';

-- accessible_folder_ids: 20261005200000_academic_folder_access_set_based.sql
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
        and f.subject_id is not null
        and public.has_practice_access(f.subject_id)
      )
      or f.id in (select folder_id from folder_grants)
      or public.resource_entitlement_allows(f.entitlement, f.required_plan_id)
    );
$$;

comment on function public.accessible_folder_ids() is
  'Set-based folder content access ids. Semantically identical to filtering material_folders with can_access_material_folder(id).';

revoke all on function public.accessible_folder_ids() from public;
grant execute on function public.accessible_folder_ids() to authenticated, service_role;

-- accessible_folder_ids_among: 20261024180000_prof_session_content_load_perf.sql
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
        and f.subject_id is not null
        and public.has_practice_access(f.subject_id)
      )
      or f.id in (select folder_id from folder_grants)
      or public.resource_entitlement_allows(f.entitlement, f.required_plan_id)
    );
$$;

comment on function public.accessible_folder_ids_among(uuid[]) is
  'Subset of accessible folders for a caller-supplied id list. Same predicate as accessible_folder_ids, evaluated only on those ids (Notes / Prof. Session day Guidelines/LoS).';

revoke all on function public.accessible_folder_ids_among(uuid[]) from public;
grant execute on function public.accessible_folder_ids_among(uuid[]) to authenticated, service_role;

-- set_resource_entitlement: 20260920053838_ospe_practice_stations.sql
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
