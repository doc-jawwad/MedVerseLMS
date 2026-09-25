-- Career Counseling Series: universal (not class/year-scoped).
-- Docs: architecture.md §2b-iv, database.md material_folders, permissions.md.

-- ---------------------------------------------------------------------------
-- 1. Schema: year_id nullable; CCS must be null; all other types require year_id
-- ---------------------------------------------------------------------------
alter table public.material_folders
  alter column year_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. Data: consolidate same-name live CCS roots, then clear year_id
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_keeper uuid;
begin
  for r in
    select lower(f.name) as name_key
    from public.material_folders f
    where f.library_type = 'career_counseling_series'
      and f.deleted_at is null
      and f.parent_id is null
    group by lower(f.name)
    having count(*) > 1
  loop
    select f.id into v_keeper
    from public.material_folders f
    where f.library_type = 'career_counseling_series'
      and f.deleted_at is null
      and f.parent_id is null
      and lower(f.name) = r.name_key
    order by (
      select count(*)::int
      from public.materials m
      where m.folder_id = f.id and m.deleted_at is null
    ) desc,
    f.created_at asc,
    f.id asc
    limit 1;

    -- Re-home live materials from duplicate folders onto the keeper.
    update public.materials m
    set folder_id = v_keeper, updated_at = now()
    where m.deleted_at is null
      and m.folder_id in (
        select f.id
        from public.material_folders f
        where f.library_type = 'career_counseling_series'
          and f.deleted_at is null
          and f.parent_id is null
          and lower(f.name) = r.name_key
          and f.id <> v_keeper
      );

    -- Soft-delete duplicate empty shells (materials already moved or none).
    update public.material_folders f
    set
      deleted_at = now(),
      purge_after = now() + interval '7 days',
      deleted_by = null,
      updated_at = now()
    where f.library_type = 'career_counseling_series'
      and f.deleted_at is null
      and f.parent_id is null
      and lower(f.name) = r.name_key
      and f.id <> v_keeper;
  end loop;
end;
$$;

-- All CCS rows (live + binned) must satisfy the universal shape before CHECK.
update public.material_folders
set
  year_id = null,
  subject_id = null,
  parent_id = null,
  content_surface = 'academic',
  prof_session_day_id = null,
  day_slot_key = null,
  updated_at = now()
where library_type = 'career_counseling_series'
  and (
    year_id is not null
    or subject_id is not null
    or parent_id is not null
    or coalesce(content_surface, 'academic') is distinct from 'academic'
    or prof_session_day_id is not null
    or day_slot_key is not null
  );

alter table public.material_folders
  drop constraint if exists material_folders_ccs_universal_check;

alter table public.material_folders
  add constraint material_folders_ccs_universal_check
  check (
    library_type <> 'career_counseling_series'
    or (
      year_id is null
      and subject_id is null
      and parent_id is null
      and coalesce(content_surface, 'academic') = 'academic'
      and prof_session_day_id is null
      and day_slot_key is null
    )
  );

alter table public.material_folders
  drop constraint if exists material_folders_year_id_required_check;

alter table public.material_folders
  add constraint material_folders_year_id_required_check
  check (
    library_type = 'career_counseling_series'
    or year_id is not null
  );

comment on column public.material_folders.year_id is
  'Class year for year-scoped materials. NULL only for career_counseling_series (universal hub).';

-- ---------------------------------------------------------------------------
-- 3. Student catalog: CCS visible to any LMS-allowed account (no enrollment year)
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
        and f.deleted_at is null
        and (
          f.library_type = 'career_counseling_series'
          or public.has_active_enrollment(f.year_id)
          or public.has_resource_grant('materials_folder', null, null, f.id)
        )
    );
$$;

comment on function public.can_view_material_folder(uuid) is
  'Catalog visibility. Year enrollment required except career_counseling_series (universal).';

-- ---------------------------------------------------------------------------
-- 4. Bin list: include universal CCS (null year_id) for manage_materials
-- ---------------------------------------------------------------------------
create or replace function public.list_content_bin_page(
  p_year_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  entity_type text,
  entity_id uuid,
  name text,
  year_id uuid,
  deleted_at timestamptz,
  purge_after timestamptz,
  deleted_by uuid,
  has_r2 boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
begin
  if (select auth.uid()) is null then
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

  return query
  with bin as (
    select 'material_folder'::text as entity_type, mf.id as entity_id, mf.name,
           mf.year_id, mf.deleted_at, mf.purge_after, mf.deleted_by, false as has_r2
    from public.material_folders mf
    where mf.deleted_at is not null
      and (
        (
          mf.library_type = 'career_counseling_series'
          and mf.year_id is null
          and public.has_permission('manage_materials')
        )
        or (
          mf.year_id is not null
          and (p_year_id is null or mf.year_id = p_year_id)
          and public.admin_can_access_year(mf.year_id)
        )
      )
    union all
    select 'material'::text, m.id, m.title, mf2.year_id, m.deleted_at, m.purge_after, m.deleted_by,
           (m.r2_object_key is not null)
    from public.materials m
    join public.material_folders mf2 on mf2.id = m.folder_id
    where m.deleted_at is not null
      and (
        (
          mf2.library_type = 'career_counseling_series'
          and mf2.year_id is null
          and public.has_permission('manage_materials')
        )
        or (
          mf2.year_id is not null
          and (p_year_id is null or mf2.year_id = p_year_id)
          and public.admin_can_access_year(mf2.year_id)
        )
      )
    union all
    select 'pearl_point'::text, pp.id, left(pp.prompt, 200), pp.year_id,
           pp.deleted_at, pp.purge_after, pp.deleted_by, false
    from public.pearl_points pp
    where pp.deleted_at is not null
      and (p_year_id is null or pp.year_id = p_year_id)
      and public.admin_can_access_year(pp.year_id)
    union all
    select 'ospe_station'::text, os.id, os.title, os.year_id, os.deleted_at, os.purge_after, os.deleted_by,
           (os.r2_object_key is not null)
    from public.ospe_stations os
    where os.deleted_at is not null
      and (p_year_id is null or os.year_id = p_year_id)
      and public.admin_can_access_year(os.year_id)
    union all
    select 'question'::text, q.id, left(coalesce(qv.stem, 'Untitled'), 80), q.year_id,
           q.deleted_at, q.purge_after, q.deleted_by, false
    from public.questions q
    left join public.question_versions qv on qv.id = q.current_version_id
    where q.deleted_at is not null
      and (p_year_id is null or q.year_id = p_year_id)
      and public.admin_can_access_year(q.year_id)
    union all
    select 'prof_session_day'::text, psd.id, psd.name, psd.year_id,
           psd.deleted_at, psd.purge_after, psd.deleted_by, false
    from public.prof_session_days psd
    where psd.deleted_at is not null
      and (p_year_id is null or psd.year_id = p_year_id)
      and public.admin_can_access_year(psd.year_id)
    union all
    select 'one_liner'::text, ol.id, left(ol.title, 80), ol.year_id,
           ol.deleted_at, ol.purge_after, ol.deleted_by, false
    from public.one_liners ol
    where ol.deleted_at is not null
      and (p_year_id is null or ol.year_id = p_year_id)
      and public.admin_can_access_year(ol.year_id)
    union all
    select 'mcq_bank_folder'::text, mbf.id, mbf.name, mbf.year_id,
           mbf.deleted_at, mbf.purge_after, mbf.deleted_by, false
    from public.mcq_bank_folders mbf
    where mbf.deleted_at is not null
      and (p_year_id is null or mbf.year_id = p_year_id)
      and public.admin_can_access_year(mbf.year_id)
  ),
  ranked as (
    select
      b.*,
      count(*) over () as total_count,
      row_number() over (order by b.deleted_at desc nulls last, b.entity_id) as rn
    from bin b
  )
  select
    r.entity_type,
    r.entity_id,
    r.name,
    r.year_id,
    r.deleted_at,
    r.purge_after,
    r.deleted_by,
    r.has_r2,
    r.total_count
  from ranked r
  where r.rn > v_offset
    and r.rn <= v_offset + v_limit
  order by r.rn;
end;
$$;

create or replace function public.list_content_bin(p_year_id uuid default null)
returns table (
  entity_type text,
  entity_id uuid,
  name text,
  year_id uuid,
  deleted_at timestamptz,
  purge_after timestamptz,
  deleted_by uuid,
  has_r2 boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
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

  return query
    select 'material_folder'::text, mf.id, mf.name, mf.year_id, mf.deleted_at, mf.purge_after, mf.deleted_by, false
    from public.material_folders mf
    where mf.deleted_at is not null
      and (
        (
          mf.library_type = 'career_counseling_series'
          and mf.year_id is null
          and public.has_permission('manage_materials')
        )
        or (
          mf.year_id is not null
          and (p_year_id is null or mf.year_id = p_year_id)
          and public.admin_can_access_year(mf.year_id)
        )
      )
    union all
    select 'material'::text, m.id, m.title, mf2.year_id, m.deleted_at, m.purge_after, m.deleted_by,
      (m.r2_object_key is not null)
    from public.materials m
    join public.material_folders mf2 on mf2.id = m.folder_id
    where m.deleted_at is not null
      and (
        (
          mf2.library_type = 'career_counseling_series'
          and mf2.year_id is null
          and public.has_permission('manage_materials')
        )
        or (
          mf2.year_id is not null
          and (p_year_id is null or mf2.year_id = p_year_id)
          and public.admin_can_access_year(mf2.year_id)
        )
      )
    union all
    select 'pearl_point'::text, pp.id, left(pp.prompt, 200), pp.year_id, pp.deleted_at, pp.purge_after, pp.deleted_by, false
    from public.pearl_points pp
    where pp.deleted_at is not null
      and (p_year_id is null or pp.year_id = p_year_id)
      and public.admin_can_access_year(pp.year_id)
    union all
    select 'ospe_station'::text, os.id, os.title, os.year_id, os.deleted_at, os.purge_after, os.deleted_by,
      (os.r2_object_key is not null)
    from public.ospe_stations os
    where os.deleted_at is not null
      and (p_year_id is null or os.year_id = p_year_id)
      and public.admin_can_access_year(os.year_id)
    union all
    select 'question'::text, q.id, left(coalesce(qv.stem, 'Untitled'), 80), q.year_id,
      q.deleted_at, q.purge_after, q.deleted_by, false
    from public.questions q
    left join public.question_versions qv on qv.id = q.current_version_id
    where q.deleted_at is not null
      and (p_year_id is null or q.year_id = p_year_id)
      and public.admin_can_access_year(q.year_id)
    union all
    select 'prof_session_day'::text, psd.id, psd.name, psd.year_id, psd.deleted_at, psd.purge_after, psd.deleted_by, false
    from public.prof_session_days psd
    where psd.deleted_at is not null
      and (p_year_id is null or psd.year_id = p_year_id)
      and public.admin_can_access_year(psd.year_id)
    union all
    select 'one_liner'::text, ol.id, left(ol.title, 80), ol.year_id, ol.deleted_at, ol.purge_after, ol.deleted_by, false
    from public.one_liners ol
    where ol.deleted_at is not null
      and (p_year_id is null or ol.year_id = p_year_id)
      and public.admin_can_access_year(ol.year_id)
    union all
    select 'mcq_bank_folder'::text, mbf.id, mbf.name, mbf.year_id, mbf.deleted_at, mbf.purge_after, mbf.deleted_by, false
    from public.mcq_bank_folders mbf
    where mbf.deleted_at is not null
      and (p_year_id is null or mbf.year_id = p_year_id)
      and public.admin_can_access_year(mbf.year_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Purge: allow CCS null year_id (manage_materials); keep year checks elsewhere
-- ---------------------------------------------------------------------------
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
  v_library_type text;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated';
  end if;

  if p_entity_type not in (
    'material_folder', 'material', 'pearl_point', 'ospe_station',
    'question', 'prof_session_day', 'one_liner', 'mcq_bank_folder'
  ) then
    raise exception 'invalid_entity_type';
  end if;

  if p_entity_type in ('question', 'mcq_bank_folder') then
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
      select year_id, name, library_type into v_year_id, v_name, v_library_type
      from public.material_folders where id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if v_library_type = 'career_counseling_series' then
        if v_year_id is not null then raise exception 'invalid_ccs_year_scope'; end if;
      else
        if v_year_id is null then raise exception 'entity_not_found'; end if;
        if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      end if;
      for v_r2, v_cover in
        select m.r2_object_key, m.cover_object_key
        from public.materials m where m.folder_id = p_entity_id
      loop
        perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
        perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      end loop;
      delete from public.material_folders where id = p_entity_id;

    when 'material' then
      select f.year_id, m.title, m.r2_object_key, m.cover_object_key, f.library_type
        into v_year_id, v_name, v_r2, v_cover, v_library_type
      from public.materials m
      join public.material_folders f on f.id = m.folder_id
      where m.id = p_entity_id;
      if not found then raise exception 'entity_not_found'; end if;
      if v_library_type = 'career_counseling_series' then
        if v_year_id is not null then raise exception 'invalid_ccs_year_scope'; end if;
      else
        if v_year_id is null then raise exception 'entity_not_found'; end if;
        if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      end if;
      perform public.enqueue_r2_purge(v_r2, 'material', p_entity_id);
      perform public.enqueue_r2_purge(v_cover, 'material', p_entity_id);
      delete from public.materials where id = p_entity_id;

    when 'pearl_point' then
      select year_id, left(prompt, 200) into v_year_id, v_name
      from public.pearl_points where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.pearl_points where id = p_entity_id;

    when 'ospe_station' then
      select year_id, title, r2_object_key into v_year_id, v_name, v_r2
      from public.ospe_stations where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      perform public.enqueue_r2_purge(v_r2, 'ospe_station', p_entity_id);
      delete from public.ospe_stations where id = p_entity_id;

    when 'question' then
      select year_id, coalesce(stem_normalized, id::text) into v_year_id, v_name
      from public.questions where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      if exists (select 1 from public.test_questions where question_id = p_entity_id) then
        raise exception 'question_referenced_by_test';
      end if;
      perform set_config('medverse.allow_question_version_purge', '1', true);
      delete from public.practice_answers pa
      using public.question_versions qv
      where pa.question_version_id = qv.id
        and qv.question_id = p_entity_id;
      delete from public.questions where id = p_entity_id;
      perform set_config('medverse.allow_question_version_purge', '', true);

    when 'prof_session_day' then
      select year_id, name into v_year_id, v_name
      from public.prof_session_days where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.prof_session_days where id = p_entity_id;

    when 'one_liner' then
      select year_id, left(title, 200) into v_year_id, v_name
      from public.one_liners where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.one_liners where id = p_entity_id and deleted_at is not null;

    when 'mcq_bank_folder' then
      select year_id, name into v_year_id, v_name
      from public.mcq_bank_folders where id = p_entity_id;
      if v_year_id is null then raise exception 'entity_not_found'; end if;
      if not public.admin_can_access_year(v_year_id) then raise exception 'year_scope_denied'; end if;
      delete from public.mcq_bank_folders where id = p_entity_id and deleted_at is not null;
  end case;

  perform public.log_audit(
    'content_purged',
    p_entity_type,
    p_entity_id,
    jsonb_build_object('name', v_name, 'year_id', v_year_id)
  );
end;
$$;
